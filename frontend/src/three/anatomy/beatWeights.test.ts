import { describe, expect, it } from 'vitest';
import { PointHash, vesselBeatWeights } from './beatWeights';

const SEG = 12;

/** A tube of radius r swept along a polyline in the xy-plane (rings perpendicular to the path). */
function tubeAlong(path: [number, number][], step = 0.025, r = 0.04) {
  const centres: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let k = 0; k + 1 < path.length; k += 1) {
    const [x0, y0] = path[k]!;
    const [x1, y1] = path[k + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = k === 0 ? 0 : 1; i <= n; i += 1) centres.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, dx: (x1 - x0) / len, dy: (y1 - y0) / len });
  }
  const pos: number[] = [];
  for (const c of centres) {
    // u = dir × z (in the xy-plane), v = z
    const ux = c.dy;
    const uy = -c.dx;
    for (let j = 0; j < SEG; j += 1) {
      const t = (2 * Math.PI * j) / SEG;
      pos.push(c.x + r * Math.cos(t) * ux, c.y + r * Math.cos(t) * uy, r * Math.sin(t));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < centres.length; i += 1)
    for (let j = 0; j < SEG; j += 1) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c = (i + 1) * SEG + j;
      const d = (i + 1) * SEG + ((j + 1) % SEG);
      idx.push(a, b, c, b, d, c);
    }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), rings: centres.length };
}

/** A dense patch of "heart wall" points in the plane y = yWall. */
function wallAt(yWall: number, cell: number) {
  const pts: number[] = [];
  for (let x = -0.3; x <= 0.6; x += 0.01) for (let z = -0.2; z <= 0.2; z += 0.01) pts.push(x, yWall, z);
  const h = new PointHash(cell);
  h.add(pts);
  return h;
}

const ringWeight = (w: Float32Array, ring: number) => w[ring * SEG]!;
const flat = () => 1;

describe('great-vessel beat weights (aBeatW)', () => {
  it('is 1 at the junction, fades along the vessel and is 0 far along it', () => {
    const { pos, idx, rings } = tubeAlong([
      [0, 0],
      [0, 1],
    ]);
    const w = vesselBeatWeights(pos, idx, wallAt(-0.01, 0.08), flat, { full: 0.1, fade: 0.5, touch: 0.02 });
    expect(ringWeight(w, 0)).toBe(1);
    expect(ringWeight(w, 3)).toBe(1); // 0.075 along: inside `full`
    const mid = ringWeight(w, 12); // 0.3 along
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(ringWeight(w, 20)).toBe(0); // 0.5 along
    expect(ringWeight(w, rings - 1)).toBe(0);
    for (let i = 1; i < rings; i += 1) expect(ringWeight(w, i)).toBeLessThanOrEqual(ringWeight(w, i - 1));
  });

  it('measures along the vessel wall: a far stretch that brushes the heart elsewhere stays still', () => {
    // Up from the wall, across, and back down to touch the wall again 2.25 along the vessel: like the
    // descending aorta passing behind the left atrium a long way of aorta from the root.
    const { pos, idx, rings } = tubeAlong([
      [0, 0],
      [0, 1],
      [0.25, 1],
      [0.25, 0],
    ]);
    const height = (x: number) => (x > 0.2 ? 2 : 1);
    const w = vesselBeatWeights(pos, idx, wallAt(-0.01, 0.08), height, { full: 0.1, fade: 0.5, touch: 0.02, maxSeedHeight: 1.5 });
    expect(ringWeight(w, 0)).toBe(1);
    expect(ringWeight(w, rings - 1)).toBe(0);
    // Without the root-only rule the second touch would seed too.
    const loose = vesselBeatWeights(pos, idx, wallAt(-0.01, 0.08), height, { full: 0.1, fade: 0.5, touch: 0.02 });
    expect(ringWeight(loose, rings - 1)).toBe(1);
  });

  it('widens the touch radius for a vessel cut a little short of its chamber', () => {
    const { pos, idx } = tubeAlong([
      [0, 0.03],
      [0, 1],
    ]);
    // The first ring lies 0.035 above the wall (beyond `touch` = 0.02, within 2× = 0.04).
    const w = vesselBeatWeights(pos, idx, wallAt(-0.005, 0.08), flat, { full: 0.1, fade: 0.5, touch: 0.02 });
    expect(ringWeight(w, 0)).toBe(1);
  });

  it('gives a vessel that never reaches the heart 0 everywhere', () => {
    const { pos, idx } = tubeAlong([
      [3, 3],
      [3, 4],
    ]);
    const w = vesselBeatWeights(pos, idx, wallAt(-0.01, 0.08), flat, { full: 0.1, fade: 0.5, touch: 0.02 });
    expect(Math.max(...w)).toBe(0);
  });

  it('welds coincident vertices, so a seam in the mesh does not cut the vessel in two', () => {
    const { pos, idx, rings } = tubeAlong([
      [0, 0],
      [0, 0.6],
    ]);
    // Duplicate ring 10 (an unwelded UV seam): the second half indexes the copy.
    const dupStart = pos.length / 3;
    const pos2 = new Float32Array(pos.length + SEG * 3);
    pos2.set(pos);
    pos2.set(pos.slice(10 * SEG * 3, 11 * SEG * 3), pos.length);
    const idx2 = Uint32Array.from(idx, (v, k) => (k >= 10 * SEG * 6 && v >= 10 * SEG && v < 11 * SEG ? dupStart + (v - 10 * SEG) : v));
    const w = vesselBeatWeights(pos2, idx2, wallAt(-0.01, 0.08), flat, { full: 0.1, fade: 1, touch: 0.02 });
    // Unwelded, everything past the seam would be unreachable (0); welded, it fades smoothly past it.
    expect(ringWeight(w, 14)).toBeGreaterThan(0.5);
    expect(ringWeight(w, rings - 1)).toBeGreaterThan(0);
    expect(ringWeight(w, rings - 1)).toBeLessThan(ringWeight(w, 14));
  });
});
