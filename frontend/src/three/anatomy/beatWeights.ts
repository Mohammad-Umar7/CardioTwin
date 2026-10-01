/**
 * Per-vertex beat weights for the great vessels (`aBeatW`, read by the beat shader in beatDeform.ts).
 *
 * A great vessel moves with the heart where it joins it and stays still far from it: the weight is 1 within
 * `full` of the junction and fades to 0 at `fade`, the distance measured ALONG THE VESSEL'S OWN WALL (geodesic
 * distance on the welded mesh graph). Measuring along the wall matters: the descending aorta passes a few
 * millimetres behind the left atrium but is a long way of aorta from the aortic root, so it must not move.
 * Junction seeds are the vessel vertices within `touch` of the heart wall (rest frame); an artery seeds only at
 * its root (below `maxSeedHeight`), so a vessel that merely brushes an atrium elsewhere is not dragged along.
 * Pure (unit tested in beatWeights.test.ts).
 */

/** Points in a uniform grid for "is anything within r of (x, y, z)?" queries. */
export class PointHash {
  private readonly cells = new Map<string, number[]>();

  constructor(readonly cell: number) {}

  private key(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  add(points: ArrayLike<number>, offset: readonly [number, number, number] = [0, 0, 0]): void {
    const c = this.cell;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const x = points[i]! + offset[0];
      const y = points[i + 1]! + offset[1];
      const z = points[i + 2]! + offset[2];
      const k = this.key(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c));
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(x, y, z);
    }
  }

  /** True when a stored point lies within r (≤ cell) of (x, y, z). */
  near(x: number, y: number, z: number, r: number): boolean {
    const c = this.cell;
    const cx = Math.floor(x / c);
    const cy = Math.floor(y / c);
    const cz = Math.floor(z / c);
    const r2 = r * r;
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1) {
          const arr = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
          if (!arr) continue;
          for (let j = 0; j < arr.length; j += 3) {
            const ex = arr[j]! - x;
            const ey = arr[j + 1]! - y;
            const ez = arr[j + 2]! - z;
            if (ex * ex + ey * ey + ez * ez <= r2) return true;
          }
        }
    return false;
  }
}

export interface VesselWeightOptions {
  /** Weight 1 up to this distance along the wall from the junction (scene units). */
  full: number;
  /** Weight 0 from this distance on (scene units). */
  fade: number;
  /** A vessel vertex within this distance of the heart wall seeds the junction (scene units). */
  touch: number;
  /** Seeds must lie below this normalised height (arteries: their root only). */
  maxSeedHeight?: number;
}

/** Binary min-heap of (distance, node). */
class MinHeap {
  private readonly d: number[] = [];
  private readonly n: number[] = [];

  get size(): number {
    return this.d.length;
  }

  push(dist: number, node: number): void {
    const d = this.d;
    const n = this.n;
    d.push(dist);
    n.push(node);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p]! <= d[i]!) break;
      [d[p], d[i]] = [d[i]!, d[p]!];
      [n[p], n[i]] = [n[i]!, n[p]!];
      i = p;
    }
  }

  pop(): [number, number] {
    const d = this.d;
    const n = this.n;
    const top: [number, number] = [d[0]!, n[0]!];
    const lastD = d.pop()!;
    const lastN = n.pop()!;
    if (d.length > 0) {
      d[0] = lastD;
      n[0] = lastN;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < d.length && d[l]! < d[m]!) m = l;
        if (r < d.length && d[r]! < d[m]!) m = r;
        if (m === i) break;
        [d[m], d[i]] = [d[i]!, d[m]!];
        [n[m], n[i]] = [n[i]!, n[m]!];
        i = m;
      }
    }
    return top;
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface WeldedGraph {
  /** Graph node of each mesh vertex (coincident vertices share one). */
  nodeOf: Int32Array;
  /** Node positions, xyz. */
  nodePos: number[];
  /** Neighbouring nodes along the triangle edges. */
  adj: number[][];
}

/**
 * The mesh as a graph of welded vertices: coincident vertices (normal / UV seams) become one node, so the graph
 * follows the surface across seams. `q` is the weld tolerance (scene units).
 */
