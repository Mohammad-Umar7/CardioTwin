/**
 * Heart framing and the stage view offset (WORKSTATION_V2 §4.1, §4.7). Pure maths, unit-tested in
 * camera.test.ts; the camera rig applies the results.
 *
 *   - FRAMING. The workstation home pose puts the heart's bounding box at 62 % of the free-area height;
 *     `framingDistance` solves the camera distance for any direction with the real perspective projection
 *     (not a small-angle guess), so the heart keeps that share in every projection.
 *   - VIEW OFFSET. Chrome floats over the full-bleed canvas; instead of resizing the canvas, the camera's
 *     `setViewOffset` shifts the projection so the orbit target lands on the centre of the free area.
 *     `viewOffsetFor` returns that shift in CSS px; `glide` eases between two shifts over `flyout`.
 */
import { Box3, Vector3 } from 'three';
import type { AnatomyManifest } from '@/types/contracts';
import { PEEL_SOLID_UNTIL, PEEL_WINDOWS, windowProgress } from '../anatomy/explode';

/** V2 §4.1: the heart's bounding box fills 62 % of the free-area height at the workstation home pose. */
export const WORKSTATION_HEART_SHARE = 0.62;
/** V2 §6.1: on the landing hero the heart is ≥ 55 % of the hero height (a little margin above that). */
export const HERO_HEART_SHARE = 0.58;
/** Never let the heart's width exceed this share of the free-area width (narrow free areas). */
export const MAX_WIDTH_SHARE = 0.86;
/** `flyout` motion token (LUMEN §6): the view offset glides over 360 ms when chrome changes. */
export const OFFSET_GLIDE_MS = 360;

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Offset {
  x: number;
  y: number;
}

export const ZERO_OFFSET: Offset = Object.freeze({ x: 0, y: 0 });

/**
 * The free area of a `width × height` canvas once `insets` are removed, clamped so it never inverts
 * (a very narrow window keeps at least a 1 px free column).
 */
export function freeArea(width: number, height: number, insets: Insets): { x: number; y: number; width: number; height: number } {
  const left = Math.max(0, Math.min(insets.left, width - 1));
  const right = Math.max(0, Math.min(insets.right, width - left - 1));
  const top = Math.max(0, Math.min(insets.top, height - 1));
  const bottom = Math.max(0, Math.min(insets.bottom, height - top - 1));
  return { x: left, y: top, width: width - left - right, height: height - top - bottom };
}

/**
 * How far (CSS px) the orbit target must move from the canvas centre to sit at the centre of the free
 * area. At 1440×824 with the V2 cards (304 · 376 · 12 · 64) this is (−36, −26) (V2 §4.7).
 */
export function viewOffsetFor(width: number, height: number, insets: Insets): Offset {
  if (!(width > 0) || !(height > 0)) return ZERO_OFFSET;
  const free = freeArea(width, height, insets);
  return { x: free.x + free.width / 2 - width / 2, y: free.y + free.height / 2 - height / 2 };
}

