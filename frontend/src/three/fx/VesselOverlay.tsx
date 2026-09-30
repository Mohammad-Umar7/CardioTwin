import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, Mesh, type Vector3, type BufferGeometry, type Object3D } from 'three';
import { useSchemaIndex } from '@/hooks/useData';
import type { RenderTier } from '@/state/viewerStore';
import { BEAT_MODE } from '../anatomy/beatDeform';
import { VESSEL_INFLATE } from '../anatomy/materials';
import { getRiskLUT } from '../riskLut';
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
        target ??= nodeTarget.get(node.name);
        node = node.parent;
      }
      const rest = restOffsetOf(nodeName);
      const material = createOverlayMaterial(shared, attribute, rest ? BEAT_MODE.atrial : BEAT_MODE.none);
      if (rest) material.uniforms.uRestOffset.value.copy(rest);
      material.uniforms.uTreeLength.value = treeLengthOf(nodeName) ?? 1;
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
      entries.current.set(object, { source: object, overlay, material, slot: slotOf(slots, target) });
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
    const active = f.pulseAmp > 0 || f.igniteAmp > 0 || dashes > 0;
    for (const entry of entries.current.values()) {
      const visible = active && isEffectivelyVisible(entry.source);
      entry.overlay.visible = visible;
      if (!visible) continue;
      const s = Math.min(entry.slot, MAX_TARGET_SLOTS - 1);
      const u = entry.material.uniforms;
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
