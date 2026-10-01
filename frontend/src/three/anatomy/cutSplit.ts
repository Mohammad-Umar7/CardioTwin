/**
 * Nodes that straddle the heart's cut plane are split at load (rig.ts `splitAtCutPlane`), like a real
 * specimen cut in two: the part on the opening side (+cut normal) becomes a sibling `<node>_Anterior` that
 * rides the anterior half, the rest stays on the posterior half. Pure helpers shared by everything that
 * follows a split node by its centreline (flow particles, the overlay, label anchors, pick proxies).
 */
import type { Vector3 } from 'three';

/** Suffix of the sibling that carries the opening-side part of a split node. */
export const ANTERIOR_SUFFIX = '_Anterior';

/**
 * Split at the cut plane: the cardiac veins (the AIV and anterior veins open with the anterior half), the
 * LAD (the anterior interventricular groove belongs to the anterior half, its proximal stretch at the left
 * main and its apical wrap stay posterior) and the RCA (the right AV groove opens with the anterior half,
 * its crux end stays posterior).
 */
export const SPLIT_AT_CUT: readonly string[] = ['CardiacVeins', 'Coronary_LAD', 'Coronary_RCA'];

/**
 * Split by whole piece instead of at the plane: each papillary muscle opens with the wall it grows from (the
 * anterolateral and the right-ventricular anterior muscles with the anterior half), whole, like a bivalved
 * specimen; their chordae stay cut on the leaflets. Left whole on the posterior half, the anterior-rooted muscles
 * hung loose in the opened chambers.
 */
export const SPLIT_BY_PIECE: readonly string[] = ['Papillary_Muscles'];

export interface CutPlane {
  cutPoint: Vector3;
  cutNormal: Vector3;
}

type Point = ArrayLike<number>;

/** Signed distance of a rest-frame point from the cut plane (> 0 = the opening, anterior side). */
export function cutSide(cut: CutPlane, p: Point): number {
  const n = cut.cutNormal;
  const o = cut.cutPoint;
  return n.x * ((p[0] ?? 0) - o.x) + n.y * ((p[1] ?? 0) - o.y) + n.z * ((p[2] ?? 0) - o.z);
}

export const isSplitNode = (node: string): boolean => SPLIT_AT_CUT.includes(node);

/** The node that carries point `p` of `node`'s centreline once split (the node itself when not split). */
export function nodeAt(cut: CutPlane | null, node: string, p: Point): string {
  return cut && isSplitNode(node) && cutSide(cut, p) > 0 ? `${node}${ANTERIOR_SUFFIX}` : node;
}

/** The GLB node a (possibly split) scene node was cut from. */
export function baseNode(name: string): string {
  if (!name.endsWith(ANTERIOR_SUFFIX)) return name;
  const base = name.slice(0, -ANTERIOR_SUFFIX.length);
  return isSplitNode(base) ? base : name;
}

/**
 * Split a centreline's segments into runs that lie on one side of the cut (each run shares its first point
 * with the previous one, so the two proxies meet at the plane). Returns the posterior and anterior runs.
 */
export function splitSegments<S extends { points: readonly Point[]; radius?: readonly number[] }>(
  cut: CutPlane,
  segments: readonly S[],
): { back: { points: Point[]; radius: number[] }[]; front: { points: Point[]; radius: number[] }[] } {
  const back: { points: Point[]; radius: number[] }[] = [];
  const front: { points: Point[]; radius: number[] }[] = [];
  for (const seg of segments) {
    let run: { points: Point[]; radius: number[] } | null = null;
    let side: boolean | null = null;
    seg.points.forEach((p, i) => {
      const f = cutSide(cut, p) > 0;
      const r = seg.radius?.[i] ?? 0.004;
      if (side !== f || !run) {
        const prev = run;
        run = { points: [], radius: [] };
        if (prev && prev.points.length > 0) {
          run.points.push(prev.points[prev.points.length - 1]!);
          run.radius.push(prev.radius[prev.radius.length - 1]!);
        }
        (f ? front : back).push(run);
        side = f;
      }
      run.points.push(p);
      run.radius.push(r);
    });
  }
  const keep = (runs: { points: Point[]; radius: number[] }[]) => runs.filter((r) => r.points.length >= 2);
  return { back: keep(back), front: keep(front) };
}
