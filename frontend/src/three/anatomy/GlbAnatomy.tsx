import { useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box3, BufferAttribute, Mesh, Vector3, type Material, type Object3D } from 'three';
import { useManifest, useSchemaIndex } from '@/hooks/useData';
import { useViewerStore } from '@/state/viewerStore';
import { ANATOMY } from '@/theme/tokens';
import type { AnatomyManifest, TargetId, TargetSpec } from '@/types/contracts';
import { clearAnchors, setAnchors, toVector, type LabelAnchor } from './anchors';
import {
  createBoneMaterial,
  createDiaphragmMaterial,
  createGhostMaterial,
  createGreatVesselMaterial,
  createLeftMainMaterial,
  createMuscleMaterial,
  createMyocardiumMaterial,
  createPulmonaryVesselMaterial,
  createValveMaterial,
  createVesselMaterial,
  type MyocardiumMaterial,
  type VesselMaterial,
} from './materials';
import { useHeartbeat } from './useHeartbeat';
import { useRiskAnimation } from './useRiskAnimation';

/** Peel windows per layer id (DESIGN_SYSTEM §6 "Peel"): translation progresses inside [start, end]. */
const PEEL_WINDOWS: Record<string, [number, number]> = {
  skin: [0, 0.25],
  muscle: [0.05, 0.3],
  skeleton: [0.15, 0.45],
  lungs: [0.3, 0.6],
  diaphragm: [0.45, 0.65],
  heart: [0.7, 1],
  coronary: [0.7, 1],
};

