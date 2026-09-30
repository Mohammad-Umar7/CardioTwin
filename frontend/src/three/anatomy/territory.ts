/**
 * Supplied-territory correction for the right-ventricular free wall (pure; unit tested in territory.test.ts).
 *
 * The GLB's COLOR_0 weights (r = LAD, g = LCX, b = RCA) blend a nearest-artery map 85 % toward the AHA-17
 * standard territories — an LEFT-ventricular model — so on this heart the RV free wall came out ~85 % LAD,
 * contradicting the RCA's acute-marginal branch running over it (and its own hover). Anatomically the RV
 * free wall is supplied by the RCA (acute marginals, conus); the LAD keeps a narrow strip along the anterior
 * interventricular groove and the septum; the PDA the posterior groove.
 *
 * Around the heart's long axis, the RV lies on the arc from the anterior interventricular groove (the LAD's
 * course) to the posterior one (the PDA's) that contains the acute margin (the RCA marginal). Wall vertices
 * on that arc, away from the axis (not the septum), between the apex and the AV groove, move their weight to
 * the RCA — keeping each vertex's total weight, so atria and roots stay neutral — with soft 15° edges at both
 * grooves and at the apex.
 */
import { Vector3 } from 'three';

export interface AxisFrame {
  apex: Vector3;
  /** Unit long axis, apex → base. */
  axis: Vector3;
  length: number;
}

/** Angle (degrees, −180…180] of `p` around the long axis, 0 = anterior (+z projected), and its radius / height. */
export function axial(frame: AxisFrame, p: Vector3): { phi: number; radius: number; height: number } {
  const { apex, axis, length } = frame;
  const ref = new Vector3(0, 0, 1).addScaledVector(axis, -axis.z);
  if (ref.lengthSq() < 1e-8) ref.set(1, 0, 0);
  ref.normalize();
  const ref2 = new Vector3().crossVectors(axis, ref);
  const d = p.clone().sub(apex);
  const x = d.dot(ref);
  const y = d.dot(ref2);
  return { phi: (Math.atan2(y, x) * 180) / Math.PI, radius: Math.hypot(x, y), height: d.dot(axis) / length };
}

/** Mean angle (degrees) of points around the long axis. */
export function meanAngle(frame: AxisFrame, points: readonly Vector3[]): number | null {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    const { phi } = axial(frame, p);
    sx += Math.cos((phi * Math.PI) / 180);
    sy += Math.sin((phi * Math.PI) / 180);
  }
  return points.length > 0 ? (Math.atan2(sy, sx) * 180) / Math.PI : null;
}

const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RvArc {
  /** Anterior interventricular groove (LAD) angle. */
  lad: number;
  /** Posterior interventricular groove (PDA) angle. */
  pda: number;
  /** Acute margin (RCA marginal) angle: decides which of the two arcs is the RV. */
  margin: number;
}

/** Soft edges (degrees) at the grooves; radius (scene units) inside which the wall is septum; apex band. */
export const RV_EDGE_DEG: readonly [number, number] = [15, 30];
export const RV_SEPTUM_RADIUS: readonly [number, number] = [0.2, 0.27];
export const RV_APEX_HEIGHT: readonly [number, number] = [0.08, 0.2];

/** How much of a wall point belongs to the RV free wall (0..1). */
export function rvShare(arc: RvArc, p: { phi: number; radius: number; height: number }): number {
  // Walk from the LAD groove toward the margin: `d` grows along the RV arc until the PDA groove at `span`.
  const towardMargin = wrap360(arc.lad - arc.margin) < wrap360(arc.lad - arc.pda) ? 1 : -1;
  const d = wrap360(towardMargin * (arc.lad - p.phi));
  const span = wrap360(towardMargin * (arc.lad - arc.pda));
  if (d > span) return 0;
  const [e0, e1] = RV_EDGE_DEG;
  const angular = smooth(e0, e1, d) * smooth(e0 * 0.8, e1 * 0.8, span - d);
  return angular * smooth(RV_SEPTUM_RADIUS[0], RV_SEPTUM_RADIUS[1], p.radius) * smooth(RV_APEX_HEIGHT[0], RV_APEX_HEIGHT[1], p.height);
}

/**
 * New weights for one vertex: its RV share of the total weight goes to the RCA (index 2). `w` is [LAD, LCX,
 * RCA]; the sum (1 − neutral) is kept.
 */
export function correctWeights(w: readonly [number, number, number], share: number): [number, number, number] {
  if (share <= 0) return [w[0], w[1], w[2]];
  const sum = w[0] + w[1] + w[2];
  const k = 1 - share;
  return [w[0] * k, w[1] * k, w[2] * k + sum * share];
}
