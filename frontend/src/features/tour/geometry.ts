/**
 * Spotlight and caption-card geometry for the guided demo (pure; unit-tested).
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Bounds {
  /** Usable viewport: between the top bar and the status line. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const rectRight = (r: Rect) => r.left + r.width;
export const rectBottom = (r: Rect) => r.top + r.height;

export function inflate(r: Rect, pad: number): Rect {
  return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

export function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map(rectRight));
  const bottom = Math.max(...rects.map(rectBottom));
  return { left, top, width: right - left, height: bottom - top };
}

const overlaps = (a: Rect, b: Rect) =>
  a.left < rectRight(b) && b.left < rectRight(a) && a.top < rectBottom(b) && b.top < rectBottom(a);

/**
 * Merges overlapping holes into their bounding box until none overlap, so an even-odd scrim path never
 * re-fills the overlap of two spotlights.
 */
export function mergeOverlapping(rects: readonly Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        if (overlaps(out[i]!, out[j]!)) {
          out[i] = union([out[i]!, out[j]!])!;
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

/** Clips a rect to bounds (null when nothing is left). */
export function clip(r: Rect, b: Bounds): Rect | null {
  const left = Math.max(r.left, b.left);
  const top = Math.max(r.top, b.top);
  const right = Math.min(rectRight(r), b.right);
  const bottom = Math.min(rectBottom(r), b.bottom);
  return right - left > 1 && bottom - top > 1 ? { left, top, width: right - left, height: bottom - top } : null;
}

/** Rounded-rect sub-path (clockwise), for SVG and CSS `path()`. */
export function roundedRectPath(r: Rect, radius = 8): string {
  const k = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  const x = r.left;
  const y = r.top;
  const w = r.width;
  const h = r.height;
  const f = (n: number) => Number(n.toFixed(1));
  return (
    `M${f(x + k)} ${f(y)}H${f(x + w - k)}A${k} ${k} 0 0 1 ${f(x + w)} ${f(y + k)}` +
    `V${f(y + h - k)}A${k} ${k} 0 0 1 ${f(x + w - k)} ${f(y + h)}H${f(x + k)}` +
    `A${k} ${k} 0 0 1 ${f(x)} ${f(y + h - k)}V${f(y + k)}A${k} ${k} 0 0 1 ${f(x + k)} ${f(y)}Z`
  );
}

/** Full-viewport path with holes (even-odd), e.g. for a pointer-blocking `clip-path`. */
export function scrimPath(width: number, height: number, holes: readonly Rect[], radius = 8): string {
  return `M0 0H${width}V${height}H0Z ${holes.map((h) => roundedRectPath(h, radius)).join(' ')}`;
}

export type Side = 'right' | 'left' | 'below' | 'above' | 'inside';

export interface Placement {
  left: number;
  top: number;
  side: Side;
}

/**
 * Where the caption card goes: beside the spotlit area (right, then left, then below, then above), aligned
 * to its top or centre and kept inside `bounds`. When the target fills the screen (the 3D stage), the card
 * sits inside it at the bottom-left, over the space the canvas toolbar leaves in tour chrome.
 *
 * `avoid` lists rectangles the card must not cover (the stage cards, the probability numerals, the other
 * spotlit regions): the first candidate that is clear of all of them wins; below and above may then slide
 * inside the bounds as long as they stay off the target. With nothing clear, the first candidate that fits
 * is used, as without `avoid`.
 */
export function placeCard(
  target: Rect | null,
  card: { width: number; height: number },
  bounds: Bounds,
  gap = 16,
  avoid: readonly Rect[] = [],
): Placement {
  const clampX = (x: number) => Math.min(Math.max(x, bounds.left + 12), bounds.right - card.width - 12);
  const clampY = (y: number) => Math.min(Math.max(y, bounds.top + 12), bounds.bottom - card.height - 12);
  const box = (p: Placement): Rect => ({ left: p.left, top: p.top, width: card.width, height: card.height });
  const clear = (p: Placement) => !avoid.some((a) => overlaps(box(p), a));
  if (!target) {
    const centred: Placement = {
      left: clampX((bounds.left + bounds.right - card.width) / 2),
      top: clampY(bounds.bottom - card.height - 48),
      side: 'inside',
    };
    if (clear(centred)) return centred;
    const corners: Placement[] = [
      { left: clampX(bounds.left), top: centred.top, side: 'inside' },
      { left: clampX(bounds.right), top: centred.top, side: 'inside' },
    ];
    return corners.find(clear) ?? centred;
  }
  const fitsX = (x: number) => x >= bounds.left + 8 && x + card.width <= bounds.right - 8;
  const fitsY = (y: number) => y >= bounds.top + 8 && y + card.height <= bounds.bottom - 8;
  const centreX = clampX(target.left + target.width / 2 - card.width / 2);

  // Strict candidates, in the historical order (they never cover the target).
  const strict: Placement[] = [];
  const right = rectRight(target) + gap;
  if (fitsX(right)) strict.push({ left: right, top: clampY(target.top), side: 'right' });
  const left = target.left - gap - card.width;
  if (fitsX(left)) strict.push({ left, top: clampY(target.top), side: 'left' });
  const below = rectBottom(target) + gap;
  if (fitsY(below)) strict.push({ left: centreX, top: below, side: 'below' });
  const above = target.top - gap - card.height;
  if (fitsY(above)) strict.push({ left: centreX, top: above, side: 'above' });
  const inside: Placement = {
    left: clampX(target.left + 24),
    top: clampY(rectBottom(target) - card.height - 24),
    side: 'inside',
  };
  if (avoid.length === 0) return strict[0] ?? inside;

  // Relaxed candidates: slid inside the bounds, still off the target (a small target near an edge, such as
  // the patient chip in the top bar, cannot fit a card strictly below it).
  const offTarget = (p: Placement) => !overlaps(box(p), target);
  const relaxed = (
    [
      { left: centreX, top: clampY(below), side: 'below' },
      { left: clampX(right), top: clampY(target.top), side: 'right' },
      { left: clampX(left), top: clampY(target.top), side: 'left' },
      { left: centreX, top: clampY(above), side: 'above' },
    ] satisfies Placement[]
  ).filter(offTarget);
  const base = [...strict, ...relaxed];
  // Still blocked: slide each candidate sideways just past the rectangle in its way (same row).
  const slid = base.flatMap((p) =>
    avoid
      .filter((a) => overlaps(box(p), a))
      .flatMap((a) => [a.left - 8 - card.width, rectRight(a) + 8])
      .filter(fitsX)
      .map((x): Placement => ({ ...p, left: x }))
      .filter(offTarget),
  );
  return [...base, ...slid].find(clear) ?? (clear(inside) ? inside : (strict[0] ?? inside));
}
