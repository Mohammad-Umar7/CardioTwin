import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, Mesh, type Vector3, type BufferGeometry, type Object3D } from 'three';
import { useSchemaIndex } from '@/hooks/useData';
import type { RenderTier } from '@/state/viewerStore';
import { BEAT_MODE } from '../anatomy/beatDeform';
import { baseNode } from '../anatomy/cutSplit';
import { VESSEL_INFLATE } from '../anatomy/materials';
import { getRiskLUT } from '../riskLut';
import { sceneRuntime } from '../stage/sceneRuntime';
import { MAX_TARGET_SLOTS, fxFrame, slotOf, targetSlots } from './fxState';
import { DASH_PERIOD, createOverlayMaterial, createOverlayShared, type OverlayMaterial } from './overlayMaterial';
import { isAttached, isEffectivelyVisible } from './sceneNodes';

/** Rescan the scene for coronary meshes this often (frames); cheap, catches GLB ↔ procedural swaps. */
const SCAN_EVERY = 45;

interface Entry {
  source: Mesh;
  overlay: Mesh;
  material: OverlayMaterial;
  slot: number;
  /** Coronary node the mesh belongs to (for the anatomy's per-node solid factor). */
  node: string;
  /** Arc-length range of the mesh, for skipping draws the pulse / sweep cannot reach this frame. */
  arcMin: number;
  arcMax: number;
}

/** Where the pulse crest + wake and the ignition band + afterglow put visible light (arc length). */
const PULSE_REACH: [number, number] = [-0.6, 0.12];
const IGNITE_REACH: [number, number] = [-1.2, 0.15];

const overlaps = (min: number, max: number, front: number, [behind, ahead]: [number, number]) =>
  max >= front + behind && min <= front + ahead;

function arcRange(geometry: BufferGeometry, attribute: string): [number, number] {
  const a = geometry.getAttribute(attribute);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < a.count; i += 1) {
    const v = a.getX(i);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? [min, max] : [0, 1];
}

const arclenAttributeOf = (geometry: BufferGeometry): string | null =>
  geometry.getAttribute('_arclen') ? '_arclen' : geometry.getAttribute('_ARCLEN') ? '_ARCLEN' : null;

interface VesselOverlayProps {
  tier: RenderTier;
  /** Tree length (scene units) per coronary node name, for absolute dash spacing; default 1. */
  treeLengthOf: (node: string) => number | undefined;
  /** Rest translation of a coronary node in the anatomy root (for the shared beat chunk), if known. */
  restOffsetOf: (node: string) => Vector3 | undefined;
}

/**
 * Finds every mesh carrying an `_ARCLEN` attribute (the coronary tree of the GLB or of the procedural
 * placeholder), and gives each an additive twin that shares its geometry and copies its world matrix at
 * render time. The twins live in this component's own group: the anatomy's scene graph and materials are
 * never modified. They draw the per-beat pulse, the ignition sweep and the tier-C flow dashes.
 */
