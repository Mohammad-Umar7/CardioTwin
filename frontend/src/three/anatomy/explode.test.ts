import { Vector3, type Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEART_HINGE_DEG,
  GREAT_VESSEL_LIFT,
  GREAT_VESSEL_WINDOW,
  PEEL_DETENTS,
  PEEL_SPRING_OMEGA,
  PEEL_WINDOWS,
  buildExplodeSpecs,
  defaultHeartHinge,
  explodeDelta,
  heartFrameFrom,
  riderDelta,
  springStep,
  windowProgress,
  type ManifestLike,
} from './explode';

/** A trimmed copy of the published manifest's explode data (frontend/public/anatomy/manifest.json). */
const HEART = {
  cut_plane: { point: [0.18953, -0.27303, 0.18293], normal: [-0.44673, 0.22986, 0.86464] },
  apex: [0.46737, -0.41599, 0.36448],
  base_center: [-0.08832, -0.13007, 0.00137],
};
const ANTERIOR: [number, number, number] = [-0.8074, 0.1839, 0.6917];
const MANIFEST: ManifestLike = {
  layers: [
    { id: 'skeleton', node: 'Layer_Skeleton', explode: [0, 0, 0.5], nodes: ['Ribs_L', 'Sternum', 'Spine_Thoracic'] },
    { id: 'heart', node: 'Layer_Heart', explode: [0, 0, 0], nodes: ['Heart_Wall_Anterior', 'Heart_Wall_Posterior', 'Valve_Mitral'] },
    { id: 'coronary', node: 'Layer_Coronary', explode: [0, 0, 0], nodes: ['Coronary_LAD', 'Coronary_LCX'] },
  ],
  structures: [
    { node: 'Ribs_L', layer: 'skeleton', explode: [1.95, -0.1, 0.1] },
    { node: 'Sternum', layer: 'skeleton', explode: [0, 1.5, 1.2] },
    { node: 'Heart_Wall_Anterior', layer: 'heart', explode: ANTERIOR },
    { node: 'Heart_Wall_Posterior', layer: 'heart', explode: [0, 0, 0] },
    { node: 'Coronary_LAD', layer: 'coronary', explode: ANTERIOR, rides: 'Heart_Wall_Anterior' },
    { node: 'Coronary_LCX', layer: 'coronary', explode: [0, 0, 0], rides: 'Heart_Wall_Posterior' },
  ],
};

const frame = heartFrameFrom(HEART);
const apply = (m: Matrix4, p: Vector3) => p.clone().applyMatrix4(m);

describe('peel windows', () => {
  it('run outside-in and finish with the heart opening last', () => {
    const order = ['skin', 'muscle', 'skeleton', 'lungs', 'diaphragm', 'heart'];
    for (let i = 1; i < order.length; i += 1) expect(PEEL_WINDOWS[order[i]!]![0]).toBeGreaterThanOrEqual(PEEL_WINDOWS[order[i - 1]!]![0]);
    expect(PEEL_WINDOWS.heart![1]).toBe(1);
  });

  it('ease from 0 to 1 inside the window and clamp outside it', () => {
    const w = PEEL_WINDOWS.heart!;
    expect(windowProgress(0.6, w)).toBe(0);
    expect(windowProgress(0.85, w)).toBeCloseTo(0.5, 9);
    expect(windowProgress(1, w)).toBe(1);
    let prev = 0;
    for (let e = 0; e <= 1; e += 0.01) {
      const k = windowProgress(e, w);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = k;
    }
  });

  it('put the rest detent (lungs aside) before the heart opens', () => {
    const rest = PEEL_DETENTS.find((d) => d.id === 'lungs')!.value;
    expect(windowProgress(rest, PEEL_WINDOWS.heart!)).toBe(0);
    expect(windowProgress(rest, PEEL_WINDOWS.skeleton!)).toBe(1);
  });
});

describe('explode specs from the manifest', () => {
  const specs = buildExplodeSpecs(MANIFEST, frame);

  it('adds the layer AND the structure vector (the bug that kept the heart shut)', () => {
    expect(specs.get('Ribs_L')!.vector.toArray()).toEqual([1.95, -0.1, 0.6]);
    expect(specs.get('Sternum')!.vector.toArray()).toEqual([0, 1.5, 1.7]);
    expect(specs.get('Heart_Wall_Anterior')!.vector.toArray()).toEqual(ANTERIOR);
  });

  it('moves unlisted layer nodes with the layer vector', () => {
    expect(specs.get('Spine_Thoracic')!.vector.toArray()).toEqual([0, 0, 0.5]);
    expect(specs.get('Valve_Mitral')!.vector.toArray()).toEqual([0, 0, 0]);
  });

  it('hinges the anterior half only and records who rides which wall', () => {
    expect(specs.get('Heart_Wall_Anterior')!.hinge?.deg).toBe(DEFAULT_HEART_HINGE_DEG);
    expect(specs.get('Heart_Wall_Posterior')!.hinge).toBeNull();
    expect(specs.get('Coronary_LAD')!.rides).toBe('Heart_Wall_Anterior');
    expect(specs.get('Coronary_LCX')!.rides).toBe('Heart_Wall_Posterior');
  });

  it('lifts the great vessels off the base in the open heart (a real exploded view, not only a lid)', () => {
    const withVessels = buildExplodeSpecs(
      { ...MANIFEST, structures: [...MANIFEST.structures, { node: 'GreatVessel_Aorta', layer: 'heart', explode: [0, 0, 0] }] },
      frame,
    );
    expect(withVessels.get('GreatVessel_Aorta')!.vector.toArray()).toEqual([...GREAT_VESSEL_LIFT]);
    // They lift first, from rest, before the anterior half swings (its window starts at 0.7).
    expect(withVessels.get('GreatVessel_Aorta')!.window).toEqual(GREAT_VESSEL_WINDOW);
    expect(GREAT_VESSEL_WINDOW[0]).toBeLessThan(PEEL_WINDOWS.heart![0]);
    expect(GREAT_VESSEL_WINDOW[0]).toBeGreaterThanOrEqual(0.6);
    // A structure with its own vector keeps it; the posterior wall stays put.
    expect(withVessels.get('Heart_Wall_Posterior')!.vector.toArray()).toEqual([0, 0, 0]);
  });

  it('prefers manifest hinge data when it exists', () => {
    const withHinge = buildExplodeSpecs(
      { ...MANIFEST, layers: MANIFEST.layers.map((l) => (l.id === 'skeleton' ? { ...l, pivot: [0, 0, -0.7], hingeAxis: [0, 1, 0], hingeDeg: 18 } : l)) },
      frame,
    );
    expect(withHinge.get('Ribs_L')!.hinge?.deg).toBe(18);
  });
});

