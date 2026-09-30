/**
 * Visible best views (WORKSTATION_V2 P0-2). The manifest's `bestView`s follow the angiographic
 * convention (LAD RAO 30 / CRA 25, LCX RAO 30 / CAU 25, RCA LAO 40). Angiography is a projection, so a
 * vessel on the far side still shows; a surface rendering hides it. Before flying to a vessel the camera
 * checks that its proximal–mid trunk faces the viewer — and, once the anatomy's BVHs exist, that it is not
 * hidden behind an atrium or a great vessel — from the conventional angle; when it is not, it takes the
 * nearest C-arm angle from which it is (the LCX, in the posterior AV groove, from RAO). Pure and tested.
 */
import { Vector3 } from 'three';
import type { BestView } from '@/types/contracts';
import { facing, type AnchorCandidate } from '../labels/dynamicAnchor';
import { toControlsAngles } from './presets';

/**
 * Mean facing of the three most camera-facing (visible) candidates that counts as "clearly visible": high
 * enough that the trunk is seen face-on, not along the heart's silhouette (a surface rendering is not a
 * projection angiogram).
 */
export const VISIBLE_FACING = 0.55;
/** Weight of the angular distance from the conventional view (per 180°) in the search. */
const DISTANCE_PENALTY = 0.3;
/**
 * Visibility beyond this adds little: among the views that show the trunk well, the one closest to the
 * angiographic convention wins.
 */
const VISIBILITY_CAP = 0.5;
/** Share of the trunk candidates that must face the camera for a view to count (a whole stretch, not a stub). */
const MIN_COVERAGE = 0.6;

export function eyeFor(view: Pick<BestView, 'azimuth' | 'elevation' | 'distance'>, target = new Vector3()): Vector3 {
  const { azimuth, polar } = toControlsAngles(view.azimuth, view.elevation);
  return new Vector3().setFromSphericalCoords(view.distance, polar, azimuth).add(target);
}

/** Per-candidate visibility test (true = nothing in front of it); the default sees through everything. */
export type OcclusionTest = (eye: Vector3, point: Vector3) => boolean;
const clear: OcclusionTest = () => true;

export interface TrunkVisibility {
  /** Mean facing of the three most camera-facing visible candidates. */
  score: number;
  /** Share of candidates that face the camera (> 0.25) and are unobstructed. */
  coverage: number;
}

export function trunkVisibility(
  candidates: readonly AnchorCandidate[],
  view: BestView,
  target = new Vector3(),
  visible: OcclusionTest = clear,
): TrunkVisibility {
  if (candidates.length === 0) return { score: 1, coverage: 1 };
  const eye = eyeFor(view, target);
  const s = candidates.map((c) => {
    const f = facing(c.rest, c.normal, eye);
    return f > 0 && visible(eye, c.rest) ? f : 0;
  });
  const top = [...s].sort((a, b) => b - a).slice(0, 3);
  return { score: top.reduce((a, b) => a + b, 0) / top.length, coverage: s.filter((f) => f > 0.25).length / s.length };
}

const clearlyVisible = (v: TrunkVisibility) => v.score >= VISIBLE_FACING && v.coverage >= MIN_COVERAGE;

const angleBetween = (a: BestView, b: BestView) => {
  const u = eyeFor({ ...a, distance: 1 });
  const v = eyeFor({ ...b, distance: 1 });
  return (Math.acos(Math.min(1, Math.max(-1, u.dot(v)))) * 180) / Math.PI;
};

export interface SearchOptions {
  target?: Vector3;
  visible?: OcclusionTest;
  /** Grid step in degrees (5 for the facing heuristic; coarser when every candidate costs a raycast). */
  step?: number;
}

/**
 * The conventional view when the trunk is clearly visible from it; otherwise the closest C-arm angle
 * (elevation within ±30°) from which it is, trading visibility and coverage against the distance from
 * convention. When no angle shows it clearly (a vessel that wraps around the heart), the most visible
 * one wins — never the hidden conventional view.
 */
export function visibleBestView(conventional: BestView, candidates: readonly AnchorCandidate[], options: SearchOptions = {}): BestView {
  const { target = new Vector3(), visible = clear, step = 5 } = options;
  if (candidates.length === 0 || clearlyVisible(trunkVisibility(candidates, conventional, target, visible))) return conventional;
  let best: { view: BestView; clear: boolean; value: number } | null = null;
  for (let az = -180 + step; az <= 180; az += step) {
    for (let el = -30; el <= 30; el += Math.min(step, 15)) {
      const view = { azimuth: az, elevation: el, distance: conventional.distance };
      const vis = trunkVisibility(candidates, view, target, visible);
      const isClear = clearlyVisible(vis);
      const value = Math.min(vis.score, VISIBILITY_CAP) + 0.5 * vis.coverage - (DISTANCE_PENALTY * angleBetween(view, conventional)) / 180;
      if (!best || (isClear && !best.clear) || (isClear === best.clear && value > best.value)) best = { view, clear: isClear, value };
    }
  }
  return best?.view ?? conventional;
}
// ------------------------------------------------------------------------------ surface best view

