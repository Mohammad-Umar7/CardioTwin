import { describe, expect, it } from 'vitest';
import { FAT_REACH, GROOVE_REACH, PointGrid, adjacency, cavityAttribute, concavity } from './cavity';

/** An (n × n) height-field grid in the xz plane with y = h(x, z), true normals, two triangles per quad. */
function grid(n: number, h: (x: number, z: number) => number, extent = 1) {
  const e = 1e-4;
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1) {
      const x = ((i / (n - 1)) * 2 - 1) * extent;
      const z = ((j / (n - 1)) * 2 - 1) * extent;
      positions.push(x, h(x, z), z);
      const gx = (h(x + e, z) - h(x - e, z)) / (2 * e);
      const gz = (h(x, z + e) - h(x, z - e)) / (2 * e);
      const len = Math.hypot(gx, 1, gz);
      normals.push(-gx / len, 1 / len, -gz / len);
    }
  for (let i = 0; i < n - 1; i += 1)
    for (let j = 0; j < n - 1; j += 1) {
      const a = i * n + j;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  return { positions, normals, index, vertexCount: n * n };
}

const centre = (n: number) => Math.floor(n / 2) * n + Math.floor(n / 2);

describe('cavity attribute', () => {
  it('builds a symmetric one-ring adjacency', () => {
    const g = grid(3, () => 0);
    const { offsets, neighbours } = adjacency(g.index, g.vertexCount);
    const mid = centre(3);
    const ring = new Set(neighbours.slice(offsets[mid]!, offsets[mid + 1]!));
    expect(ring.size).toBe(6);
    for (const v of ring) expect([...neighbours.slice(offsets[v]!, offsets[v + 1]!)]).toContain(mid);
  });

  it('is zero on a plane and on a convex dome, positive at the bottom of a groove', () => {
    const n = 21;
    const flat = concavity(grid(n, () => 0));
    expect(Math.max(...flat)).toBe(0);
    const dome = concavity(grid(n, (x, z) => -(x * x + z * z) * 0.5));
    expect(dome[centre(n)]).toBe(0);
    // A 7 mm-radius crease sampled at 1 mm (the heart mesh's resolution): y = x² / (2R).
    const fine = 61;
    const groove = concavity(grid(fine, (x) => x * x * 7, 0.3));
    expect(groove[centre(fine)]!).toBeGreaterThan(0.2);
    expect(groove[centre(fine)]!).toBeLessThanOrEqual(1);
    // A gentle 5 cm bowl is not a crease.
    const bowl = concavity(grid(fine, (x, z) => (x * x + z * z) * 1, 0.3));
    expect(bowl[centre(fine)]!).toBeLessThan(0.05);
  });

  it('marks the groove and the fat band next to a coronary centreline, and nothing far away', () => {
    const n = 41;
    const g = grid(n, () => 0);
    const line = Array.from({ length: 41 }, (_, i) => ({ x: 0, y: 0.01, z: (i / 40) * 2 - 1, r: 0.012 }));
    const attr = cavityAttribute(g, line);
    const at = (x: number) => {
      const i = Math.round(((x + 1) / 2) * (n - 1));
      return i * n + Math.floor(n / 2);
    };
    expect(attr[at(0) * 3 + 1]!).toBeCloseTo(1, 6);
    expect(attr[at(0) * 3 + 2]!).toBeCloseTo(1, 6);
    expect(attr[at(0.5) * 3 + 1]).toBe(0);
    expect(attr[at(0.5) * 3 + 2]).toBe(0);
    expect(GROOVE_REACH).toBeLessThan(FAT_REACH);
  });

  it('finds the nearest lumen through the spatial hash', () => {
    const g = new PointGrid([{ x: 0, y: 0, z: 0, r: 0.01 }], 0.05);
    expect(g.clearance(0.03, 0, 0)).toBeCloseTo(0.02, 9);
    expect(g.clearance(1, 1, 1)).toBe(Infinity);
  });
});