describe('explode transforms', () => {
  const specs = buildExplodeSpecs(MANIFEST, frame);
  const anterior = specs.get('Heart_Wall_Anterior')!;

  it('is the identity at rest and the pure manifest translation without a hinge', () => {
    const p = new Vector3(0.1, 0.2, 0.3);
    expect(apply(explodeDelta(anterior, 0), p).distanceTo(p)).toBeLessThan(1e-12);
    const ribs = specs.get('Ribs_L')!;
    expect(apply(explodeDelta(ribs, 1), p).sub(p).distanceTo(ribs.vector)).toBeLessThan(1e-12);
    expect(apply(explodeDelta(ribs, 0.5), p).sub(p).distanceTo(ribs.vector.clone().multiplyScalar(0.5))).toBeLessThan(1e-12);
  });

  it('keeps the hinge line fixed while the half swings open (before the translation)', () => {
    const hinge = anterior.hinge!;
    const onAxis = hinge.pivot.clone().addScaledVector(hinge.axis, 0.2);
    const rotatedOnly = explodeDelta({ vector: new Vector3(), hinge }, 1);
    expect(apply(rotatedOnly, onAxis).distanceTo(onAxis)).toBeLessThan(1e-9);
  });

  it('opens the anterior half toward the cut-plane normal (it swings away from the posterior half)', () => {
    const hinge = defaultHeartHinge(frame);
    const rotatedOnly = explodeDelta({ vector: new Vector3(), hinge }, 1);
    const apexMove = apply(rotatedOnly, frame.apex).sub(frame.apex);
    expect(apexMove.dot(frame.cutNormal)).toBeGreaterThan(0);
    // The hinge axis lies in the cut plane.
    expect(Math.abs(hinge.axis.dot(frame.cutNormal))).toBeLessThan(1e-9);
  });

  it('carries a riding coronary exactly with its wall (translation AND hinge): it never detaches', () => {
    const lad = specs.get('Coronary_LAD')!;
    for (const k of [0, 0.3, 0.7, 1]) {
      const wall = explodeDelta(anterior, k);
      const rider = riderDelta(lad, anterior, k, k);
      for (const p of [frame.apex, frame.base, new Vector3(0.3, 0, 0.3)]) {
        expect(apply(rider, p).distanceTo(apply(wall, p))).toBeLessThan(1e-9);
      }
    }
  });

  it('adds only the difference when a rider has its own extra vector', () => {
    const rider = { vector: anterior.vector.clone().add(new Vector3(0, 0.1, 0)) };
    const m = riderDelta(rider, anterior, 1, 1);
    const p = new Vector3();
    expect(apply(m, p).distanceTo(apply(explodeDelta(anterior, 1), p).add(new Vector3(0, 0.1, 0)))).toBeLessThan(1e-9);
  });
});

describe('peel spring', () => {
  it('reaches the target without overshoot from rest', () => {
    let x = 0.6;
    let v = 0;
    let max = x;
    for (let i = 0; i < 120; i += 1) {
      [x, v] = springStep(x, v, 1, PEEL_SPRING_OMEGA, 1 / 60);
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(1, 3);
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('is frame-rate independent', () => {
    let a: [number, number] = [0, 0];
    let b: [number, number] = [0, 0];
    for (let i = 0; i < 60; i += 1) a = springStep(a[0], a[1], 1, PEEL_SPRING_OMEGA, 1 / 60);
    for (let i = 0; i < 30; i += 1) b = springStep(b[0], b[1], 1, PEEL_SPRING_OMEGA, 1 / 30);
    expect(a[0]).toBeCloseTo(b[0], 9);
  });

  it('returns smoothly from open to the rest state', () => {
    let x = 1;
    let v = 0;
    for (let i = 0; i < 90; i += 1) [x, v] = springStep(x, v, 0.6, PEEL_SPRING_OMEGA, 1 / 60);
    expect(x).toBeCloseTo(0.6, 2);
    expect(x).toBeGreaterThanOrEqual(0.6 - 1e-9);
  });
});
