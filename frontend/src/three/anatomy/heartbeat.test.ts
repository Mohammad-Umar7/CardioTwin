import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LONGITUDINAL_PIVOT, atrialWeight, beatMatrix, heightOf } from './beatDeform';
import { heartFrameFrom } from './explode';
import {
  ATRIAL_FILL,
  BEAT_AMPLITUDE,
  PHASES,
  SYSTOLE_FRACTION,
  SYSTOLE_SCALE,
  atrial,
  beatScale,
  beatState,
  clampHeartRate,
  inDiastole,
  ventricular,
} from './heartbeat';

const samples = (n = 2000) => Array.from({ length: n }, (_, i) => i / n);

describe('physiological heartbeat curve', () => {
  it('is at rest at the onset of systole and fully contracted at end-systole', () => {
    expect(ventricular(0)).toBeCloseTo(0, 9);
    expect(ventricular(SYSTOLE_FRACTION)).toBeCloseTo(1, 9);
    for (const x of samples()) expect(ventricular(x)).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('peaks exactly at end-systole (ventricular systole ≈ one third of the cycle)', () => {
    let best = -Infinity;
    let at = 0;
    for (const x of samples(10000)) {
      const v = ventricular(x);
      if (v > best) {
        best = v;
        at = x;
      }
    }
    expect(at).toBeCloseTo(SYSTOLE_FRACTION, 3);
    expect(SYSTOLE_FRACTION).toBeGreaterThan(0.3);
    expect(SYSTOLE_FRACTION).toBeLessThan(0.4);
  });

  it('rises monotonically through ejection and relaxes monotonically through filling', () => {
    let prev = -Infinity;
    for (let x = 0; x <= SYSTOLE_FRACTION; x += 0.001) {
      const v = ventricular(x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    prev = Infinity;
    for (let x = SYSTOLE_FRACTION; x <= PHASES.atrialOnset; x += 0.001) {
      const v = ventricular(x);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('spends most of the recoil in rapid filling, then is nearly still in diastasis', () => {
    const drop = (a: number, b: number) => ventricular(a) - ventricular(b);
    const rapid = drop(PHASES.mitralOpening, PHASES.endRapidFilling);
    const diastasis = drop(PHASES.endRapidFilling, PHASES.atrialOnset);
    expect(rapid).toBeGreaterThan(0.7);
    expect(diastasis).toBeLessThan(0.1);
  });

  it('has an atrial kick at end-diastole that slightly over-fills the ventricles', () => {
    expect(atrial(PHASES.atrialPeak)).toBeCloseTo(1, 9);
    for (const x of samples()) {
      if (x < PHASES.atrialOnset) expect(atrial(x)).toBe(0);
      expect(atrial(x)).toBeGreaterThanOrEqual(0);
      expect(atrial(x)).toBeLessThanOrEqual(1);
    }
    expect(ventricular(PHASES.atrialPeak)).toBeCloseTo(-ATRIAL_FILL, 9);
  });

  it('is continuous everywhere, including across the wrap from one beat to the next', () => {
    const eps = 1e-6;
    for (const x of [...samples(400), 0.999999]) {
      expect(Math.abs(ventricular(x + eps) - ventricular(x))).toBeLessThan(1e-3);
      expect(Math.abs(atrial(x + eps) - atrial(x))).toBeLessThan(1e-3);
    }
    expect(ventricular(1 - 1e-9)).toBeCloseTo(ventricular(0), 6);
    expect(ventricular(2.35)).toBeCloseTo(ventricular(0.35), 9);
  });

  it('keeps the legacy scalar within 0.97–1 for the procedural heart and the fx phase lock', () => {
    expect(beatScale(0)).toBeCloseTo(1, 6);
    expect(beatScale(SYSTOLE_FRACTION)).toBeCloseTo(SYSTOLE_SCALE, 6);
    for (const x of samples()) {
      expect(beatScale(x)).toBeGreaterThanOrEqual(SYSTOLE_SCALE - 1e-9);
      expect(beatScale(x)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(inDiastole(0.2)).toBe(false);
    expect(inDiastole(0.5)).toBe(true);
  });

  it('settles to the resting shape when the envelope is off', () => {
    expect(beatState(0.3, 0)).toEqual({ v: 0, a: 0 });
    expect(beatState(0.3, 1).v).toBeCloseTo(ventricular(0.3), 12);
  });

  it('clamps the rate to 40–140 bpm', () => {
    expect(clampHeartRate(20)).toBe(40);
    expect(clampHeartRate(200)).toBe(140);
    expect(clampHeartRate('x')).toBe(72);
  });
});

describe('beat deformation (affine, rest frame)', () => {
  const frame = heartFrameFrom({ apex: [0.47, -0.42, 0.36], base_center: [-0.09, -0.13, 0] });

  it('is the identity at rest', () => {
    const m = beatMatrix(frame, 0);
    const p = new Vector3(0.3, -0.2, 0.1);
    expect(p.clone().applyMatrix4(m).distanceTo(p)).toBeLessThan(1e-12);
  });

  it('moves the base toward a nearly still apex (AV-plane descent) in systole', () => {
    const m = beatMatrix(frame, 1);
    const apex = frame.apex.clone().applyMatrix4(m);
    const base = frame.base.clone().applyMatrix4(m);
    const apexShift = apex.distanceTo(frame.apex);
    const baseShift = base.distanceTo(frame.base);
    expect(baseShift).toBeGreaterThan(3 * apexShift);
    expect(baseShift).toBeCloseTo(BEAT_AMPLITUDE.longitudinal * frame.length * (1 - LONGITUDINAL_PIVOT), 9);
    // The base moves along the axis toward the apex.
    expect(base.clone().sub(frame.base).normalize().dot(frame.axis)).toBeCloseTo(-1, 9);
  });

  it('shortens radially toward the long axis without moving points on it sideways', () => {
    const m = beatMatrix(frame, 1);
    const side = new Vector3(0, 0, 1).cross(frame.axis).normalize();
    const mid = frame.apex.clone().addScaledVector(frame.axis, frame.length * 0.5);
    const off = mid.clone().addScaledVector(side, 0.4);
    const moved = off.clone().applyMatrix4(m);
    const radialBefore = off.clone().sub(mid).dot(side);
    const radialAfter = moved.clone().sub(mid.clone().applyMatrix4(m)).dot(side);
    expect(radialAfter / radialBefore).toBeCloseTo(1 - BEAT_AMPLITUDE.radial, 9);
    const onAxis = mid.clone().applyMatrix4(m);
    expect(onAxis.clone().sub(frame.apex).cross(frame.axis).length()).toBeLessThan(1e-9);
  });

  it('keeps the whole beat under the 3 % silhouette budget (volume change ≈ ejection, not more)', () => {
    const det = beatMatrix(frame, 1).determinant();
    expect(det).toBeLessThan(1);
    expect(det).toBeGreaterThan(0.88);
    expect(beatMatrix(frame, -ATRIAL_FILL).determinant()).toBeGreaterThan(1);
  });

  it('weights the atrial squeeze to the atria only', () => {
    expect(atrialWeight(0.2)).toBe(0);
    expect(atrialWeight(1.3)).toBeCloseTo(1, 6);
    expect(atrialWeight(2.2)).toBe(0);
    expect(heightOf(frame, frame.base)).toBeCloseTo(1, 9);
    expect(heightOf(frame, frame.apex)).toBeCloseTo(0, 9);
  });
});
