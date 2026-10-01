/**
 * Pull direction of the epicardial fat (`aDeflate`, read by the fat shader for tissue.ts `FAT_DEFLATE`).
 *
 * The fat comes cut in two at the heart's plane (anterior / posterior halves, each closed by a flat cap). Pulled
 * in along each half's own vertex normals, the cap sank 1.2 mm into each half and the rims of the two halves,
 * whose normals differ at the seam, pulled apart: the posterior cap then showed through as a long, straight pale
 * line across the diaphragmatic surface. The pull is instead a function of POSITION only: the outer normal of
 * the fat averaged over the surface faces of every part around a welded point (never a cap face), so a seam
 * vertex moves identically in either half and on the cap and the side of its own half. Within `band` of the cut
 * plane the pull loses its component across the plane (fully on it), so each cut face stays flat, flush with
 * the wall's own cut face when the halves open. Pure (unit tested in fatDeflate.test.ts).
 */

export interface DeflatePart {
  /** Vertex positions, xyz, in the part's own frame. */
  positions: ArrayLike<number>;
  /** Triangle indices, or null for a non-indexed mesh. */
  index: ArrayLike<number> | null;
  /** Translation from the part's frame to the shared rest frame. */
  offset: readonly [number, number, number];
}

export interface DeflateCut {
  point: readonly [number, number, number];
  /** Unit normal of the cut plane. */
  normal: readonly [number, number, number];
}

export interface DeflateOptions {
  /** Points closer than this are one point (scene units). */
  weld?: number;
  /** A vertex this close to the cut plane lies on it (scene units). */
  onPlane?: number;
  /** Width of the fade from "in the plane" to the free normal (scene units). */
  band?: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Welds points of several parts in the rest frame: the id of each vertex's point. */
function weldParts(parts: readonly DeflatePart[], weld: number): { ids: Int32Array[]; count: number } {
  const cells = new Map<string, number[]>();
  const pts: number[] = [];
  const ids: Int32Array[] = [];
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const part of parts) {
    const n = Math.floor(part.positions.length / 3);
    const out = new Int32Array(n);
    const [ox, oy, oz] = part.offset;
    for (let i = 0; i < n; i += 1) {
      const x = part.positions[i * 3]! + ox;
      const y = part.positions[i * 3 + 1]! + oy;
      const z = part.positions[i * 3 + 2]! + oz;
      const cx = Math.floor(x / weld);
      const cy = Math.floor(y / weld);
      const cz = Math.floor(z / weld);
      let found = -1;
      for (let dx = -1; dx <= 1 && found < 0; dx += 1)
        for (let dy = -1; dy <= 1 && found < 0; dy += 1)
          for (let dz = -1; dz <= 1 && found < 0; dz += 1) {
            for (const id of cells.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
              const ex = pts[id * 3]! - x;
              const ey = pts[id * 3 + 1]! - y;
              const ez = pts[id * 3 + 2]! - z;
              if (ex * ex + ey * ey + ez * ez <= weld * weld) {
                found = id;
                break;
              }
            }
          }
      if (found < 0) {
        found = pts.length / 3;
        pts.push(x, y, z);
        const k = key(cx, cy, cz);
        const list = cells.get(k);
        if (list) list.push(found);
        else cells.set(k, [found]);
      }
      out[i] = found;
    }
    ids.push(out);
  }
  return { ids, count: pts.length / 3 };
}

/**
 * Per-vertex pull direction (xyz, length ≤ 1) for each part: the area-weighted outer normal at the vertex's welded
 * point over all parts' non-cap faces; within `band` of the cut plane its component across the plane fades out.
 */
export function deflateDirections(parts: readonly DeflatePart[], cut: DeflateCut | null, options: DeflateOptions = {}): Float32Array[] {
  const weld = options.weld ?? 1e-4;
  const onPlane = options.onPlane ?? 2e-4;
  const band = options.band ?? 0.02;
  const { ids, count } = weldParts(parts, weld);
  const acc = new Float64Array(count * 3);
  const side = (x: number, y: number, z: number) =>
    cut ? cut.normal[0] * (x - cut.point[0]) + cut.normal[1] * (y - cut.point[1]) + cut.normal[2] * (z - cut.point[2]) : Infinity;

  parts.forEach((part, k) => {
    const P = part.positions;
    const [ox, oy, oz] = part.offset;
    const n = Math.floor(P.length / 3);
    const tri = part.index ? part.index.length : n;
    const at = (t: number) => (part.index ? part.index[t]! : t);
    for (let t = 0; t + 2 < tri; t += 3) {
      const a = at(t);
      const b = at(t + 1);
      const c = at(t + 2);
      const ux = P[b * 3]! - P[a * 3]!;
      const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
      const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const vx = P[c * 3]! - P[a * 3]!;
      const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
      const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
      // area-weighted face normal (twice the area)
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      if (cut) {
        // a cap: all three corners on the plane (its normal then lies across the plane)
        const onA = Math.abs(side(P[a * 3]! + ox, P[a * 3 + 1]! + oy, P[a * 3 + 2]! + oz)) <= onPlane;
        const onB = Math.abs(side(P[b * 3]! + ox, P[b * 3 + 1]! + oy, P[b * 3 + 2]! + oz)) <= onPlane;
        const onC = Math.abs(side(P[c * 3]! + ox, P[c * 3 + 1]! + oy, P[c * 3 + 2]! + oz)) <= onPlane;
        if (onA && onB && onC) continue;
      }
      for (const v of [a, b, c]) {
        const id = ids[k]![v]!;
        acc[id * 3] += nx;
        acc[id * 3 + 1] += ny;
        acc[id * 3 + 2] += nz;
      }
    }
  });

  return parts.map((part, k) => {
    const P = part.positions;
    const [ox, oy, oz] = part.offset;
    const n = Math.floor(P.length / 3);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const id = ids[k]![i]!;
      let x = acc[id * 3]!;
      let y = acc[id * 3 + 1]!;
      let z = acc[id * 3 + 2]!;
      const len = Math.hypot(x, y, z);
      if (len === 0) continue; // only on caps: stays put
      x /= len;
      y /= len;
      z /= len;
      if (cut) {
        const s = Math.abs(side(P[i * 3]! + ox, P[i * 3 + 1]! + oy, P[i * 3 + 2]! + oz));
        const w = 1 - smoothstep(onPlane, band, s);
        const d = (x * cut.normal[0] + y * cut.normal[1] + z * cut.normal[2]) * w;
        x -= d * cut.normal[0];
        y -= d * cut.normal[1];
        z -= d * cut.normal[2];
      }
      out[i * 3] = x;
      out[i * 3 + 1] = y;
      out[i * 3 + 2] = z;
    }
    return out;
  });
}
