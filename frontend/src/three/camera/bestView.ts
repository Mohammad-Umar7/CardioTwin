/**
 * Visible best views (WORKSTATION_V2 P0-2). The manifest's `bestView`s follow the angiographic
 * convention (LAD RAO 30 / CRA 25, LCX RAO 30 / CAU 25, RCA LAO 40). Angiography is a projection, so a
 * vessel on the far side still shows; a surface rendering hides it. Before flying to a vessel the camera
 * checks that its proximal–mid trunk faces the viewer from the conventional angle, and when it does not
 * (the LCX, in the posterior AV groove, from RAO), it takes the nearest C-arm angle that does. Pure and
 * unit-tested.
 */
import { Vector3 } from 'three';
import type { BestView } from '@/types/contracts';
import { facing, type AnchorCandidate } from '../labels/dynamicAnchor';
import { toControlsAngles } from './presets';

/** Mean facing of the three most camera-facing candidates that counts as "clearly visible". */
export const VISIBLE_FACING = 0.35;
/** Weight of the angular distance from the conventional view (per 180°) in the search. */
const DISTANCE_PENALTY = 0.3;
/**
 * Visibility beyond this adds nothing: among the views that show the trunk well, the one closest to the
 * angiographic convention wins (a left-lateral view for the LCX rather than a posterolateral one).
 */
const VISIBILITY_CAP = 0.55;

export function eyeFor(view: Pick<BestView, 'azimuth' | 'elevation' | 'distance'>, target = new Vector3()): Vector3 {
  const { azimuth, polar } = toControlsAngles(view.azimuth, view.elevation);
  return new Vector3().setFromSphericalCoords(view.distance, polar, azimuth).add(target);
}

/** How visible a trunk is from `view`: the mean facing of its three most camera-facing candidates. */
export function trunkVisibility(candidates: readonly AnchorCandidate[], view: BestView, target = new Vector3()): number {
  if (candidates.length === 0) return 1;
  const eye = eyeFor(view, target);
  const s = candidates.map((c) => facing(c.rest, c.normal, eye)).sort((a, b) => b - a);
  const top = s.slice(0, 3);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

const angleBetween = (a: BestView, b: BestView) => {
  const u = eyeFor({ ...a, distance: 1 });
  const v = eyeFor({ ...b, distance: 1 });
  return (Math.acos(Math.min(1, Math.max(-1, u.dot(v)))) * 180) / Math.PI;
};

/**
 * The conventional view when the trunk is clearly visible from it; otherwise the closest C-arm angle
 * (5° grid, elevation within ±30°) from which it is, trading visibility against distance from convention.
 */
export function visibleBestView(conventional: BestView, candidates: readonly AnchorCandidate[], target = new Vector3()): BestView {
  if (candidates.length === 0 || trunkVisibility(candidates, conventional, target) >= VISIBLE_FACING) return conventional;
  let best = conventional;
  let bestScore = -Infinity;
  for (let az = -175; az <= 180; az += 5) {
    for (let el = -30; el <= 30; el += 5) {
      const view = { azimuth: az, elevation: el, distance: conventional.distance };
      const vis = trunkVisibility(candidates, view, target);
      if (vis < VISIBLE_FACING) continue;
      const score = Math.min(vis, VISIBILITY_CAP) - (DISTANCE_PENALTY * angleBetween(view, conventional)) / 180;
      if (score > bestScore) {
        bestScore = score;
        best = view;
      }
    }
  }
  return best;
}
