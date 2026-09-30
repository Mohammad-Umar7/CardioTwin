/**
 * Per-vertex "cavity" attribute for the heart walls (pure; unit tested in cavity.test.ts). It gives the
 * Realistic look the contact darkness a real heart has without a baked AO map:
 *
 *   x — concavity: how far the one-ring neighbours rise above the vertex's tangent plane (grooves, the
 *       creases between atria, auricles and great-vessel roots), smoothed over two rings;
 *   y — vessel groove: 1 right next to a coronary centreline, fading over a few millimetres, so every
 *       artery sits in a shadowed groove instead of floating on the wall;
 *   z — epicardial fat: a wider band along the arteries (real coronaries run embedded in fat).
 *
 * Computed once per geometry at load, in O(V + E) plus a spatial hash over the centreline points.
 */

export interface CavityInput {
  /** xyz per vertex, rest frame (already offset by the mesh's rest translation). */
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Triangle indices (null = non-indexed). */
  index: ArrayLike<number> | null;
  vertexCount: number;
}

export interface CentrelinePoint {
  x: number;
  y: number;
  z: number;
  /** Lumen radius (scene units). */
  r: number;
}

/** Groove / fat reach beyond the lumen (scene units; 1 unit = 10 cm). */
export const GROOVE_REACH = 0.028;
export const FAT_REACH = 0.07;
/**
 * Concavity is measured as the mean neighbour rise over the squared edge length, ≈ 1 / (2R) for a groove
 * of radius R — independent of the mesh resolution. R ≈ 7 mm (κ ≈ 7) and tighter reads as a full crease.
 */
export const CONCAVITY_ONSET = 0.8;
export const CONCAVITY_FULL = 7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Undirected one-ring adjacency as CSR arrays. */
export function adjacency(index: ArrayLike<number> | null, vertexCount: number): { offsets: Uint32Array; neighbours: Uint32Array } {
  const triCount = index ? index.length / 3 : vertexCount / 3;
  const at = (i: number) => (index ? index[i]! : i);
  const degree = new Uint32Array(vertexCount);
  for (let t = 0; t < triCount; t += 1) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    degree[a]! += 2;
    degree[b]! += 2;
    degree[c]! += 2;
  }
  const offsets = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v += 1) offsets[v + 1] = offsets[v]! + degree[v]!;
  const fill = offsets.slice(0, vertexCount);
  const neighbours = new Uint32Array(offsets[vertexCount]!);
  const push = (v: number, n: number) => {
    neighbours[fill[v]!] = n;
    fill[v]! += 1;
  };
  for (let t = 0; t < triCount; t += 1) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    push(a, b);
    push(a, c);
    push(b, a);
    push(b, c);
    push(c, a);
    push(c, b);
  }
  return { offsets, neighbours };
}

/** Concavity per vertex in [0, 1] (0 = flat or convex). */
export function concavity(input: CavityInput, smoothingPasses = 2): Float32Array {
  const { positions: p, normals: n, vertexCount } = input;
  const { offsets, neighbours } = adjacency(input.index, vertexCount);
  let value = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const px = p[v * 3]!;
    const py = p[v * 3 + 1]!;
    const pz = p[v * 3 + 2]!;
    const nx = n[v * 3]!;
    const ny = n[v * 3 + 1]!;
    const nz = n[v * 3 + 2]!;
    let sum = 0;
    let count = 0;
    for (let k = offsets[v]!; k < offsets[v + 1]!; k += 1) {
      const j = neighbours[k]!;
      const dx = p[j * 3]! - px;
      const dy = p[j * 3 + 1]! - py;
      const dz = p[j * 3 + 2]! - pz;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-14) continue;
      sum += (dx * nx + dy * ny + dz * nz) / len2;
      count += 1;
    }
    value[v] = count > 0 ? Math.max(0, sum / count) : 0;
  }
  for (let pass = 0; pass < smoothingPasses; pass += 1) {
    const next = new Float32Array(vertexCount);
    for (let v = 0; v < vertexCount; v += 1) {
      let sum = value[v]!;
      let count = 1;
      for (let k = offsets[v]!; k < offsets[v + 1]!; k += 1) {
        sum += value[neighbours[k]!]!;
        count += 1;
      }
      next[v] = sum / count;
    }
    value = next;
  }
  for (let v = 0; v < vertexCount; v += 1) value[v] = smooth(CONCAVITY_ONSET, CONCAVITY_FULL, value[v]!);
  return value;
}

/** Spatial hash of centreline points for nearest-lumen queries. */
export class PointGrid {
  private readonly cells = new Map<string, CentrelinePoint[]>();
  constructor(
    points: readonly CentrelinePoint[],
    private readonly cell: number,
  ) {
    for (const q of points) {
      const key = this.key(Math.floor(q.x / cell), Math.floor(q.y / cell), Math.floor(q.z / cell));
      const list = this.cells.get(key);
      if (list) list.push(q);
      else this.cells.set(key, [q]);
    }
  }

  private key(i: number, j: number, k: number): string {
    return `${i},${j},${k}`;
  }

  /** Smallest (distance to the centreline − lumen radius) within one cell; Infinity when none. */
  clearance(x: number, y: number, z: number): number {
    const c = this.cell;
    const i0 = Math.floor(x / c);
    const j0 = Math.floor(y / c);
    const k0 = Math.floor(z / c);
    let best = Infinity;
    for (let i = i0 - 1; i <= i0 + 1; i += 1)
      for (let j = j0 - 1; j <= j0 + 1; j += 1)
        for (let k = k0 - 1; k <= k0 + 1; k += 1) {
          const list = this.cells.get(this.key(i, j, k));
          if (!list) continue;
          for (const q of list) {
            const d = Math.hypot(q.x - x, q.y - y, q.z - z) - q.r;
            if (d < best) best = d;
          }
        }
    return best;
  }
}

/**
 * The full cavity attribute (xyz per vertex, see the header). `centrelines` are in the same rest frame as
 * the positions.
 */
export function cavityAttribute(input: CavityInput, centrelines: readonly CentrelinePoint[]): Float32Array {
  const out = new Float32Array(input.vertexCount * 3);
  const conc = concavity(input);
  const grid = centrelines.length > 0 ? new PointGrid(centrelines, FAT_REACH) : null;
  const p = input.positions;
  for (let v = 0; v < input.vertexCount; v += 1) {
    out[v * 3] = conc[v]!;
    if (!grid) continue;
    const clearance = grid.clearance(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
    out[v * 3 + 1] = 1 - smooth(0, GROOVE_REACH, clearance);
    out[v * 3 + 2] = 1 - smooth(0.01, FAT_REACH, clearance);
  }
  return out;
}
