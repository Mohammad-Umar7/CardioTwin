/**
 * DOM nodes of the vessel labels and their leader lines, registered by the overlay (DOM side) and
 * positioned every frame by the projector (Canvas side) through refs — never through React state
 * (DESIGN_SYSTEM §7.6: one DOM overlay + one SVG, not one <Html> per label). Plus the pure lane layout
 * (WORKSTATION_V2 §5.14), unit-tested in labels.test.ts.
 */
export const labelEls = new Map<string, HTMLElement>();
export const lineEls = new Map<string, SVGLineElement>();
/** Anchor dots at the vessel end of each leader. */
export const dotEls = new Map<string, SVGCircleElement>();
/** Label box sizes, kept current by the overlay's ResizeObserver so the projector never forces layout. */
export const labelSizes = new Map<string, { width: number; height: number }>();

export type Lane = 'left' | 'right';

/**
 * The % belongs on the label only while the Risk card is hidden (focus mode, landing): one home per
 * number (V2 §2, §3.3).
 */
export const labelShowsProbability = (chrome: string): boolean => chrome === 'focus' || chrome === 'landing';

/** Radiological lanes: RCA on viewer-left, LAD / LCX on viewer-right (swapped when |azimuth| > 90°). */
export const defaultLane = (target: string): Lane => (target === 'RCA' ? 'left' : 'right');

export const laneFor = (target: string, azimuth: number | null | undefined): Lane => {
  const lane = defaultLane(target);
  return Math.abs(azimuth ?? 0) > 90 ? (lane === 'left' ? 'right' : 'left') : lane;
};

/**
 * The lane for a label: the radiological convention, unless its anchor sits well on the other side of the
 * heart (beyond a quarter of the heart's width from its centre — an opened heart, an unusual angle), where
 * following the convention would drag the leader across the whole organ.
 */
export function resolveLane(
  target: string,
  azimuth: number | null | undefined,
  anchorX: number,
  heart: { minX: number; maxX: number } | null,
): Lane {
  const lane = laneFor(target, azimuth);
  if (!heart) return lane;
  const cx = (heart.minX + heart.maxX) / 2;
  const quarter = (heart.maxX - heart.minX) / 4;
  if (lane === 'right' && anchorX < cx - quarter) return 'left';
  if (lane === 'left' && anchorX > cx + quarter) return 'right';
  return lane;
}

/** Minimum gap between labels (V2 §5.14: at least 28 px apart) and from the free-area edge. */
export const LABEL_MIN_GAP = 28;
export const LANE_MARGIN = 12;
/** Horizontal distance between the heart's silhouette and the inner edge of a lane. */
export const LANE_OFFSET = 28;

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

