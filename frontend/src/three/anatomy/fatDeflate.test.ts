import { describe, expect, it } from 'vitest';
import { deflateDirections, type DeflatePart } from './fatDeflate';

const SEG = 24;
const RINGS = 8;

/**
 * One closed half of a unit sphere cut at z = 0 (`up`: the z ≥ 0 half), as the build cuts the fat: its own
 * surface vertices, and a flat cap with SEPARATE vertices (rim duplicates and a centre) facing across the plane.
 * Positions are stored relative to `offset`.
 */
function hemisphere(up: boolean, offset: [number, number, number]): DeflatePart & { rim: number[]; capRim: number[]; capCentre: number; pole: number } {
  const s = up ? 1 : -1;
  const pos: number[] = [];
  const idx: number[] = [];
  const put = (x: number, y: number, z: number) => {
    pos.push(x - offset[0], y - offset[1], z - offset[2]);
    return pos.length / 3 - 1;
  };
  // rings from the equator (k = 0) toward the pole, then the pole
  const ring: number[][] = [];
  for (let k = 0; k < RINGS; k += 1) {
    const lat = (k / RINGS) * (Math.PI / 2);
    const r = [] as number[];
    for (let j = 0; j < SEG; j += 1) {
      const t = (2 * Math.PI * j) / SEG;
      r.push(put(Math.cos(lat) * Math.cos(t), Math.cos(lat) * Math.sin(t), s * Math.sin(lat)));
    }
    ring.push(r);
  }
  const pole = put(0, 0, s);
  // outward winding (counter-clockwise seen from outside)
  const tri = (a: number, b: number, c: number) => (up ? idx.push(a, b, c) : idx.push(a, c, b));
  for (let k = 0; k + 1 < RINGS; k += 1)
    for (let j = 0; j < SEG; j += 1) {
      const a = ring[k]![j]!;
      const b = ring[k]![(j + 1) % SEG]!;
      const c = ring[k + 1]![j]!;
      const d = ring[k + 1]![(j + 1) % SEG]!;
      tri(a, b, d);
      tri(a, d, c);
    }
  for (let j = 0; j < SEG; j += 1) tri(ring[RINGS - 1]![j]!, ring[RINGS - 1]![(j + 1) % SEG]!, pole);
  // the cap: its own rim vertices and a centre, a fan facing away from the half (−z for the upper half)
  const capRim: number[] = [];
  for (let j = 0; j < SEG; j += 1) {
    const t = (2 * Math.PI * j) / SEG;
    capRim.push(put(Math.cos(t), Math.sin(t), 0));
  }
  const capCentre = put(0, 0, 0);
  for (let j = 0; j < SEG; j += 1) tri(capRim[(j + 1) % SEG]!, capRim[j]!, capCentre);
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), offset, rim: ring[0]!, capRim, capCentre, pole };
}

const dir = (d: Float32Array, i: number): [number, number, number] => [d[i * 3]!, d[i * 3 + 1]!, d[i * 3 + 2]!];

describe('fat deflate directions (aDeflate)', () => {
  const top = hemisphere(true, [0, 0, 0.5]);
  const bottom = hemisphere(false, [0.2, -0.1, -0.3]);
  const cut = { point: [0, 0, 0] as const, normal: [0, 0, 1] as const };
  const [dTop, dBottom] = deflateDirections([top, bottom], cut, { weld: 1e-4, onPlane: 1e-4, band: 0.2 });

  it('moves a seam point identically in both halves, and on the cap and the side of its own half', () => {
    for (let j = 0; j < SEG; j += 1) {
      const a = dir(dTop!, top.rim[j]!);
      const b = dir(dBottom!, bottom.rim[j]!);
      const capA = dir(dTop!, top.capRim[j]!);
      const capB = dir(dBottom!, bottom.capRim[j]!);
      for (let c = 0; c < 3; c += 1) {
        expect(b[c]).toBeCloseTo(a[c]!, 6);
        expect(capA[c]).toBeCloseTo(a[c]!, 6);
        expect(capB[c]).toBeCloseTo(a[c]!, 6);
      }
    }
  });

  it('keeps the seam in the cut plane, pulling it straight in toward the axis', () => {
    for (let j = 0; j < SEG; j += 1) {
      const [x, y, z] = dir(dTop!, top.rim[j]!);
      const t = (2 * Math.PI * j) / SEG;
      expect(z).toBeCloseTo(0, 6);
      expect(x * Math.cos(t) + y * Math.sin(t)).toBeGreaterThan(0.99); // radial (outward normal)
    }
  });

  it('follows the outer normal away from the cut and leaves a cap-only point still', () => {
    expect(dir(dTop!, top.pole)[2]).toBeGreaterThan(0.99);
    expect(dir(dBottom!, bottom.pole)[2]).toBeLessThan(-0.99);
    expect(dir(dTop!, top.capCentre)).toEqual([0, 0, 0]);
  });

  it('welds the parts without a cut and projects nothing', () => {
    const [a, b] = deflateDirections([top, bottom], null);
    const p = dir(a!, top.rim[3]!);
    const q = dir(b!, bottom.rim[3]!);
    for (let c = 0; c < 3; c += 1) expect(q[c]).toBeCloseTo(p[c]!, 6);
    // without a cut the two caps count as surface too; back to back, they cancel
    expect(Math.hypot(...p)).toBeCloseTo(1, 6);
    expect(p[2]).toBeCloseTo(0, 6);
  });
});