export function weldGraph(positions: ArrayLike<number>, index: ArrayLike<number> | null, q: number): WeldedGraph {
  const count = Math.floor(positions.length / 3);
  const ids = new Map<string, number>();
  const nodeOf = new Int32Array(count);
  const nodePos: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const k = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = nodePos.length / 3;
      ids.set(k, id);
      nodePos.push(x, y, z);
    }
    nodeOf[i] = id;
  }
  const adj: number[][] = Array.from({ length: nodePos.length / 3 }, () => []);
  const link = (a: number, b: number) => {
    if (a === b) return;
    adj[a]!.push(b);
    adj[b]!.push(a);
  };
  const tris = index ? Math.floor(index.length / 3) : Math.floor(count / 3);
  for (let t = 0; t < tris; t += 1) {
    const a = nodeOf[index ? index[t * 3]! : t * 3]!;
    const b = nodeOf[index ? index[t * 3 + 1]! : t * 3 + 1]!;
    const c = nodeOf[index ? index[t * 3 + 2]! : t * 3 + 2]!;
    link(a, b);
    link(b, c);
    link(c, a);
  }
  return { nodeOf, nodePos, adj };
}

/** Connected component of each graph node (0-based, in discovery order). */
export function graphComponents(adj: readonly number[][]): Int32Array {
  const comp = new Int32Array(adj.length).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < adj.length; s += 1) {
    if (comp[s] !== -1) continue;
    comp[s] = next;
    stack.push(s);
    while (stack.length > 0) {
      const n = stack.pop()!;
      for (const m of adj[n]!) {
        if (comp[m] === -1) {
          comp[m] = next;
          stack.push(m);
        }
      }
    }
    next += 1;
  }
  return comp;
}

/**
 * Beat weight per vertex of one vessel mesh. `positions` are the vertices in the heart's rest frame (xyz),
 * `index` the triangle list (null = non-indexed triangles), `wall` the heart wall, `height` the normalised height
 * of a rest-frame point (beatDeform.heightOf). Vertices the junction cannot reach (another component, or a
 * vessel that never touches the heart) get 0. If nothing touches within `touch`, the radius doubles up to 4×
 * before giving up (a vessel cut a little short of its chamber still follows it).
 */
export function vesselBeatWeights(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  wall: PointHash,
  height: (x: number, y: number, z: number) => number,
  opts: VesselWeightOptions,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const { nodeOf, nodePos, adj } = weldGraph(positions, index, Math.max(opts.touch * 0.02, 1e-9));
  const nodes = nodePos.length / 3;

  // Seeds: where the vessel touches the heart wall (its root only, for an artery).
  const dist = new Float64Array(nodes).fill(Number.POSITIVE_INFINITY);
  const heap = new MinHeap();
  for (let scale = 1; scale <= 4 && heap.size === 0; scale *= 2) {
    const r = opts.touch * scale;
    for (let n = 0; n < nodes; n += 1) {
      const x = nodePos[n * 3]!;
      const y = nodePos[n * 3 + 1]!;
      const z = nodePos[n * 3 + 2]!;
      if (opts.maxSeedHeight !== undefined && height(x, y, z) > opts.maxSeedHeight) continue;
      if (r > wall.cell ? false : wall.near(x, y, z, r)) {
        dist[n] = 0;
        heap.push(0, n);
      }
    }
    if (r > wall.cell) break;
  }

  // Dijkstra along the wall, pruned at the fade distance.
  while (heap.size > 0) {
    const [d, n] = heap.pop();
    if (d > dist[n]! || d >= opts.fade) continue;
    const nx = nodePos[n * 3]!;
    const ny = nodePos[n * 3 + 1]!;
    const nz = nodePos[n * 3 + 2]!;
    for (const m of adj[n]!) {
      const ex = nodePos[m * 3]! - nx;
      const ey = nodePos[m * 3 + 1]! - ny;
      const ez = nodePos[m * 3 + 2]! - nz;
      const nd = d + Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (nd < dist[m]!) {
        dist[m] = nd;
        heap.push(nd, m);
      }
    }
  }

  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const d = dist[nodeOf[i]!]!;
    out[i] = Number.isFinite(d) ? 1 - smoothstep(opts.full, opts.fade, d) : 0;
  }
  return out;
}