/** World-space vertex of `node` maximising z + 0.35·side·x (anterior, toward the label lane). */
function frontMostPoint(node: Object3D, side: 1 | -1): Vector3 | null {
  const v = new Vector3();
  let best: Vector3 | null = null;
  let bestScore = -Infinity;
  node.traverse((o) => {
    if (!(o instanceof Mesh)) return;
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

const easePeel = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const windowProgress = (e: number, [a, b]: [number, number]) => easePeel(Math.min(1, Math.max(0, (e - a) / (b - a))));

const DEFAULT_VESSEL_TARGETS = ['LAD', 'LCX', 'RCA'];

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

/**
 * The BodyParts3D anatomy (CONTRACTS §6): loads `cardiotwin_anatomy.glb` with meshopt, assigns LUMEN
 * materials by node name, colours every node listed in `schema.targets[].anatomy` by its target's
 * probability, applies a data-driven peel from `manifest.layers[].explode`, and publishes label anchors.
 * Adding an anatomical structure needs only a manifest / schema entry, not code.
 */
export function GlbAnatomy({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true);
  // useGLTF caches the parsed scene per URL; a per-mount clone keeps R3F's instance bookkeeping from
  // going stale if this component remounts (error boundary, hot reload). Geometry is shared, not copied.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const schema = useSchemaIndex();
  const manifest = useManifest().data;
  const look = useViewerStore((s) => s.look);
  const setAnatomySource = useViewerStore((s) => s.setAnatomySource);
  const layerRefs = useRef(new Map<string, { object: Object3D; rest: Vector3; explode: Vector3; window: [number, number] }>());
  /** Outer-layer meshes with their opaque ("closed") and ghost materials, swapped as the peel opens. */
  const layerMeshes = useRef(new Map<string, { mesh: Mesh; closed: Material; ghost: Material }[]>());

  const targets = useMemo(() => schema?.vessels ?? [], [schema]);
  const nodeTargets = useMemo(() => nodeTargetMap(targets, manifest), [targets, manifest]);

  const materials = useMemo(() => {
    const vessels = new Map<string, VesselMaterial>();
    for (const target of new Set(nodeTargets.values())) vessels.set(target, createVesselMaterial());
    return {
      vessels,
      myocardium: [] as MyocardiumMaterial[],
      leftMain: createLeftMainMaterial(),
      great: createGreatVesselMaterial(),
      pulmonary: createPulmonaryVesselMaterial(),
      valve: createValveMaterial(),
      bone: createBoneMaterial(),
      muscle: createMuscleMaterial(),
      diaphragm: createDiaphragmMaterial(),
      // Ghost end states (DESIGN_SYSTEM §6 Peel / §7.3): skin α 0.03 + 0.22·F³, lungs 0.05 + 0.30·F²,
      // bone ghost 0.10–0.20·F², pectorals ≈ 0.06, diaphragm 0.08.
      skin: createGhostMaterial(ANATOMY.skin, 0.03, 0.22, 3),
      lung: createGhostMaterial(ANATOMY.lung, 0.02, 0.2, 2.5),
      boneGhost: createGhostMaterial(ANATOMY.boneGhost, 0.01, 0.14, 2),
      muscleGhost: createGhostMaterial(ANATOMY.muscle, 0.0, 0.12, 2),
      diaphragmGhost: createGhostMaterial(ANATOMY.diaphragm, 0.02, 0.1, 2),
    };
  }, [nodeTargets]);

  useEffect(
    () => () => {
      materials.vessels.forEach((m) => m.dispose());
      materials.myocardium.forEach((m) => m.dispose());
      for (const m of [
        materials.leftMain,
        materials.great,
        materials.pulmonary,
        materials.valve,
        materials.bone,
        materials.muscle,
        materials.diaphragm,
        materials.skin,
        materials.lung,
        materials.boneGhost,
        materials.muscleGhost,
        materials.diaphragmGhost,
      ])
        m.dispose();
    },
    [materials],
  );

  // Assign materials and collect layers / anchors once per loaded scene.
  useEffect(() => {
    const root = scene;
    const myocardium: MyocardiumMaterial[] = [];
    const assign = (mesh: Mesh, material: Material) => {
      mesh.material = material;
    };
    const layerIdOf = (layerNode: string) =>
      manifest?.layers.find((l) => l.node === layerNode)?.id ?? layerNode.replace(/^Layer_/, '').toLowerCase();
    layerMeshes.current.clear();
    const addLayerMesh = (layerNode: string, mesh: Mesh, closed: Material, ghost: Material) => {
      const id = layerIdOf(layerNode);
      const list = layerMeshes.current.get(id) ?? [];
      list.push({ mesh, closed, ghost });
      layerMeshes.current.set(id, list);
      mesh.material = closed;
    };

    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      // nearest named ancestor that we know about decides the material
      let node: Object3D | null = obj;
      let target: TargetId | undefined;
      let layerName = '';
      while (node) {
        target ??= nodeTargets.get(node.name);
        if (node.name.startsWith('Layer_')) layerName ||= node.name;
        node = node.parent;
      }
      const name = obj.name || obj.parent?.name || '';
      obj.userData.ctTarget = target ?? null;
      // Only vessels are pickable: skipping ~330k anatomy triangles keeps pointer moves cheap on iGPUs.
      if (!target) obj.raycast = () => {};
      if (target) return assign(obj, materials.vessels.get(target)!);
      if (/Coronary_LM/.test(name)) return assign(obj, materials.leftMain);
      if (/Heart_Wall/.test(name)) {
        // COLOR_0 carries the baked territory weights (R = LAD, G = LCX, B = RCA). Without it the wall
        // gets all-zero weights, which switches the tint off for that mesh.
        const hasWeights = !!obj.geometry.getAttribute('color');
        if (!hasWeights && !obj.geometry.getAttribute('aTerritory')) {
          const count = obj.geometry.getAttribute('position').count;
          obj.geometry.setAttribute('aTerritory', new BufferAttribute(new Float32Array(count * 3), 3));
        }
        const m = createMyocardiumMaterial(look, hasWeights ? 'color' : 'aTerritory');
        myocardium.push(m);
        return assign(obj, m);
      }
      if (/GreatVessel_Pulmonary/.test(name)) return assign(obj, materials.pulmonary);
      if (/GreatVessel/.test(name)) return assign(obj, materials.great);
      if (/Valve|Papillary/.test(name)) return assign(obj, materials.valve);
      if (/CardiacVeins/.test(name)) {
        obj.visible = false;
        return;
      }
      if (/Skin/.test(name) || layerName === 'Layer_Skin') return addLayerMesh(layerName || 'Layer_Skin', obj, materials.skin, materials.skin);
      if (/Lung|Trachea/.test(name) || layerName === 'Layer_Lungs')
        return addLayerMesh(layerName || 'Layer_Lungs', obj, materials.lung, materials.lung);
      if (/Pectoralis/.test(name) || layerName === 'Layer_Muscle')
        return addLayerMesh(layerName || 'Layer_Muscle', obj, materials.muscle, materials.muscleGhost);
      if (/Diaphragm/.test(name) || layerName === 'Layer_Diaphragm')
        return addLayerMesh(layerName || 'Layer_Diaphragm', obj, materials.diaphragm, materials.diaphragmGhost);
      if (layerName === 'Layer_Skeleton') return addLayerMesh(layerName, obj, materials.bone, materials.boneGhost);
    });
    materials.myocardium.splice(0, materials.myocardium.length, ...myocardium);

    // Peel layers from the manifest
    layerRefs.current.clear();
    for (const layer of manifest?.layers ?? []) {
      const object = root.getObjectByName(layer.node);
      if (!object) continue;
      layerRefs.current.set(layer.id, {
        object,
        rest: object.position.clone(),
        explode: new Vector3(...layer.explode),
        window: PEEL_WINDOWS[layer.id] ?? [0, 1],
      });
    }

    // Label anchors: manifest `labelAnchor` first; otherwise the vertex of the target's main node that
    // faces the viewer most at the default pose (anterior, biased toward the label's radiological lane).
    const anchors: LabelAnchor[] = [];
    root.updateWorldMatrix(true, true);
    for (const t of targets) {
      const structure = manifest?.structures.find((s) => s.target === t.id && s.labelAnchor);
      let position = toVector(structure?.labelAnchor);
      let normal = toVector(structure?.labelNormal);
      if (!position) {
        const node = t.anatomy.map((n) => root.getObjectByName(n)).find(Boolean);
        if (!node) continue;
        position = frontMostPoint(node, t.id === 'RCA' ? -1 : 1) ?? new Box3().setFromObject(node).getCenter(new Vector3());
      }
      normal ??= position.clone().normalize();
      anchors.push({ target: t.id, position, normal });
    }
    setAnchors(anchors);
    setAnatomySource('glb');
    return () => clearAnchors();
    // `look` is applied by the effect below without rebuilding materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, materials, manifest, nodeTargets, targets, setAnatomySource]);

  useEffect(() => {
    for (const m of materials.myocardium) m.color.set(look === 'clay' ? ANATOMY.clay : ANATOMY.flesh);
  }, [look, materials]);

  useRiskAnimation({ vessels: materials.vessels, myocardium: materials.myocardium });

  // Only the heart and the coronaries riding on it beat; torso layers and labels stay still.
  useHeartbeat((scale) => {
    for (const name of ['Layer_Heart', 'Layer_Coronary']) scene.getObjectByName(name)?.scale.setScalar(scale);
  });

  // Data-driven peel: each layer slides along its manifest `explode` vector inside its window and swaps
  // its opaque material for its ghost once it is more than half way out (phase 2 adds the rib hinge).
  useFrame(() => {
    const { explode: e, ghostLayers } = useViewerStore.getState();
    for (const [id, layer] of layerRefs.current) {
      const k = windowProgress(e, layer.window);
      layer.object.position.copy(layer.rest).addScaledVector(layer.explode, k);
      for (const entry of layerMeshes.current.get(id) ?? []) {
        const ghosted = k >= 0.5;
        entry.mesh.material = ghosted ? entry.ghost : entry.closed;
        entry.mesh.visible = !(ghosted && !ghostLayers && id !== 'lungs');
        const u = (entry.mesh.material as Material).userData?.uniforms as { uFade?: { value: number } } | undefined;
        if (u?.uFade) u.uFade.value = id === 'skin' ? 1 - 0.8 * k : 1;
      }
    }
  });

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const target = e.object.userData.ctTarget as TargetId | null;
    if (!target) return;
    e.stopPropagation();
    if (useViewerStore.getState().hoveredStructure !== target) useViewerStore.getState().hover(target);
    document.body.style.cursor = 'pointer';
  }, []);
  const onPointerOut = useCallback(() => {
    useViewerStore.getState().hover(null);
    document.body.style.cursor = '';
  }, []);
  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    const target = e.object.userData.ctTarget as TargetId | null;
    if (!target) return;
    e.stopPropagation();
    const { selectedStructure, select } = useViewerStore.getState();
    select(selectedStructure === target ? null : target);
  }, []);

  return <primitive object={scene} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />;
}