export interface LaneItem {
  id: string;
  lane: Lane;
  /** Projected anchor, canvas px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The free area in canvas px (edges, not insets). */
export interface LaneBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LanePlacement {
  /** Label box, canvas px. */
  left: number;
  top: number;
  /** Inner edge of the label (where the leader starts) and the leader's y. */
  edgeX: number;
  edgeY: number;
}

/**
 * Lane layout (V2 §5.14): labels sit in two lanes just outside the heart's silhouette, inside the free
 * area — never under a card, never clipped by the canvas edge — at least `gap` px apart, in anchor order
 * so leaders never cross. The left lane is right-aligned (its inner edges line up next to the heart), the
 * right lane left-aligned.
 */
export function layoutLanes(
  items: readonly LaneItem[],
  bounds: LaneBounds,
  heart: { minX: number; maxX: number } | null,
  gap = LABEL_MIN_GAP,
  margin = LANE_MARGIN,
  offset = LANE_OFFSET,
): Map<string, LanePlacement> {
  const out = new Map<string, LanePlacement>();
  for (const lane of ['left', 'right'] as const) {
    const group = items.filter((i) => i.lane === lane);
    if (group.length === 0) continue;
    const h = Math.max(...group.map((i) => i.height));
    const step = Math.max(gap, h + 4);
    const minY = bounds.top + margin + h / 2;
    const maxY = Math.max(minY, bounds.bottom - margin - h / 2);
    const ys = stackLane(group, step, minY, maxY);
    for (const item of group) {
      const lo = bounds.left + margin;
      const hi = Math.max(lo, bounds.right - margin - item.width);
      let left: number;
      if (lane === 'left') {
        const inner = heart ? heart.minX - offset : lo + item.width;
        left = Math.min(hi, Math.max(lo, inner - item.width));
      } else {
        const inner = heart ? heart.maxX + offset : hi;
        left = Math.min(hi, Math.max(lo, inner));
      }
      const cy = ys.get(item.id) ?? item.y;
      out.set(item.id, {
        left,
        top: cy - item.height / 2,
        edgeX: lane === 'left' ? left + item.width : left,
        edgeY: cy,
      });
    }
  }
  return out;
}

/**
 * Labels point at vessels the viewer can see: below "Ribs open" the chest wall still covers the heart, so
 * they fade out as the peel closes (and back in on the way to "Lungs aside"). Pure.
 */
export const LABEL_COVER = [0.3, 0.45] as const;
export function coverFade(peel: number): number {
  const t = Math.min(1, Math.max(0, (peel - LABEL_COVER[0]) / (LABEL_COVER[1] - LABEL_COVER[0])));
  return t * t * (3 - 2 * t);
}

/**
 * Open-heart layout (the two halves spread across the stage): the lanes beside "the heart" would sit on the
 * swung-out anterior half, so the vessel labels go in one row just BELOW the halves' union silhouette (or
 * above it when there is no room below), each over its own anchor, at least `gap` px apart and in anchor
 * order so the leaders never cross. Null when neither row fits inside the free area. Pure; unit-tested.
 */
export function layoutRow(
  items: readonly LaneItem[],
  bounds: LaneBounds,
  union: { minX: number; maxX: number; minY: number; maxY: number },
  gap = 12,
  margin = LANE_MARGIN,
  offset = LANE_OFFSET,
): Map<string, LanePlacement> | null {
  if (items.length === 0) return new Map();
  const h = Math.max(...items.map((i) => i.height));
  const below = union.maxY + offset + h / 2;
  const above = union.minY - offset - h / 2;
  const cy = below + h / 2 <= bounds.bottom - margin ? below : above - h / 2 >= bounds.top + margin ? above : null;
  if (cy === null) return null;
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const lo = bounds.left + margin;
  const hi = bounds.right - margin;
  // Centre each label on its anchor, push right to keep the gap, then pull back from the right edge.
  const lefts = sorted.map((i) => Math.max(lo, i.x - i.width / 2));
  for (let k = 1; k < sorted.length; k += 1) lefts[k] = Math.max(lefts[k]!, lefts[k - 1]! + sorted[k - 1]!.width + gap);
  for (let k = sorted.length - 1; k >= 0; k -= 1) {
    const limit = k === sorted.length - 1 ? hi - sorted[k]!.width : lefts[k + 1]! - gap - sorted[k]!.width;
    lefts[k] = Math.max(lo, Math.min(lefts[k]!, limit));
  }
  const out = new Map<string, LanePlacement>();
  sorted.forEach((item, k) => {
    const left = lefts[k]!;
    out.set(item.id, {
      left,
      top: cy - item.height / 2,
      edgeX: Math.min(left + item.width, Math.max(left, item.x)),
      edgeY: cy === below ? cy - item.height / 2 : cy + item.height / 2,
    });
  });
  return out;
}

/** Chamber tags shown at Open heart (V2 §10 explode): code, full name, and the valve they point at. */
export const CHAMBER_TAGS = [
  { id: 'LV', name: 'Left ventricle', valve: 'mitral valve' },
  { id: 'RV', name: 'Right ventricle', valve: 'tricuspid valve' },
  { id: 'LA', name: 'Left atrium', valve: null },
  { id: 'RA', name: 'Right atrium', valve: null },
] as const;
export type ChamberId = (typeof CHAMBER_TAGS)[number]['id'];
/** DOM nodes of the chamber tags (positioned by the projector). */
export const chamberEls = new Map<string, HTMLElement>();

/** Chamber tags fade in over the last part of the heart's opening. Pure. */
export const chamberFade = (heartOpen: number): number => {
  // Only on the (nearly) opened heart: they are gone within the first fifth of ⟲ Assemble, before the
  // halves close over the chambers they name.
  const t = Math.min(1, Math.max(0, (heartOpen - 0.88) / 0.1));
  return t * t * (3 - 2 * t);
};

/** Largest move (px) of a label per frame while it glides between the open-heart row and the lanes. */
export const LAYOUT_GLIDE_STEP = 36;

/**
 * One frame of a label's glide from where it is drawn toward its new layout slot: an exponential approach
 * (`rate` of the remaining distance) capped at `maxStep` px, so a switch between the open-heart row and the
 * side lanes is a short glide, never a one-frame jump, whatever the frame rate. Returns true when arrived.
 */
export function glideToward(
  drawn: { left: number; top: number; edgeX: number; edgeY: number },
  target: { left: number; top: number; edgeX: number; edgeY: number },
  rate = 0.35,
  maxStep = LAYOUT_GLIDE_STEP,
): boolean {
  const dx = target.left - drawn.left;
  const dy = target.top - drawn.top;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5) {
    Object.assign(drawn, target);
    return true;
  }
  const step = Math.min(maxStep, Math.max(dist * rate, Math.min(dist, 2)));
  const k = step / dist;
  drawn.left += dx * k;
  drawn.top += dy * k;
  drawn.edgeX += (target.edgeX - drawn.edgeX) * k;
  drawn.edgeY += (target.edgeY - drawn.edgeY) * k;
  return false;
}
