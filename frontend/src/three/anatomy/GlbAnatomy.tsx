import { useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
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
  const schema = useSchemaIndex();
  const manifest = useManifest().data;
  const look = useViewerStore((s) => s.look);
  const setAnatomySource = useViewerStore((s) => s.setAnatomySource);
  const layerRefs = useRef(new Map<string, { object: Object3D; rest: Vector3; explode: Vector3; window: [number, number] }>());

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
      valve: createValveMaterial(),
      bone: createBoneMaterial(),
      muscle: createMuscleMaterial(),
      diaphragm: createDiaphragmMaterial(),
      skin: createGhostMaterial(ANATOMY.skin, 0.03, 0.22, 3),
      lung: createGhostMaterial(ANATOMY.lung, 0.05, 0.3, 2),
    };
  }, [nodeTargets]);

  useEffect(
    () => () => {
      materials.vessels.forEach((m) => m.dispose());
      materials.myocardium.forEach((m) => m.dispose());
      for (const m of [materials.leftMain, materials.great, materials.valve, materials.bone, materials.muscle, materials.diaphragm, materials.skin, materials.lung])
        m.dispose();
    },
    [materials],
  );

  // Assign materials and collect layers / anchors once per loaded scene.
  useEffect(() => {
    const root = gltf.scene;
    const myocardium: MyocardiumMaterial[] = [];
    const assign = (mesh: Mesh, material: Material) => {
      mesh.material = material;
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
      if (/GreatVessel/.test(name)) return assign(obj, materials.great);
      if (/Valve|Papillary/.test(name)) return assign(obj, materials.valve);
      if (/CardiacVeins/.test(name)) {
        obj.visible = false;
        return;
      }
      if (/Skin/.test(name) || layerName === 'Layer_Skin') return assign(obj, materials.skin);
      if (/Lung|Trachea/.test(name) || layerName === 'Layer_Lungs') return assign(obj, materials.lung);
      if (/Pectoralis/.test(name) || layerName === 'Layer_Muscle') return assign(obj, materials.muscle);
      if (/Diaphragm/.test(name)) return assign(obj, materials.diaphragm);
      if (layerName === 'Layer_Skeleton') return assign(obj, materials.bone);
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

    // Label anchors: manifest first, else the bounding-box centre of the target's first node.
    const anchors: LabelAnchor[] = [];
    root.updateWorldMatrix(true, true);
    for (const t of targets) {
      const structure = manifest?.structures.find((s) => s.target === t.id && s.labelAnchor);
      let position = toVector(structure?.labelAnchor);
      let normal = toVector(structure?.labelNormal);
      if (!position) {
        const node = t.anatomy.map((n) => root.getObjectByName(n)).find(Boolean);
        if (!node) continue;
        position = new Box3().setFromObject(node).getCenter(new Vector3());
      }
      normal ??= position.clone().normalize();
      anchors.push({ target: t.id, position, normal });
    }
    setAnchors(anchors);
    setAnatomySource('glb');
    return () => clearAnchors();
    // `look` is applied by the effect below without rebuilding materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene, materials, manifest, nodeTargets, targets, setAnatomySource]);

  useEffect(() => {
    for (const m of materials.myocardium) m.color.set(look === 'clay' ? ANATOMY.clay : ANATOMY.flesh);
  }, [look, materials]);

  useRiskAnimation({ vessels: materials.vessels, myocardium: materials.myocardium });

  // Only the heart and the coronaries riding on it beat; torso layers and labels stay still.
  useHeartbeat((scale) => {
    for (const name of ['Layer_Heart', 'Layer_Coronary']) gltf.scene.getObjectByName(name)?.scale.setScalar(scale);
  });

  // Data-driven peel: each layer slides along its manifest `explode` vector inside its window.
  useFrame(() => {
    const e = useViewerStore.getState().explode;
    for (const [id, layer] of layerRefs.current) {
      const k = windowProgress(e, layer.window);
      layer.object.position.copy(layer.rest).addScaledVector(layer.explode, k);
      if (id === 'skin' || id === 'muscle' || id === 'skeleton' || id === 'lungs') {
        layer.object.traverse((o) => {
          const u = (o as Mesh).material && ((o as Mesh).material as Material).userData?.uniforms;
          if (u?.uFade) u.uFade.value = 1 - 0.8 * k;
        });
      }
    }
  });

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const target = e.object.userData.ctTarget as TargetId | null;
    if (!target) return;
    e.stopPropagation();
    if (useViewerStore.getState().hoveredStructure !== target) useViewerStore.getState().hover(target);
    document.body.style.cursor = 'pointer';
  };
  const onPointerOut = () => {
    useViewerStore.getState().hover(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const target = e.object.userData.ctTarget as TargetId | null;
    if (!target) return;
    e.stopPropagation();
    const { selectedStructure, select } = useViewerStore.getState();
    select(selectedStructure === target ? null : target);
  };

  return <primitive object={gltf.scene} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />;
}
