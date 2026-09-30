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