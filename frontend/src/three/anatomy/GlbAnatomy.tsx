import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box3, Mesh, Vector3, type Object3D, type Texture } from 'three';
import { useManifest, useSchemaIndex, useVessels } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import type { AnatomyManifest, TargetId, TargetSpec } from '@/types/contracts';
import { useCameraState } from '../camera/cameraState';
import { cameraRigApi } from '../camera/controlsApi';
import { debugHandles } from '../stage/debug';
import { pickPointer, usePickStore } from '../stage/pickStore';
import { readScene, useSceneControls } from '../stage/sceneControls';
import { sceneRuntime } from '../stage/sceneRuntime';
import { clearAnchors, setAnchors, toVector, type LabelAnchor } from './anchors';
import { ASSEMBLY_IGNITE_AT } from './assembly';
import { Picker, type CentrelineLike } from './picking';
import { AnatomyRig, type RigInputs } from './rig';
import { GHOST_MASK, type QualityTier } from './tissue';
import { useBeat } from './useHeartbeat';
import { useRiskAnimation } from './useRiskAnimation';

/** World-space vertex of `node` maximising z + 0.35·side·x (anterior, toward the label lane). */
function frontMostPoint(node: Object3D, side: 1 | -1): Vector3 | null {
  const v = new Vector3();
  let best: Vector3 | null = null;
  let bestScore = -Infinity;
  node.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.ctGhost) return;
    const pos = o.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const score = v.z + 0.35 * side * v.x;
      if (score > bestScore) {
        bestScore = score;
        best = v.clone();
      }
    }
  });
  return best;
}

const DEFAULT_VESSEL_TARGETS = ['LAD', 'LCX', 'RCA'];

const EMPTY_INPUTS: RigInputs = {
  dt: 0,
  explodeTarget: 0.6,
  look: 'realistic',
  stage: 'hidden',
  layerVisibility: {},
  ghostLayers: true,
  selected: null,
  isolate: false,
  ghostOthers: false,
  showVeins: true,
  section: false,
  sectionDepth: 0,
  reduced: false,
  beatV: 0,
  beatA: 0,
};

/**
 * Node name → VESSEL target, from schema.targets[].anatomy (authoritative) and
 * manifest.structures[].target. Patient-level targets (CAD → the whole heart) never colour anatomy.
 */
function nodeTargetMap(vessels: readonly TargetSpec[], manifest: AnatomyManifest | undefined): Map<string, TargetId> {
  const vesselIds = new Set(vessels.length > 0 ? vessels.map((t) => t.id) : DEFAULT_VESSEL_TARGETS);
  const map = new Map<string, TargetId>();
  for (const s of manifest?.structures ?? []) if (s.target && vesselIds.has(s.target)) map.set(s.node, s.target);
  for (const t of vessels) for (const node of t.anatomy) map.set(node, t.id);
  return map;
}

const ASSEMBLED_KEY = 'ct-assembled';
function assemblySeen(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ASSEMBLED_KEY) === '1';
  } catch {
    return false;
  }
}
function markAssemblySeen(): void {
  try {
    sessionStorage.setItem(ASSEMBLED_KEY, '1');
  } catch {
    /* private mode: the assembly may replay, which is harmless */
  }
}

/**
 * The BodyParts3D anatomy (CONTRACTS §6, §7.1). Builds an AnatomyRig over the loaded GLB — per-mesh
 * Realistic / Clinical materials, the exploded view (layer + structure vectors, the anterior half's hinge,
 * riders), the physiological beat, the cold-load assembly, isolate / ghost / section — and a BVH picker
 * that publishes structure, SCCT segment and territory under the pointer. Adding a structure needs only a
 * manifest / schema entry, not code.
 */
