/**
 * Dynamic label anchors (WORKSTATION_V2 §5.14, P0-2). Pure and unit-tested (labels.test.ts).
 *
 * A vessel label points at the part of its artery that faces the camera, so the selected vessel's label is
 * never "posterior". Candidates are samples of the vessel's main-trunk centreline (`vessels.json`, ordered
 * proximal → distal) in its proximal–mid 60 %, each with an outward surface normal estimated from the
 * heart's long axis (the epicardial arteries run on the heart's surface, so "away from the axis" is
 * "out of the wall"). Every 200 ms the chooser re-scores them against the camera; it switches only when a
 * better candidate has stayed best for 200 ms, so the anchor never jitters.
 */
import { Vector3 } from 'three';

export type Vec3Like = readonly [number, number, number] | readonly number[];

export interface CentrelineSegment {
  points: readonly Vec3Like[];
  radius?: readonly number[];
  parent?: number | null;
}

export interface AnchorCandidate {
  /** Position in the anatomy's rest frame (scene units). */
  rest: Vector3;
  /** Outward unit normal in the rest frame. */
  normal: Vector3;
  /** Arc-length fraction along the trunk (0 = ostium). */
  u: number;
}

/** Proximal–mid window of the trunk (V2 §5.14: "proximal–mid 60 %"); the ostium itself hides under the atria. */
export const ANCHOR_WINDOW: readonly [number, number] = [0.06, 0.6];
export const ANCHOR_SAMPLES = 12;
/** Re-evaluation period and the time a new best must hold before the anchor moves (V2 §5.14). */
export const ANCHOR_PERIOD_MS = 200;
/** A challenger must beat the current anchor's facing by this much to take over (hysteresis). */
export const ANCHOR_MARGIN = 0.06;

/**
 * The main trunk of a vessel: the first segment without a parent (the centreline file lists the trunk
 * first), else the longest segment.
 */
export function mainTrunk(segments: readonly CentrelineSegment[]): readonly Vec3Like[] {
  const root = segments.find((s) => s.parent === null || s.parent === undefined || s.parent === -1);
  if (root && root.points.length >= 2) return root.points;
  let best: readonly Vec3Like[] = [];
  for (const s of segments) if (s.points.length > best.length) best = s.points;
  return best;
}

export interface HeartAxisFrame {
  /** A point on the heart's long axis (manifest `heart.base_center`, else the origin). */
  centre: Vector3;
  /** Unit long axis (manifest `heart.long_axis`). */
  axis: Vector3;
}

/** Outward normal at `p`: away from the long axis, tilted a little away from the heart centre. */
export function outwardNormal(p: Vector3, frame: HeartAxisFrame, out = new Vector3()): Vector3 {
  const rel = out.copy(p).sub(frame.centre);
  const along = rel.dot(frame.axis);
  const radial = rel.clone().addScaledVector(frame.axis, -along);
  const centreDir = p.clone().sub(frame.centre);
  if (radial.lengthSq() < 1e-10) return out.copy(centreDir.lengthSq() > 1e-10 ? centreDir.normalize() : new Vector3(0, 0, 1));
  radial.normalize();
  if (centreDir.lengthSq() > 1e-10) centreDir.normalize();
  return out.copy(radial).multiplyScalar(0.75).addScaledVector(centreDir, 0.25).normalize();
}

/** Evenly spaced (by arc length) candidates in `window` of the trunk. */
export function buildCandidates(
  trunk: readonly Vec3Like[],
  frame: HeartAxisFrame,
  window: readonly [number, number] = ANCHOR_WINDOW,
  count = ANCHOR_SAMPLES,
): AnchorCandidate[] {
  if (trunk.length < 2) return [];
  const pts = trunk.map((p) => new Vector3(Number(p[0]), Number(p[1]), Number(p[2])));
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  const total = cum[cum.length - 1]!;
  if (!(total > 0)) return [];
  const out: AnchorCandidate[] = [];
  let j = 1;
  for (let k = 0; k < count; k += 1) {
    const u = window[0] + ((window[1] - window[0]) * k) / Math.max(1, count - 1);
    const s = u * total;
    while (j < cum.length - 1 && cum[j]! < s) j += 1;
    const a = cum[j - 1]!;
    const b = cum[j]!;
    const t = b > a ? (s - a) / (b - a) : 0;
    const rest = pts[j - 1]!.clone().lerp(pts[j]!, Math.min(1, Math.max(0, t)));
    out.push({ rest, normal: outwardNormal(rest, frame), u });
  }
  return out;
}

/** How squarely a surface point faces the eye: dot(normal, direction to the eye) ∈ [−1, 1]. */
export function facing(position: Vector3, normal: Vector3, eye: Vector3): number {
  const toEye = eye.clone().sub(position);
  const len = toEye.length();
  return len > 1e-9 ? normal.dot(toEye) / len : 0;
}

/** Index of the candidate facing the eye most (ties → the more proximal one). */
export function bestCandidate(scores: readonly number[]): number {
  let best = -1;
  let bestScore = -Infinity;
  scores.forEach((s, i) => {
    if (s > bestScore + 1e-9) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

/**
 * Hysteresis around `bestCandidate`: evaluated at most every ANCHOR_PERIOD_MS; a new best must beat the
 * current anchor by ANCHOR_MARGIN and stay best for ANCHOR_PERIOD_MS before the anchor moves.
 */
export class AnchorChooser {
  current = -1;
  /** Scores of the last evaluation (for "is the chosen anchor hidden?"). */
  scores: readonly number[] = [];
  private pending = -1;
  private pendingSince = 0;
  private lastEval = -Infinity;

  constructor(
    private readonly period = ANCHOR_PERIOD_MS,
    private readonly margin = ANCHOR_MARGIN,
  ) {}

  /** `scores()` is only called when an evaluation is due. Returns the anchor index to use. */
  update(now: number, scores: () => readonly number[]): number {
    if (this.current >= 0 && now - this.lastEval < this.period) return this.current;
    this.lastEval = now;
    const s = scores();
    this.scores = s;
    const best = bestCandidate(s);
    if (best < 0) return this.current;
    if (this.current < 0 || this.current >= s.length) {
      this.current = best;
      this.pending = -1;
      return best;
    }
    if (best === this.current || s[best]! - s[this.current]! < this.margin) {
      this.pending = -1;
      return this.current;
    }
    if (this.pending !== best) {
      this.pending = best;
      this.pendingSince = now;
      return this.current;
    }
    if (now - this.pendingSince >= this.period) {
      this.current = best;
      this.pending = -1;
    }
    return this.current;
  }

  reset(): void {
    this.current = -1;
    this.pending = -1;
    this.lastEval = -Infinity;
  }
}
