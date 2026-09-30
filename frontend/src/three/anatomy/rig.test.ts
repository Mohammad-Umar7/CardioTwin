import { BoxGeometry, BufferAttribute, DataTexture, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest, TargetId } from '@/types/contracts';
import { Picker } from './picking';
import { AnatomyRig, type RigInputs } from './rig';

const ANTERIOR: [number, number, number] = [-0.8074, 0.1839, 0.6917];

/** A miniature GLB-shaped scene: layer groups with centred child meshes, as the real asset has. */
function buildScene(options: { segments?: boolean; baked?: boolean } = {}) {
  const root = new Group();
  const layer = (name: string) => {
    const g = new Group();
    g.name = name;
    root.add(g);
    return g;
  };
  const mesh = (parent: Group, name: string, at: [number, number, number], colour = false) => {
    const geometry = new BoxGeometry(0.2, 0.2, 0.2);
    if (colour) {
      // LAD-dominant territory weights (R = LAD, G = LCX, B = RCA).
      const weights = new Float32Array(geometry.getAttribute('position').count * 3).map((_, i) => (i % 3 === 0 ? 0.7 : 0.1));
      geometry.setAttribute('color', new BufferAttribute(weights, 3));
    }
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
  const lad = mesh(coronary, 'Coronary_LAD', [0.33, -0.08, 0.24]);
  if (options.segments) {
    // SCCT 6 (pLAD) on the first half of the vertices, 7 (mLAD) on the rest.
    const count = lad.geometry.getAttribute('position').count;
    lad.geometry.setAttribute('_segment', new BufferAttribute(new Float32Array(count).map((_, i) => (i < count / 2 ? 6 : 7)), 1));
  }
  if (options.baked) (lad.material as MeshStandardMaterial).map = new DataTexture(new Uint8Array(4), 1, 1);
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

function makeRig(assemble = false, explode = 0.6, scene: Parameters<typeof buildScene>[0] = {}) {
  const root = buildScene(scene);
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

describe('anatomy rig: baked textures and picking', () => {
  it('queues baked GLB maps for a lazy upload and rebuilds the realistic material with them', () => {
    const { rig, node } = makeRig(false, 0.6, { baked: true });
    const pending = rig.pendingTextures();
    expect(pending.map((p) => p.entry.node)).toEqual(['Coronary_LAD']);
    expect((node('Coronary_LAD').mesh.material as MeshStandardMaterial).map).toBeNull();
    rig.markMapsReady(pending[0]!.entry);
    expect((node('Coronary_LAD').mesh.material as MeshStandardMaterial).map).toBe(pending[0]!.textures[0]);
    expect(rig.pendingTextures()).toHaveLength(0);
  });

  it('resolves structure, target, SCCT segment and territory under the pointer', () => {
    const { rig, node } = makeRig(false, 0.6, { segments: true });
    rig.update(inputs());
    const picker = new Picker(rig.entries, [{ scct: 6, code: 'pLAD', name: 'Proximal LAD', vessel: 'LAD', target: 'LAD' }], null);
    const lad = node('Coronary_LAD').mesh;
    const hit = picker.resolve(lad, new Vector3(0.33, -0.08, 0.34), 0);
    expect(hit).toMatchObject({ structureId: 'lad', target: 'LAD', kind: 'coronary', segment: { scct: 6, code: 'pLAD' } });
    const wall = picker.resolve(node('Heart_Wall_Anterior').mesh, new Vector3(0, 0, 0.23), 0);
    expect(wall).toMatchObject({ node: 'Heart_Wall_Anterior', target: null, territory: 'LAD', segment: null });
    expect(picker.resolve(new Mesh(), new Vector3(), 0)).toBeNull();
    picker.dispose();
  });

  it('only lets visible, solid structures answer the pointer', () => {
    const { rig, node } = makeRig();
    rig.update(inputs({ selected: 'LAD', isolate: true }));
    expect(node('Coronary_LCX').pickable).toBe(false);
    expect(node('Coronary_LAD').pickable).toBe(true);
    expect(node('Lung_L').pickable).toBe(false);
  });
});

describe('anatomy rig: assembly on a time budget', () => {
  it('finishes on wall-clock time at 4 fps instead of stalling half-materialised', () => {
    const { rig } = makeRig(true);
    let wall = 0;
    for (let i = 0; i < 40 && !rig.assembly.done; i += 1) {
      rig.update(inputs({ reduced: false, dt: 0.25 }));
      wall += 0.25;
    }
    expect(rig.assembly.done).toBe(true);
    // Warm-up frames plus the sub-20-fps skip: well under the 2.2 s choreography.
    expect(wall).toBeLessThanOrEqual(2.5);
  });

  it('finishes at once when the page was not on screen (a long frame gap)', () => {
    const { rig } = makeRig(true);
    for (let i = 0; i < 8; i += 1) rig.update(inputs({ reduced: false, dt: 1 / 60 }));
    expect(rig.assembly.done).toBe(false);
    rig.update(inputs({ reduced: false, dt: 3 }));
    expect(rig.assembly.done).toBe(true);
  });

  it('plays in full at 60 fps', () => {
    const { rig } = makeRig(true);
    let frames = 0;
    while (!rig.assembly.done && frames < 600) {
      rig.update(inputs({ reduced: false, dt: 1 / 60 }));
      frames += 1;
    }
    expect(frames).toBeGreaterThan(100);
    expect(frames).toBeLessThan(160);
  });
});