/** Decelerating ease (LUMEN `out`, cubic-bezier(.22,1,.36,1) is visually equivalent to ease-out cubic). */
export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Offset at `elapsed` ms of a glide from `from` to `to` lasting `ms` (0 ms = instant). */
export function glide(from: Offset, to: Offset, elapsed: number, ms = OFFSET_GLIDE_MS): Offset {
  if (ms <= 0 || elapsed >= ms) return to;
  const k = easeOutCubic(elapsed / ms);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

export const sameOffset = (a: Offset, b: Offset, eps = 0.25): boolean => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** Heart walls' axis-aligned box from the manifest (CAD target nodes, else myocardium structures). */
export function heartBox(manifest: AnatomyManifest | null | undefined): Box3 {
  const box = new Box3();
  const cadNodes = new Set<string>(
    ((manifest as { targets?: Record<string, string[]> } | null | undefined)?.targets?.CAD ?? []) as string[],
  );
  for (const s of manifest?.structures ?? []) {
    const raw = s as unknown as { node: string; category?: string; bbox?: { min: number[]; max: number[] } };
    const isWall = cadNodes.size > 0 ? cadNodes.has(raw.node) : /heart_wall/i.test(raw.node) || raw.category === 'Myocardium';
    if (!isWall || !raw.bbox || raw.bbox.min.length < 3 || raw.bbox.max.length < 3) continue;
    box.expandByPoint(new Vector3(raw.bbox.min[0], raw.bbox.min[1], raw.bbox.min[2]));
    box.expandByPoint(new Vector3(raw.bbox.max[0], raw.bbox.max[1], raw.bbox.max[2]));
  }
  // Procedural heart / missing manifest: a ~11 cm heart centred on the origin (CONTRACTS §6.1).
  if (box.isEmpty()) box.set(new Vector3(-0.56, -0.52, -0.42), new Vector3(0.56, 0.52, 0.42));
  return box;
}

/** Layers the thorax view always frames (with the chest layers still solid at the peel value). */
const THORAX_LAYERS = new Set(['heart', 'coronary']);

/** Outer layers that turn solid again as the chest closes (rig.ts: solid while their progress < PEEL_SOLID_UNTIL). */
const CHEST_LAYERS = new Set(['muscle', 'skeleton', 'lungs', 'diaphragm']);

/**
 * The thorax as it is OPAQUE at peel value `e`: the heart (its roots and coronaries) plus every chest layer
 * that is still (or again) solid there — at rest and as far as it has travelled, a little beyond the point
 * where it turns into a ghost (the fade takes a few frames) — so the camera frames what is really on screen
 * at each detent: the diaphragm dome under the heart at "Ribs open", the whole closed chest at "Closed".
 * Lungs count only when their layer is shown. Null without a manifest.
 */
export function opaqueThoraxBox(
  manifest: AnatomyManifest | null | undefined,
  e: number,
  visible: (layerId: string) => boolean = (id) => id !== 'lungs',
): Box3 | null {
  if (!manifest) return null;
  const layers = new Map(manifest.layers.map((l) => [l.id, l]));
  const box = new Box3();
  const v = new Vector3();
  for (const s of manifest.structures) {
    const raw = s as unknown as { node: string; layer: string; explode?: number[]; bbox?: { min: number[]; max: number[] } };
    if (!THORAX_LAYERS.has(raw.layer) && !CHEST_LAYERS.has(raw.layer)) continue;
    // The great vessels' boxes span the whole aorta and the pulmonary trees; the clip spheres keep only their
    // roots, which the heart's own box (+ the root margin below) covers.
    if (/^GreatVessel_/.test(raw.node)) continue;
    if (!raw.bbox || raw.bbox.min.length < 3 || raw.bbox.max.length < 3 || !visible(raw.layer)) continue;
    const chest = CHEST_LAYERS.has(raw.layer);
    const k = chest ? windowProgress(e, PEEL_WINDOWS[raw.layer] ?? [0, 1]) : 0;
    if (chest && k >= PEEL_SOLID_UNTIL) continue;
    const l = layers.get(raw.layer)?.explode ?? [0, 0, 0];
    const x = raw.explode ?? [0, 0, 0];
    v.set((l[0] ?? 0) + (x[0] ?? 0), (l[1] ?? 0) + (x[1] ?? 0), (l[2] ?? 0) + (x[2] ?? 0)).multiplyScalar(chest ? Math.min(1, PEEL_SOLID_UNTIL + 0.15) : 0);
    const min = new Vector3(raw.bbox.min[0], raw.bbox.min[1], raw.bbox.min[2]);
    const max = new Vector3(raw.bbox.max[0], raw.bbox.max[1], raw.bbox.max[2]);
    box.expandByPoint(min).expandByPoint(max).expandByPoint(min.clone().add(v)).expandByPoint(max.clone().add(v));
  }
  if (box.isEmpty()) return null;
  // The visible great-vessel roots above the base.
  const heart = heartBox(manifest);
  box.expandByPoint(new Vector3(heart.getCenter(new Vector3()).x, heart.max.y + GREAT_VESSEL_ROOTS, heart.getCenter(new Vector3()).z));
  return box;
}

/** How far the visible roots of the great vessels rise above the heart walls (scene units). */
const GREAT_VESSEL_ROOTS = 0.4;

/**
 * What the camera frames for a peel value (V2 §5.11): the heart ('heart'), the whole opaque thorax while any
 * chest layer is solid again ('thorax'), or both opened halves ('open'). Derived from the value itself (with
 * hysteresis against the current mode), never from threshold crossings, so any path — the ▶/⟲ player, a
 * slider jump from Open heart straight to Closed, the tour, a deep link — ends on the framing of where the
 * peel actually is.
 *
 *  - thorax below 0.58: the diaphragm and the lungs turn solid again right under rest (their windows end at
 *    0.65 / 0.6), so the chest is framed before "Ribs open" (0.45), never at the heart framing;
 *  - back to the heart above 0.595 (rest is 0.6);
 *  - open from 0.7 (the heart's window), back below 0.66.
 */
export type PeelMode = 'heart' | 'thorax' | 'open';
export const PEEL_THORAX_BELOW = 0.58;
export const PEEL_THORAX_EXIT_ABOVE = 0.595;
export const PEEL_OPEN_AT = 0.7;
export const PEEL_OPEN_EXIT_BELOW = 0.66;

export function peelModeFor(e: number, current: PeelMode): PeelMode {
  if (current === 'open' ? e >= PEEL_OPEN_EXIT_BELOW : e >= PEEL_OPEN_AT) return 'open';
  if (current === 'thorax') return e <= PEEL_THORAX_EXIT_ABOVE ? 'thorax' : 'heart';
  return e < PEEL_THORAX_BELOW ? 'thorax' : 'heart';
}

export interface FramingInput {
  box: Box3;
  /**
   * Samples of the heart walls' surface (rest frame). When given they replace the box corners: the
   * silhouette of the real mesh fills the share, not its bounding box (whose corners project ~15 % larger).
   */
  points?: readonly Vector3[] | null;
  /**
   * Points that must stay inside the free area, `keepMargin` px from its edges (the visible great vessels:
   * the aortic arch is never cut by the top bar). The solver dollies out if they do not fit.
   */
  keep?: readonly Vector3[] | null;
  keepMargin?: number;
  /** Orbit target (the heart centre). */
  target: Vector3;
  /** Unit vector from the target toward the camera. */
  direction: Vector3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Canvas size in CSS px (the projection covers the full canvas; the offset only shifts it). */
  width: number;
  height: number;
  /** Free-area size in CSS px. */
  freeWidth: number;
  freeHeight: number;
  /** Target share of the free-area height (0.62 in the workstation). */
  share: number;
}

const UP = new Vector3(0, 1, 0);
const corners = Array.from({ length: 8 }, () => new Vector3());

/** Screen extent (CSS px) of a point set around the projected target: how far it reaches each way. */
export interface Extent {
  left: number;
  right: number;
  up: number;
  down: number;
}

type ProjectInput = Pick<FramingInput, 'target' | 'direction' | 'fov' | 'width' | 'height'>;

/** Extent of `points` seen from `target + direction · distance`, relative to the target's projection. */
export function projectedExtent(input: ProjectInput, points: readonly Vector3[], distance: number): Extent {
  const { target, direction, fov, width, height } = input;
  const forward = direction.clone().negate().normalize();
  const right = new Vector3().crossVectors(forward, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const eye = target.clone().addScaledVector(direction, distance);
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  const aspect = width / height;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const rel = new Vector3();
  for (const c of points) {
    rel.copy(c).sub(eye);
    const depth = Math.max(1e-4, rel.dot(forward));
    const ndcX = (rel.dot(right) * f) / (depth * aspect);
    const ndcY = (rel.dot(up) * f) / depth;
    minX = Math.min(minX, ndcX);
    maxX = Math.max(maxX, ndcX);
    minY = Math.min(minY, ndcY);
    maxY = Math.max(maxY, ndcY);
  }
  if (!Number.isFinite(minX)) return { left: 0, right: 0, up: 0, down: 0 };
  return { left: (-minX / 2) * width, right: (maxX / 2) * width, up: (maxY / 2) * height, down: (-minY / 2) * height };
}

function boxCorners(box: Box3): Vector3[] {
  const { min, max } = box;
  let i = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners[i++]!.set(x, y, z);
  return corners;
}

/** Projected size (CSS px) of the heart (its surface samples, else its box) seen from `target + direction · distance`. */
export function projectedSize(input: Omit<FramingInput, 'freeWidth' | 'freeHeight' | 'share'>, distance: number): { width: number; height: number } {
  const points = input.points && input.points.length > 0 ? input.points : boxCorners(input.box);
  const e = projectedExtent(input, points, distance);
  return { width: e.left + e.right, height: e.up + e.down };
}

/**
 * Camera distance at which the heart fills `share` of the free-area height (and never more than
 * MAX_WIDTH_SHARE of its width), with every `keep` point inside the free area. The orbit target sits at the
 * free-area centre (view offset), so "inside" means within half the free size of the target, less the
 * margin. Solved by bisection on the exact projection; clamped to [min, max].
 */
export function framingDistance(input: FramingInput, min = 1.2, max = 14): number {
  const wantH = input.share * Math.max(1, input.freeHeight);
  const wantW = MAX_WIDTH_SHARE * Math.max(1, input.freeWidth);
  const margin = input.keepMargin ?? 12;
  const halfW = Math.max(1, input.freeWidth / 2 - margin);
  const halfH = Math.max(1, input.freeHeight / 2 - margin);
  const keep = input.keep && input.keep.length > 0 ? input.keep : null;
  // Projected size shrinks monotonically with distance: find the smallest distance that satisfies all.
  const fits = (d: number) => {
    const s = projectedSize(input, d);
    if (s.height > wantH || s.width > wantW) return false;
    if (!keep) return true;
    const e = projectedExtent(input, keep, d);
    return e.left <= halfW && e.right <= halfW && e.up <= halfH && e.down <= halfH;
  };
  if (fits(min)) return min;
  if (!fits(max)) return max;
  let lo = min;
  let hi = max;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
