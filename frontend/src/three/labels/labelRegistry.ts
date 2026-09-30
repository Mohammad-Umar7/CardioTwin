/**
 * DOM nodes of the vessel labels and their leader lines, registered by the overlay (DOM side) and
 * positioned every frame by the projector (Canvas side) through refs — never through React state
 * (DESIGN_SYSTEM §7.6: one DOM overlay + one SVG, not one <Html> per label).
 */
export const labelEls = new Map<string, HTMLElement>();
export const lineEls = new Map<string, SVGLineElement>();

/** Radiological lanes: RCA on viewer-left, LAD / LCX on viewer-right (swapped when |azimuth| > 90°). */
export const defaultLane = (target: string): 'left' | 'right' => (target === 'RCA' ? 'left' : 'right');

export const LANE_MARGIN = 16;
export const LABEL_MIN_GAP = 30;

/**
 * Stack labels of one lane by their anchor y with at least `gap` px between them, keeping the order of
 * the anchors so leader lines never cross. Pure; unit-tested.
 */
export function stackLane(items: { id: string; y: number }[], gap: number, minY: number, maxY: number): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const ys = sorted.map((i) => Math.min(maxY, Math.max(minY, i.y)));
  for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i]!, ys[i - 1]! + gap);
  // push back up if the stack overflowed the bottom
  for (let i = ys.length - 1; i >= 0; i -= 1) {
    const limit = i === ys.length - 1 ? maxY : ys[i + 1]! - gap;
    ys[i] = Math.min(ys[i]!, limit);
  }
  return new Map(sorted.map((item, i) => [item.id, ys[i]!]));
}