export function GlbAnatomy({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true);
  // useGLTF caches the parsed scene per URL; a per-mount clone keeps R3F's instance bookkeeping from
  // going stale if this component remounts (error boundary, hot reload). Geometry is shared, not copied.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const schema = useSchemaIndex();
  const manifestState = useManifest();
  const manifest = manifestState.data;
  const vessels = useVessels().data;
  const gl = useThree((s) => s.gl);
  const raycaster = useThree((s) => s.raycaster);
  const invalidate = useThree((s) => s.invalidate);
  const setAnatomySource = useViewerStore((s) => s.setAnatomySource);
  const reduced = useReducedMotion();

  const targets = useMemo(() => schema?.vessels ?? [], [schema]);
  const nodeTargets = useMemo(() => nodeTargetMap(targets, manifest), [targets, manifest]);
  const manifestSettled = manifestState.status !== 'loading';

  const rig = useMemo(() => {
    if (!manifestSettled) return null;
    const viewer = useViewerStore.getState();
    const tier: QualityTier = viewer.tier === 'D' ? 'C' : viewer.tier;
    return new AnatomyRig(
      scene,
      { manifest: manifest ?? null, nodeTargets, look: readScene().look, tier, assemble: !assemblySeen() && !reduced },
      viewer.explode,
    );
    // `reduced` only decides whether the first build assembles; later changes finish it in update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, manifest, manifestSettled, nodeTargets]);

  useEffect(() => {
    if (debugHandles()) (window as unknown as { __ctRig?: unknown }).__ctRig = rig;
    return () => rig?.dispose();
  }, [rig]);

  // Cavity attribute (crease AO, vessel grooves, fat along the arteries): one heart wall per idle slice.
  useEffect(() => {
    if (!rig || !vessels?.vessels) return;
    // The RV free wall's territory belongs to the RCA (the GLB's COLOR_0 gives it to the LAD).
    rig.correctTerritories(vessels.vessels as unknown as Parameters<AnatomyRig['correctTerritories']>[0]);
    const jobs = rig.cavityJobs(vessels.vessels as unknown as Parameters<AnatomyRig['cavityJobs']>[0]);
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const next = () => {
      if (cancelled) return;
      const job = jobs.shift();
      if (!job) return;
      job();
      invalidate();
      handle = setTimeout(next, 60);
    };
    handle = setTimeout(next, 300);
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    };
  }, [rig, vessels, invalidate]);

  // BVH picker (+ proxy tubes from the centrelines), built lazily in idle time.
  const picker = useMemo(() => {
    if (!rig) return null;
    const lines = (vessels?.vessels ?? null) as CentrelineLike[] | null;
    const extra = manifest as { segments?: unknown; veins?: unknown } | undefined;
    return new Picker(rig.entries, extra?.segments, lines, extra?.veins, rig.frame);
  }, [rig, vessels, manifest]);
  useEffect(() => {
    if (!picker) return;
    picker.scheduleBvh();
    return () => picker.dispose();
  }, [picker]);

  useEffect(() => {
    const prev = (raycaster as { firstHitOnly?: boolean }).firstHitOnly;
    (raycaster as { firstHitOnly?: boolean }).firstHitOnly = true;
    return () => {
      (raycaster as { firstHitOnly?: boolean }).firstHitOnly = prev;
    };
  }, [raycaster]);

  // Baked maps are seen at grazing angles on the walls, the fat and the great vessels: tiers A and B filter
  // them anisotropically (up to 8×), tier C keeps plain trilinear filtering.
  const upload = useCallback(
    (t: Texture) => {
      const tier = useViewerStore.getState().tier;
      t.anisotropy = tier === 'A' || tier === 'B' ? Math.min(8, gl.capabilities.getMaxAnisotropy()) : 1;
      gl.initTexture(t);
    },
    [gl],
  );

  // Lazy texture upgrade (CONTRACTS §7.1): upload one mesh's baked maps per idle slice, then switch its
  // Realistic material to the textured variant. Until then the procedural detail carries the look.
  useEffect(() => {
    if (!rig) return;
    const queue = rig.pendingTextures();
    if (queue.length === 0) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const next = () => {
      if (cancelled) return;
      const item = queue.shift();
      if (!item) return;
      for (const t of item.textures) upload(t);
      rig.markMapsReady(item.entry);
      invalidate();
      handle = setTimeout(next, 120);
    };
    handle = setTimeout(next, 600);
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    };
  }, [rig, upload, invalidate]);

  // Label anchors: manifest `labelAnchor` first; else the target node's most anterior vertex. The anchor
  // objects are updated in place every frame so labels follow the exploded wall (never the beat).
  const anchorRest = useRef<{ anchor: LabelAnchor; position: Vector3; normal: Vector3; node: string }[]>([]);
  useEffect(() => {
    if (!rig) return;
    const anchors: LabelAnchor[] = [];
    const rest: typeof anchorRest.current = [];
    scene.updateWorldMatrix(true, true);
    for (const t of targets) {
      const structure = manifest?.structures.find((s) => s.target === t.id && s.labelAnchor);
      let position = toVector(structure?.labelAnchor);
      let normal = toVector(structure?.labelNormal);
      const nodeName = structure?.node ?? t.anatomy.find((n) => rig.byNode.has(n)) ?? t.anatomy[0] ?? '';
      if (!position) {
        const node = t.anatomy.map((n) => scene.getObjectByName(n)).find(Boolean);
        if (!node) continue;
        position = frontMostPoint(node, t.id === 'RCA' ? -1 : 1) ?? new Box3().setFromObject(node).getCenter(new Vector3());
      }
      normal ??= position.clone().normalize();
      const anchor: LabelAnchor = { target: t.id, position: position.clone(), normal: normal.clone() };
      anchors.push(anchor);
      rest.push({ anchor, position, normal, node: nodeName });
    }
    anchorRest.current = rest;
    setAnchors(anchors);
    setAnatomySource('glb');
    return () => clearAnchors();
  }, [rig, scene, manifest, targets, setAnatomySource]);

  // Risk colour on every vessel material (both looks), territory tint on the shared uniforms.
  const riskTargets = useMemo(() => {
    const cache = { version: -1, map: new Map<string, ReturnType<AnatomyRig['vesselMaterials']>>() };
    const territories = rig ? [rig.shared.territory] : [];
    return {
      vessels: () => {
        if (!rig) return cache.map;
        let count = 0;
        for (const e of rig.entries) count += e.solid.size;
        if (count !== cache.version) {
          cache.version = count;
          cache.map = new Map(rig.vesselTargets().map((t) => [t, rig.vesselMaterials(t)]));
        }
        return cache.map;
      },
      territories: () => territories,
    };
  }, [rig]);
  useRiskAnimation(riskTargets);

  // Skip the assembly on any input; remember it for the session once it has played.
  useEffect(() => {
    if (!rig || rig.assembly.done) return;
    const skip = () => rig.assembly.skip();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', skip, opts);
    window.addEventListener('keydown', skip, opts);
    window.addEventListener('wheel', skip, opts);
    markAssemblySeen();
    return () => {
      window.removeEventListener('pointerdown', skip, opts);
      window.removeEventListener('keydown', skip, opts);
      window.removeEventListener('wheel', skip, opts);
    };
  }, [rig]);

  // Replay on request (tour / rebuild).
  const assemblyNonce = useSceneControls((s) => s.assemblyNonce);
  const firstNonce = useRef(assemblyNonce);
  useEffect(() => {
    if (!rig || assemblyNonce === firstNonce.current || reduced) return;
    rig.assembly.restart();
    invalidate();
  }, [assemblyNonce, rig, reduced, invalidate]);

  // The heart starts beating once it has closed (LUMEN: the beat starts after ignition).
  const beatGate = useCallback(() => !!rig && (rig.assembly.done || rig.assembly.t >= ASSEMBLY_IGNITE_AT), [rig]);
  const beat = useBeat(beatGate);

  // One mutable inputs object, refilled every frame (no per-frame allocation).
  const inputs = useRef<RigInputs | null>(null);
  useFrame((state, delta) => {
    if (!rig) return;
    const viewer = useViewerStore.getState();
    const controls = useSceneControls.getState();
    const read = readScene();
    rig.setLook(read.look);
    if (viewer.tier !== 'D') rig.setTier(viewer.tier);
    const inp = (inputs.current ??= { ...EMPTY_INPUTS });
    inp.dt = delta;
    // The landing hero always shows the heart unboxed at the peel rest state, with no workstation selection
    // (isolate, ghost-others) leaking into it; the workstation's own values come back with its stage.
    const hero = viewer.stage === 'hero';
    inp.explodeTarget = hero ? PEEL_REST : viewer.explode;
    inp.look = read.look;
    inp.stage = viewer.stage;
    inp.layerVisibility = viewer.layerVisibility;
    inp.ghostLayers = viewer.ghostLayers;
    inp.selected = hero ? null : viewer.selectedStructure;
    const viewKind = useCameraState.getState().viewKind;
    inp.trimGreatVessels = !hero && (viewKind === 'preset' || viewKind === 'focus');
    inp.isolate = read.isolate;
    inp.ghostOthers = read.ghostOthers;
    inp.showVeins = controls.showVeins;
    inp.section = controls.section;
    inp.sectionDepth = controls.sectionDepth;
    inp.reduced = reduced || viewer.calm;
    inp.beatV = beat.current.v;
    inp.beatA = beat.current.a;
    const moving = rig.update(inp);
    // The camera frames the pieces where they are THIS frame (the peel follower, CameraRig).
    cameraRigApi.followPeel?.();
    // An outer layer turning solid (the peel closing the chest) gets its baked maps now, one mesh a frame.
    const lazy = rig.nextSolidWithoutMaps();
    if (lazy) {
      for (const t of lazy.textures) upload(t);
      rig.markMapsReady(lazy.entry);
    }
    // Landing hero: ghosts (the fresnel lungs) fade out over the copy column, so the headline keeps its
    // contrast; the workstation keeps them everywhere (faint anyway).
    const mask = GHOST_MASK.uGhostMask.value;
    const width = state.size.width;
    if (hero && width > 0) {
      const left = useUiStore.getState().stageInsets.left / width;
      mask.set(left, Math.max(0.01, left * 0.35));
    } else mask.set(-1, 1);
    // Labels follow the wall they sit on through the peel and the assembly (never the beat).
    for (const a of anchorRest.current) {
      const entry = rig.byNode.get(a.node);
      if (!entry) continue;
      a.anchor.position.copy(a.position).applyMatrix4(entry.assemblyMatrix).applyMatrix4(entry.explodeMatrix);
      a.anchor.normal.copy(a.normal).transformDirection(entry.explodeMatrix);
    }
    if (moving || !sceneRuntime.assembly.done) state.invalidate();
  });

  // ------------------------------------------------------------------------------------ pointer
  const clearTimer = useRef<number | null>(null);
  const publishHover = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!picker) return;
      const info = picker.resolve(e.object, e.point, e.faceIndex);
      if (!info) return;
      e.stopPropagation();
      if (clearTimer.current !== null) {
        cancelAnimationFrame(clearTimer.current);
        clearTimer.current = null;
      }
      usePickStore.getState().setHover(info);
      pickPointer.point = info.point;
      const rect = gl.domElement.getBoundingClientRect();
      pickPointer.screen = [e.nativeEvent.clientX - rect.left, e.nativeEvent.clientY - rect.top];
      pickPointer.at = performance.now();
      const viewer = useViewerStore.getState();
      if (viewer.hoveredStructure !== info.target) viewer.hover(info.target);
      document.body.style.cursor = info.target ? 'pointer' : '';
    },
    [picker, gl],
  );
  const onPointerOut = useCallback(() => {
    if (clearTimer.current !== null) cancelAnimationFrame(clearTimer.current);
    clearTimer.current = requestAnimationFrame(() => {
      clearTimer.current = null;
      usePickStore.getState().setHover(null);
      pickPointer.point = null;
      pickPointer.screen = null;
      if (useViewerStore.getState().hoveredStructure) useViewerStore.getState().hover(null);
      document.body.style.cursor = '';
    });
  }, []);
  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!picker || e.delta > 4) return;
      const info = picker.resolve(e.object, e.point, e.faceIndex);
      if (!info) return;
      e.stopPropagation();
      usePickStore.getState().setSelected(info);
      if (!info.target) return;
      const { selectedStructure, select } = useViewerStore.getState();
      select(selectedStructure === info.target ? null : info.target);
    },
    [picker],
  );
  const onDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!picker) return;
      const info = picker.resolve(e.object, e.point, e.faceIndex);
      if (!info?.target) return;
      e.stopPropagation();
      useViewerStore.getState().focusTarget(info.target);
    },
    [picker],
  );

  return (
    <primitive
      object={scene}
      onPointerMove={publishHover}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
