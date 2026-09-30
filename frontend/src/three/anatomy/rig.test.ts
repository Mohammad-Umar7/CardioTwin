import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest, TargetId } from '@/types/contracts';
import { AnatomyRig, type RigInputs } from './rig';

const ANTERIOR: [number, number, number] = [-0.8074, 0.1839, 0.6917];

/** A miniature GLB-shaped scene: layer groups with centred child meshes, as the real asset has. */
function buildScene() {
  const root = new Group();
  const layer = (name: string) => {
    const g = new Group();
    g.name = name;
    root.add(g);
    return g;
  };
  const mesh = (parent: Group, name: string, at: [number, number, number], colour = false) => {
    const geometry = new BoxGeometry(0.2, 0.2, 0.2);
    if (colour) geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.3), 3));
    const m = new Mesh(geometry, new MeshStandardMaterial());
    m.name = name;
    m.position.set(...at);
    parent.add(m);
    return m;
  };
  const heart = layer('Layer_Heart');
  const coronary = layer('Layer_Coronary');
  const lungs = layer('Layer_Lungs');
  mesh(heart, 'Heart_Wall_Anterior', [0, 0, 0.13], true);
  mesh(heart, 'Heart_Wall_Posterior', [0, -0.04, -0.09], true);
  mesh(heart, 'GreatVessel_Aorta', [-0.1, 0.4, -0.2]);
  mesh(coronary, 'Coronary_LAD', [0.33, -0.08, 0.24]);
  mesh(coronary, 'Coronary_LCX', [0.34, -0.05, -0.07]);
  mesh(lungs, 'Lung_L', [0.44, 0.07, -0.15]);
  root.updateMatrixWorld(true);
  return root;
}

const MANIFEST = {
  version: '1',
  glb: 'x.glb',
  credits: '',
  heart: {
    cut_plane: { point: [0.18953, -0.27303, 0.18293], normal: [-0.44673, 0.22986, 0.86464] },
    apex: [0.46737, -0.41599, 0.36448],
    base_center: [-0.08832, -0.13007, 0.00137],
  },
  layers: [
    { id: 'lungs', node: 'Layer_Lungs', label: 'Lungs', explode: [0, 0, 0], order: 3, nodes: ['Lung_L'] },
    { id: 'heart', node: 'Layer_Heart', label: 'Heart', explode: [0, 0, 0], order: 5, nodes: ['Heart_Wall_Anterior', 'Heart_Wall_Posterior', 'GreatVessel_Aorta'] },
    { id: 'coronary', node: 'Layer_Coronary', label: 'Coronary', explode: [0, 0, 0], order: 6, nodes: ['Coronary_LAD', 'Coronary_LCX'] },
  ],
  structures: [
    { id: 'lung_l', node: 'Lung_L', label: 'Left lung', layer: 'lungs', explode: [0.8, 0, -0.5] },
    { id: 'heart_wall_anterior', node: 'Heart_Wall_Anterior', label: 'Anterior', layer: 'heart', explode: ANTERIOR },
    { id: 'heart_wall_posterior', node: 'Heart_Wall_Posterior', label: 'Posterior', layer: 'heart', explode: [0, 0, 0] },
    { id: 'aorta', node: 'GreatVessel_Aorta', label: 'Aorta', layer: 'heart', explode: [0, 0, 0] },
    { id: 'lad', node: 'Coronary_LAD', label: 'LAD', layer: 'coronary', target: 'LAD', explode: ANTERIOR, rides: 'Heart_Wall_Anterior' },
    { id: 'lcx', node: 'Coronary_LCX', label: 'LCX', layer: 'coronary', target: 'LCX', explode: [0, 0, 0], rides: 'Heart_Wall_Posterior' },
  ],
  camera: { home: { position: [0, 0, 6], target: [0, 0, 0] } },
} as unknown as AnatomyManifest;

const TARGETS = new Map<string, TargetId>([
  ['Coronary_LAD', 'LAD'],
  ['Coronary_LCX', 'LCX'],
]);

const inputs = (over: Partial<RigInputs> = {}): RigInputs => ({
  dt: 1 / 60,
  explodeTarget: 0.6,
  look: 'realistic',
  stage: 'workstation',
  layerVisibility: {},
  ghostLayers: true,
  selected: null,
  isolate: false,
  ghostOthers: false,
  showVeins: false,
  section: false,
  sectionDepth: 0,
  reduced: true, // instant transitions: every update lands on its target
  beatV: 0,
  beatA: 0,
  ...over,
});

function makeRig(assemble = false, explode = 0.6) {
  const root = buildScene();
  const rig = new AnatomyRig(root, { manifest: MANIFEST, nodeTargets: TARGETS, look: 'realistic', tier: 'B', assemble }, explode);
  return { root, rig, node: (n: string) => rig.byNode.get(n)! };
}

const worldOf = (m: Mesh, local = new Vector3()) => {
  m.updateMatrixWorld(true);
  return local.clone().applyMatrix4(m.matrixWorld);
};

