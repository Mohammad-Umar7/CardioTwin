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

export interface FramingInput {
  box: Box3;
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

/** Projected size (CSS px) of `box` seen from `target + direction · distance`. */
export function projectedSize(input: Omit<FramingInput, 'freeWidth' | 'freeHeight' | 'share'>, distance: number): { width: number; height: number } {
  const { box, target, direction, fov, width, height } = input;
  const forward = direction.clone().negate().normalize();
  const right = new Vector3().crossVectors(forward, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const eye = target.clone().addScaledVector(direction, distance);
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  const aspect = width / height;
  const { min, max } = box;
  let i = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners[i++]!.set(x, y, z);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const rel = new Vector3();
  for (const c of corners) {
    rel.copy(c).sub(eye);
    const depth = Math.max(1e-4, rel.dot(forward));
    const ndcX = (rel.dot(right) * f) / (depth * aspect);
    const ndcY = (rel.dot(up) * f) / depth;
    minX = Math.min(minX, ndcX);
    maxX = Math.max(maxX, ndcX);
    minY = Math.min(minY, ndcY);
    maxY = Math.max(maxY, ndcY);
  }
  return { width: ((maxX - minX) / 2) * width, height: ((maxY - minY) / 2) * height };
}

/**
 * Camera distance at which the heart's box fills `share` of the free-area height (and never more than
 * MAX_WIDTH_SHARE of its width). Solved by bisection on the exact projection; clamped to [min, max].
 */
export function framingDistance(input: FramingInput, min = 1.2, max = 14): number {
  const wantH = input.share * Math.max(1, input.freeHeight);
  const wantW = MAX_WIDTH_SHARE * Math.max(1, input.freeWidth);
  // Projected size shrinks monotonically with distance: find the smallest distance that satisfies both.
  const fits = (d: number) => {
    const s = projectedSize(input, d);
    return s.height <= wantH && s.width <= wantW;
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