export function VesselOverlay({ tier, treeLengthOf, restOffsetOf }: VesselOverlayProps) {
  const scene = useThree((s) => s.scene);
  const schema = useSchemaIndex();
  const group = useRef<Group>(null);
  const entries = useRef(new Map<Mesh, Entry>());
  const countdown = useRef(0);
  const shared = useMemo(() => createOverlayShared(getRiskLUT(), VESSEL_INFLATE), []);

  // node name → vessel target (schema is authoritative, like the anatomy's own mapping) and slot table
  const { nodeTarget, slots } = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of schema?.vessels ?? []) for (const node of t.anatomy) map.set(node, t.id);
    return { nodeTarget: map, slots: targetSlots(schema?.vessels.map((t) => t.id)) };
  }, [schema]);

  const dispose = (entry: Entry) => {
    entry.overlay.removeFromParent();
    entry.material.dispose(); // the geometry belongs to the anatomy
  };

  useEffect(
    () => () => {
      entries.current.forEach(dispose);
      entries.current.clear();
    },
    [],
  );
  // Target mapping changed (schema loaded): rebuild on the next scan.
  useEffect(() => {
    entries.current.forEach(dispose);
    entries.current.clear();
    countdown.current = 0;
  }, [nodeTarget]);

  const scan = () => {
    const root = group.current;
    if (!root) return;
    for (const [source, entry] of entries.current) {
      if (!isAttached(source, scene)) {
        dispose(entry);
        entries.current.delete(source);
      }
    }
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || object.userData.ctFx || entries.current.has(object)) return;
      const attribute = arclenAttributeOf(object.geometry as BufferGeometry);
      if (!attribute) return;
      // nearest named ancestor that is a known coronary node
      let node: Object3D | null = object;
      let nodeName = '';
      let target: string | undefined;
      while (node && node !== scene) {
        if (!nodeName && /^Coronary_/.test(node.name)) nodeName = node.name;
        // A part split at the cut plane (`Coronary_LAD_Anterior`) answers to the vessel it was cut from.
        target ??= nodeTarget.get(node.name) ?? nodeTarget.get(baseNode(node.name));
        node = node.parent;
      }
      const source = baseNode(nodeName);
      const rest = restOffsetOf(source);
      const material = createOverlayMaterial(shared, attribute, rest ? BEAT_MODE.heart : BEAT_MODE.none);
      if (rest) material.uniforms.uRestOffset.value.copy(rest);
      material.uniforms.uTreeLength.value = treeLengthOf(source) ?? 1;
      const overlay = new Mesh(object.geometry, material);
      overlay.name = `FX_Overlay_${nodeName || object.name}`;
      overlay.userData.ctFx = true;
      overlay.matrixAutoUpdate = false;
      overlay.matrixWorldAutoUpdate = false;
      overlay.frustumCulled = false;
      overlay.renderOrder = 9;
      overlay.raycast = () => {};
      // The source's matrixWorld is current only once the renderer has updated the scene graph.
      overlay.onBeforeRender = () => {
        overlay.matrixWorld.copy(object.matrixWorld);
      };
      root.add(overlay);
      const [arcMin, arcMax] = arcRange(object.geometry as BufferGeometry, attribute);
      entries.current.set(object, { source: object, overlay, material, slot: slotOf(slots, target), node: nodeName || object.name, arcMin, arcMax });
    });
  };

  useFrame(() => {
    if (countdown.current-- <= 0) {
      scan();
      countdown.current = SCAN_EVERY;
    }
    const f = fxFrame;
    const dashes = tier === 'C' ? f.flowOpacity : 0;
    shared.uPulseFront.value = f.pulseFront;
    shared.uPulseAmp.value = f.pulseAmp;
    shared.uIgnite.value = f.ignite;
    shared.uIgniteAmp.value = f.igniteAmp;
    shared.uDashAmp.value = dashes;
    const pulsing = f.pulseAmp > 0 && f.pulseFront >= 0;
    const igniting = f.igniteAmp > 0;
    for (const entry of entries.current.values()) {
      const lit =
        dashes > 0 ||
        (pulsing && overlaps(entry.arcMin, entry.arcMax, f.pulseFront, PULSE_REACH)) ||
        (igniting && overlaps(entry.arcMin, entry.arcMax, f.ignite, IGNITE_REACH));
      const solid = sceneRuntime.nodes[entry.node]?.solid ?? 1;
      const visible = lit && solid > 0.01 && isEffectivelyVisible(entry.source);
      entry.overlay.visible = visible;
      if (!visible) continue;
      const s = Math.min(entry.slot, MAX_TARGET_SLOTS - 1);
      const u = entry.material.uniforms;
      u.uSolid.value = solid;
      if (entry.material.clippingPlanes !== sceneRuntime.sectionPlanes && sceneRuntime.sectionPlanes.length > 0) {
        entry.material.clippingPlanes = sceneRuntime.sectionPlanes;
        entry.material.needsUpdate = true;
      }
      u.uP.value = f.p[s]!;
      u.uAvail.value = f.available[s]!;
      u.uDim.value = f.dim[s]!;
      u.uTintMix.value = f.tintMix[s]!;
      u.uDensity.value = f.density[s]!;
      const phase = f.flowDistance[s]! / DASH_PERIOD;
      u.uDashPhase.value = phase - Math.floor(phase);
    }
  });

  return <group ref={group} name="FX_VesselOverlay" />;
}