export interface SurfaceViewScore {
  view: BestView;
  /** Share of the proximal trunk samples that face the camera (> 0.2) and are not hidden. */
  coverage: number;
  /** Projected length of the visible trunk / its 3D length (1 = the trunk lies flat in the image plane). */
  spread: number;
  score: number;
}

/** Facing below this counts as grazing (the vessel runs along the silhouette). */
const SURFACE_FACING = 0.2;
/** C-arm elevations searched (degrees): caudal to cranial. */
const SURFACE_ELEVATIONS = [-30, -15, 0, 15, 30, 40] as const;
/** A grazing or hidden trunk never wins: views below this coverage lose to any view above it. */
export const SURFACE_MIN_COVERAGE = 0.6;
/**
 * Where a SURFACE view of each vessel naturally sits (the search's anchor; the angiographic views are for
 * projections): the LAD's anterior interventricular groove face-on from a shallow LAO-cranial, the LCX's left
 * AV groove from the left lateral, a little caudal, the RCA's right AV groove from a shallow RAO-caudal.
 */
export const SURFACE_PREFERRED: Readonly<Record<string, { azimuth: number; elevation: number }>> = {
  LAD: { azimuth: 30, elevation: 15 },
  LCX: { azimuth: 90, elevation: -10 },
  RCA: { azimuth: -15, elevation: -10 },
};

/** How much of the proximal trunk a view shows, and how spread out on the screen. */
export function surfaceViewScore(
  candidates: readonly AnchorCandidate[],
  view: BestView,
  target = new Vector3(),
  visible: OcclusionTest = clear,
): Omit<SurfaceViewScore, 'score' | 'view'> {
  if (candidates.length === 0) return { coverage: 1, spread: 1 };
  const eye = eyeFor(view, target);
  const d = eye.clone().sub(target).normalize();
  const shown = candidates.map((c) => facing(c.rest, c.normal, eye) > SURFACE_FACING && visible(eye, c.rest));
  let total = 0;
  let projected = 0;
  const s = new Vector3();
  for (let i = 1; i < candidates.length; i += 1) {
    s.copy(candidates[i]!.rest).sub(candidates[i - 1]!.rest);
    const len = s.length();
    total += len;
    if (shown[i] && shown[i - 1]) projected += s.addScaledVector(d, -s.dot(d)).length();
  }
  return { coverage: shown.filter(Boolean).length / shown.length, spread: total > 0 ? projected / total : 0 };
}

/**
 * The C-arm angle from which a SURFACE rendering shows the vessel best (P0-2, V2 §10): a projection
 * angiogram sees through the heart, a surface render does not, so the conventional angiographic view is only
 * a tie-breaker. Every angle of a 15° grid (elevation −30…40°) is scored by how much of the proximal 5–80 %
 * trunk faces the camera unobstructed (coverage, occlusion-tested when `visible` is given) and how much of
 * its length lies flat in the image (spread: the groove seen face-on, not end-on); views that show less than
 * 60 % of the trunk lose to any that show more.
 */
export function surfaceBestView(
  conventional: BestView,
  candidates: readonly AnchorCandidate[],
  options: SearchOptions & { preferred?: { azimuth: number; elevation: number } | null } = {},
): SurfaceViewScore {
  const { target = new Vector3(), visible = clear, step = 15, preferred = null } = options;
  const anchor = preferred ? { ...preferred, distance: conventional.distance } : conventional;
  const conv = surfaceViewScore(candidates, conventional, target, visible);
  let best: SurfaceViewScore = { view: conventional, ...conv, score: -Infinity };
  if (candidates.length === 0) return { ...best, score: 0 };
  for (let az = -180 + step; az <= 180; az += step) {
    for (const el of SURFACE_ELEVATIONS) {
      const view = { azimuth: az, elevation: el, distance: conventional.distance };
      const s = surfaceViewScore(candidates, view, target, visible);
      const clearView = s.coverage >= SURFACE_MIN_COVERAGE;
      const score = (clearView ? 1 : 0) + s.coverage + 0.9 * s.spread - (0.6 * angleBetween(view, anchor)) / 180 - 0.002 * Math.abs(el);
      if (score > best.score) best = { view, ...s, score };
    }
  }
  return best;
}
