import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { heartFrameFrom } from './explode';
import { axial, correctWeights, meanAngle, rvShare, type RvArc } from './territory';

const read = <T,>(file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../public/anatomy', file), 'utf8')) as T;
const manifest = read<{ heart: unknown }>('manifest.json');
const vessels = read<{ vessels: { id: string; segments: { points: number[][] }[] }[] }>('vessels.json');

const frame = heartFrameFrom(manifest.heart);
const axisFrame = { apex: frame.apex, axis: frame.axis, length: frame.length };
const trunk = (id: string, lo: number, hi: number) => {
  const pts = vessels.vessels.find((v) => v.id === id)!.segments[0]!.points;
  return pts.slice(Math.floor(pts.length * lo), Math.floor(pts.length * hi)).map((p) => new Vector3(p[0], p[1], p[2]));
};
const arc: RvArc = {
  lad: meanAngle(axisFrame, trunk('LAD', 0.2, 0.8))!,
  pda: meanAngle(axisFrame, trunk('RCA_PDA', 0.2, 0.9))!,
  margin: meanAngle(axisFrame, trunk('RCA_MARGINAL', 0.3, 1))!,
};

describe('right-ventricular free wall territory (the RCA, not the LAD)', () => {
  it('finds the RV between the two interventricular grooves, on the acute margin side', () => {
    // The acute margin (RCA marginal) lies on the RV arc; the LCX (lateral LV) does not.
    expect(rvShare(arc, { phi: arc.margin, radius: 0.4, height: 0.5 })).toBeCloseTo(1, 5);
    const lcx = meanAngle(axisFrame, trunk('LCX', 0.2, 0.8))!;
    expect(rvShare(arc, { phi: lcx, radius: 0.4, height: 0.5 })).toBe(0);
  });

  it('leaves the LAD its interventricular-groove strip, the septum and the apex', () => {
    expect(rvShare(arc, { phi: arc.lad, radius: 0.4, height: 0.5 })).toBe(0);
    expect(rvShare(arc, { phi: arc.pda, radius: 0.4, height: 0.5 })).toBe(0);
    // Near the axis = the septum; at the apex the LAD wraps around.
    expect(rvShare(arc, { phi: arc.margin, radius: 0.12, height: 0.5 })).toBe(0);
    expect(rvShare(arc, { phi: arc.margin, radius: 0.4, height: 0.02 })).toBe(0);
  });

  it('moves the weight to the RCA and keeps each vertex total (atria and roots stay neutral)', () => {
    const w = correctWeights([0.86, 0, 0.14], 1);
    expect(w).toEqual([0, 0, 1]);
    const half = correctWeights([0.5, 0.1, 0.1], 0.5);
    expect(half[0] + half[1] + half[2]).toBeCloseTo(0.7, 9);
    expect(half[2]).toBeGreaterThan(half[0]);
    expect(correctWeights([0.3, 0.2, 0.1], 0)).toEqual([0.3, 0.2, 0.1]);
  });

  it('measures angles around the long axis from the anterior direction', () => {
    const anterior = new Vector3(0, 0, 1).addScaledVector(frame.axis, -frame.axis.z).normalize();
    const front = frame.apex.clone().addScaledVector(frame.axis, frame.length * 0.5).addScaledVector(anterior, 0.4);
    const a = axial(axisFrame, front);
    expect(Math.abs(a.phi)).toBeLessThan(1);
    expect(a.height).toBeCloseTo(0.5, 5);
    expect(a.radius).toBeGreaterThan(0.2);
  });
});