describe('anatomy rig: exploded view', () => {
  it('keeps the heart closed at the rest detent', () => {
    const { rig, node } = makeRig();
    rig.update(inputs());
    expect(worldOf(node('Heart_Wall_Anterior').mesh).distanceTo(new Vector3(0, 0, 0.13))).toBeLessThan(1e-9);
  });

  it('opens the anterior half (layer + structure vector and hinge) and leaves the posterior half in place', () => {
    const { rig, node } = makeRig();
    rig.update(inputs({ explodeTarget: 1 }));
    const anterior = worldOf(node('Heart_Wall_Anterior').mesh);
    const moved = anterior.clone().sub(new Vector3(0, 0, 0.13));
    expect(moved.length()).toBeGreaterThan(0.8);
    expect(moved.dot(new Vector3(...ANTERIOR).normalize())).toBeGreaterThan(0.7);
    expect(worldOf(node('Heart_Wall_Posterior').mesh).distanceTo(new Vector3(0, -0.04, -0.09))).toBeLessThan(1e-9);
  });

  it('carries every rider with its wall so a coronary never detaches', () => {
    const { rig, node } = makeRig();
    const probe = new Vector3(0.3, -0.1, 0.25); // a rest-frame point shared by the wall and the LAD
    for (const e of [0.6, 0.8, 1]) {
      rig.update(inputs({ explodeTarget: e }));
      const wall = node('Heart_Wall_Anterior');
      const lad = node('Coronary_LAD');
      const viaWall = worldOf(wall.mesh, probe.clone().sub(wall.restOffset));
      const viaLad = worldOf(lad.mesh, probe.clone().sub(lad.restOffset));
      expect(viaLad.distanceTo(viaWall)).toBeLessThan(1e-9);
    }
  });

  it('beats the heart and its coronaries together but never the great vessels’ node', () => {
    const { rig, node } = makeRig();
    rig.update(inputs({ beatV: 1 }));
    expect(worldOf(node('Heart_Wall_Anterior').mesh).distanceTo(new Vector3(0, 0, 0.13))).toBeGreaterThan(1e-4);
    expect(worldOf(node('GreatVessel_Aorta').mesh).distanceTo(new Vector3(-0.1, 0.4, -0.2))).toBeLessThan(1e-9);
  });
});

describe('anatomy rig: visibility', () => {
  it('hides the lungs in the workstation and shows them as a ghost on the landing', () => {
    const { rig, node } = makeRig();
    rig.update(inputs());
    expect(node('Lung_L').mesh.visible).toBe(false);
    rig.update(inputs({ stage: 'hero' }));
    expect(node('Lung_L').mesh.visible).toBe(true);
    expect(node('Lung_L').ghostMesh.visible).toBe(true);
    expect((node('Lung_L').mesh.material as MeshStandardMaterial).visible).toBe(false);
  });

  it('isolates the selected artery with the myocardium and fades everything else out', () => {
    const { rig, node } = makeRig();
    rig.update(inputs({ selected: 'LAD', isolate: true }));
    expect(node('Coronary_LAD').mesh.visible).toBe(true);
    expect(node('Heart_Wall_Anterior').mesh.visible).toBe(true);
    expect(node('Coronary_LCX').mesh.visible).toBe(false);
    expect(node('GreatVessel_Aorta').mesh.visible).toBe(false);
  });

  it('ghosts the others and keeps the selected artery solid and pickable', () => {
    const { rig, node } = makeRig();
    rig.update(inputs({ selected: 'LAD', ghostOthers: true }));
    expect(node('Coronary_LAD').pickable).toBe(true);
    expect(node('Heart_Wall_Anterior').ghostMesh.visible).toBe(true);
    expect(node('Heart_Wall_Anterior').pickable).toBe(false);
    expect(node('Coronary_LCX').ghostMesh.visible).toBe(true);
  });

  it('parks the section plane far away when off and puts it on the cut plane when on', () => {
    const { rig } = makeRig();
    const p = new Vector3(0.18953, -0.27303, 0.18293);
    rig.update(inputs());
    expect(rig.sectionPlanes[0]!.distanceToPoint(p)).toBeGreaterThan(1);
    rig.update(inputs({ section: true }));
    expect(Math.abs(rig.sectionPlanes[0]!.distanceToPoint(p))).toBeLessThan(1e-6);
    // Keeps the posterior side (negative normal side of the cut plane is clipped away = anterior).
    expect(rig.sectionPlanes[0]!.distanceToPoint(new Vector3(0, -0.04, -0.3))).toBeGreaterThan(0);
  });
});

describe('anatomy rig: cold-load assembly', () => {
  it('starts with everything out and invisible and ends exactly at rest', () => {
    const { rig, node } = makeRig(true);
    rig.update(inputs({ reduced: false, dt: 0 }));
    const anterior = node('Heart_Wall_Anterior');
    expect(anterior.mesh.visible).toBe(false);
    expect(worldOf(anterior.mesh).distanceTo(new Vector3(0, 0, 0.13))).toBeGreaterThan(0.5);
    for (let i = 0; i < 400 && !rig.assembly.done; i += 1) rig.update(inputs({ reduced: false, dt: 1 / 60 }));
    for (let i = 0; i < 60; i += 1) rig.update(inputs({ reduced: false, dt: 1 / 60 }));
    expect(rig.assembly.done).toBe(true);
    expect(anterior.mesh.visible).toBe(true);
    expect(worldOf(anterior.mesh).distanceTo(new Vector3(0, 0, 0.13))).toBeLessThan(1e-6);
    // The LAD rode in with its wall.
    expect(worldOf(node('Coronary_LAD').mesh).distanceTo(new Vector3(0.33, -0.08, 0.24))).toBeLessThan(1e-6);
  });

  it('switches looks without rebuilding the geometry', () => {
    const { rig, node } = makeRig();
    const geometry = node('Heart_Wall_Anterior').mesh.geometry;
    rig.setLook('clinical');
    rig.update(inputs({ look: 'clinical' }));
    expect(node('Heart_Wall_Anterior').mesh.geometry).toBe(geometry);
    expect((node('Heart_Wall_Anterior').mesh.material as MeshStandardMaterial).type).toBe('MeshStandardMaterial');
    rig.dispose();
  });
});
