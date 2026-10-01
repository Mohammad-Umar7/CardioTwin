import { describe, expect, it } from 'vitest';
import { straightCutDistance } from './vesselCuts';

const SEG = 16;

/** A straight tube along `dir` from `start`, `rings` rings `step` apart, with a noisy geodesic `along`. */
function tube(start: [number, number, number], dir: [number, number, number], rings = 30, step = 0.01, r = 0.02) {
  const len = Math.hypot(...dir);
  const d = dir.map((v) => v / len) as [number, number, number];
  // any two unit vectors perpendicular to d
  const a: [number, number, number] = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const ul = Math.hypot(...u);
  const uu = u.map((v) => v / ul);
  const vv = [d[1] * uu[2]! - d[2] * uu[1]!, d[2] * uu[0]! - d[0] * uu[2]!, d[0] * uu[1]! - d[1] * uu[0]!];
  const pos: number[] = [];
  const along: number[] = [];
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < SEG; j += 1) {
      const t = (2 * Math.PI * j) / SEG;
      const s = i * step;
      for (let k = 0; k < 3; k += 1) pos.push(start[k]! + d[k]! * s + r * (Math.cos(t) * uu[k]! + Math.sin(t) * vv[k]!));
      // the published field: right on average, but ±40 % of a ring step out of true round each ring
      along.push(s + 0.4 * step * Math.sin(3 * t + i));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < rings; i += 1)
    for (let j = 0; j < SEG; j += 1) {
      const p = i * SEG + j;
      const q = i * SEG + ((j + 1) % SEG);
      idx.push(p, q, p + SEG, q, q + SEG, p + SEG);
    }
  return { pos, idx, along };
}

// The bands hold whole rings of the test tubes (each ring's published value is off by up to ±0.004).
const OPTS = { rootBand: 0.005, axisBand: [0.045, 0.125] as const, margin: 0.1 };

describe('specimen cuts for the pulmonary vessels', () => {
  it('cuts each ring at one distance: the cut is a clean plane across the vessel', () => {
    const t = tube([0, 0, 0], [0.3, 1, 0.2]);
    const out = straightCutDistance(t.pos, t.idx, t.along, OPTS);
    for (let i = 0; i < 30; i += 1) {
      const ring = Array.from(out.slice(i * SEG, (i + 1) * SEG));
      // every vertex of a ring is the same distance past the root (the noisy published field was not)
      expect(Math.max(...ring) - Math.min(...ring)).toBeLessThan(1e-6);
      expect(ring[0]).toBeCloseTo(i * 0.01, 4);
    }
  });

  it('cuts every vessel of a mesh across its own direction', () => {
    const a = tube([0, 0, 0], [0, 1, 0]);
    const b = tube([1, 0, 0], [1, 0, 0.5]); // a second vein, another direction
    const pos = [...a.pos, ...b.pos];
    const idx = [...a.idx, ...b.idx.map((v) => v + a.pos.length / 3)];
    const out = straightCutDistance(pos, idx, [...a.along, ...b.along], OPTS);
    for (const off of [0, a.pos.length / 3]) {
      const ring = Array.from(out.slice(off + 12 * SEG, off + 13 * SEG));
      expect(Math.max(...ring) - Math.min(...ring)).toBeLessThan(1e-6);
      expect(ring[0]).toBeCloseTo(0.12, 4);
    }
  });

  it('still trims a branch that curves back toward the heart far from the root', () => {
    const t = tube([0, 0, 0], [0, 1, 0]);
    const along = t.along.map((v, i) => (i >= 25 * SEG ? 0.6 : v)); // far along the tree, close in space
    const pos = t.pos.map((v, i) => (Math.floor(i / 3) >= 25 * SEG && i % 3 === 1 ? 0.02 : v));
    const out = straightCutDistance(pos, t.idx, along, OPTS);
    expect(out[26 * SEG]).toBeGreaterThan(0.45);
  });

  it('keeps the published value for a piece it cannot orient', () => {
    const t = tube([0, 0, 0], [0, 1, 0], 3); // too short to reach the axis band
    const out = straightCutDistance(t.pos, t.idx, t.along, OPTS);
    expect(Array.from(out)).toEqual(t.along.map((v) => Math.fround(v)));
  });
});
