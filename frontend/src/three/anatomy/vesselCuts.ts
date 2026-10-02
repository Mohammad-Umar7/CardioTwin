/**
 * Specimen cuts for the pulmonary vessels (pure; unit tested in vesselCuts.test.ts).
 *
 * The published `_dist_heart` (geodesic distance from the pulmonary valve / the left-atrial ostia) is too uneven
 * across a vessel to cut it cleanly: its iso-lines zig-zag, so a trunk or a vein trimmed at a fixed distance
 * ended in a ragged, torn-looking rim, and a vein cut by a sphere left a thin crescent that read as a claw on the
 * left atrium. Each vessel (each connected piece: the trunk, each pulmonary vein) is cut instead by a PLANE across
 * its root direction, like a scalpel: the root is where `_dist_heart` starts, the direction runs to the vessel's
 * centroid a short way along it. The value returned replaces `_dist_heart` for the viewer's cut (`ALONG_FADE`):
 * the distance past the root along that direction, or the geodesic distance minus a margin where that is larger,
 * so a branch that curves back toward the heart deep in the lung is still trimmed away.
 */
import { graphComponents, weldGraph } from './beatWeights';

export interface VesselCutOptions {
  /** The root: vertices whose `_dist_heart` is below this (scene units). */
  rootBand: number;
  /** The root direction runs to the centroid of the vessel between these `_dist_heart` values. */
  axisBand: readonly [number, number];
  /** Far from the root the geodesic value takes over, less this margin (scene units). */
  margin: number;
}

/** Where the descending aorta is cut (rig.ts): posterior of the AV-plane centre past `behind` and below `cutAbove`, or
 * anywhere below `floor` (scene units, heights from that centre). */
export interface DescendingCut {
  behind: number;
  cutAbove: number;
  floor: number;
}

/**
 * The aorta's cut depth (`_dist_heart`, cut where above 0): the descending limb behind the heart up to the arch, and
 * everything below the AV plane. Continuous (the larger / smaller of distances to the cut planes), so a triangle that
 * straddles the limb's boundary is cut at the boundary; a step there left the part of a long triangle short of its
 * interpolated zero standing as a flat sliver of the descending limb.
 */
export function descendingAortaCut(behind: number, up: number, cut: DescendingCut): number {
  return Math.max(Math.min(behind - cut.behind, cut.cutAbove - up), cut.floor - up);
}

/** Per-vertex cut distance (see the module comment). A piece without a root or an axis keeps `along`. */
export function straightCutDistance(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  along: ArrayLike<number>,
  opts: VesselCutOptions,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const { nodeOf, adj } = weldGraph(positions, index, 1e-6);
  const comp = graphComponents(adj);
  let pieces = 0;
  for (let n = 0; n < comp.length; n += 1) pieces = Math.max(pieces, comp[n]! + 1);
  const root = new Float64Array(pieces * 4);
  const axis = new Float64Array(pieces * 4);
  for (let i = 0; i < count; i += 1) {
    const c = comp[nodeOf[i]!]!;
    const a = along[i]!;
    const acc = a < opts.rootBand ? root : a >= opts.axisBand[0] && a <= opts.axisBand[1] ? axis : null;
    if (!acc) continue;
    acc[c * 4] += positions[i * 3]!;
    acc[c * 4 + 1] += positions[i * 3 + 1]!;
    acc[c * 4 + 2] += positions[i * 3 + 2]!;
    acc[c * 4 + 3] += 1;
  }
  // Root centre and unit direction per piece (NaN direction = no clean cut, keep `along`).
  const plane = new Float64Array(pieces * 6).fill(Number.NaN);
  for (let c = 0; c < pieces; c += 1) {
    const nr = root[c * 4 + 3]!;
    const na = axis[c * 4 + 3]!;
    if (nr === 0 || na === 0) continue;
    const ox = root[c * 4]! / nr;
    const oy = root[c * 4 + 1]! / nr;
    const oz = root[c * 4 + 2]! / nr;
    const dx = axis[c * 4]! / na - ox;
    const dy = axis[c * 4 + 1]! / na - oy;
    const dz = axis[c * 4 + 2]! / na - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) continue;
    plane.set([ox, oy, oz, dx / len, dy / len, dz / len], c * 6);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const c = comp[nodeOf[i]!]! * 6;
    const a = along[i]!;
    if (Number.isNaN(plane[c + 3]!)) {
      out[i] = a;
      continue;
    }
    const planar =
      (positions[i * 3]! - plane[c]!) * plane[c + 3]! +
      (positions[i * 3 + 1]! - plane[c + 1]!) * plane[c + 4]! +
      (positions[i * 3 + 2]! - plane[c + 2]!) * plane[c + 5]!;
    out[i] = Math.max(planar, a - opts.margin);
  }
  return out;
}
