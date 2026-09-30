/** Pure stage-layout rules (WORKSTATION_V2 §4.1, §4.7), shared by StageLayout and its tests. */
import type { CSSProperties } from 'react';
import type { Chrome, DrawerId, StageInsets } from '@/state/uiStore';

/** Slots of the V2 stage (WORKSTATION_V2 §4.1, §9.2 item 3). */
export type StageSlot = 'left' | 'right' | 'top' | 'bottom' | 'bottomLeft' | 'drawers' | 'overlay';

/**
 * Which slots each chrome preset shows (V2 §4.1). `right` stays mounted in focus mode: the owner renders
 * only the inspector there (selection brings it back) and the column moves below the answer pill.
 */
export const CHROME_SLOTS: Record<Chrome, Record<Exclude<StageSlot, 'drawers' | 'overlay'>, boolean>> = {
  workstation: { left: true, right: true, top: true, bottom: true, bottomLeft: true },
  focus: { left: false, right: true, top: false, bottom: false, bottomLeft: false },
  tour: { left: true, right: true, top: true, bottom: false, bottomLeft: false },
  landing: { left: false, right: false, top: false, bottom: false, bottomLeft: false },
};

export interface InsetInput {
  chrome: Chrome;
  drawer: DrawerId | null;
  stageInset: number;
  /** Measured box of the left slot content (0 × 0 when empty or hidden). */
  left: { width: number; height: number };
  right: { width: number; height: number };
  bottom: { width: number; height: number };
  drawerInputsWidth: number;
  drawerExplainWidth: number;
}

/**
 * Stage insets from the measured slots (pure, unit-tested). A side covered by chrome counts the stage
 * inset, the element and a breathing gap equal to the inset; a bare side counts 0, except the top, which
 * keeps the 12 px inset while cards are shown (V2 §4.7: free area x 304–1064, y 60–808 at 1440×900).
 */
export function computeStageInsets(m: InsetInput): StageInsets {
  const show = CHROME_SLOTS[m.chrome];
  const g = m.stageInset;
  const covers = (visible: boolean, box: { width: number; height: number }, size: number) =>
    visible && box.width > 0 && box.height > 0 ? g + size + g : 0;
  // A drawer docks at the stage edge (x 0) and replaces the card on its side while it is open.
  let left = covers(show.left && m.drawer !== 'inputs', m.left, m.left.width);
  let right = covers(show.right && m.drawer !== 'explain', m.right, m.right.width);
  if (m.drawer === 'inputs') left = Math.max(left, m.drawerInputsWidth + g);
  if (m.drawer === 'explain') right = Math.max(right, m.drawerExplainWidth + g);
  const bottom = covers(show.bottom, m.bottom, m.bottom.height);
  const cardsShown = show.left || show.right || show.bottom;
  return { left, right, top: cardsShown ? g : 0, bottom: bottom || (cardsShown ? g : 0) };
}

/** Enter over `base` with the out curve; exit over 170 ms (0.7 × base) with the exit curve (LUMEN §6). */
const ENTER = 'var(--dur-base) var(--ease-out)';
const EXIT = '170ms var(--ease-exit)';
/** The free-area glide of the centred slots and the column moves: `flyout`, never staggered. */
const GLIDE = 'var(--dur-flyout) var(--ease-out)';

/**
 * Transition of a slot: opacity and transform (the enter / exit, staggered by `delay`) plus the layout
 * glides (`translate` for the centred slots, `top` for the right column), which start at once so they stay
 * in step with the camera's view offset.
 */
export function slotTransition(visible: boolean, delay: number, glide: 'translate' | 'top'): CSSProperties {
  const fade = visible ? ENTER : EXIT;
  return {
    transition: `opacity ${fade} ${delay}ms, transform ${fade} ${delay}ms, ${glide} ${GLIDE} 0ms`,
  };
}

export interface ToolbarPlacement {
  stageWidth: number;
  insets: StageInsets;
  /** Measured toolbar width. */
  width: number;
  /** Right edge of the legend chip (stage px) while it shows, else 0. */
  legendRight: number;
  /** Left edge of a drawer docked on the right (stage px), else the stage width. */
  rightLimit: number;
  /** Minimum clearance to the legend and the drawer. */
  gap: number;
}

/**
 * Horizontal offset of the toolbar from the stage centre (px). It is centred on the free area (V2 §4.7),
 * then nudged right just enough to clear the legend chip that shares its bottom band, and left to stay
 * clear of a right-hand drawer. The legend wins when both cannot hold (a narrow free area).
 */
export function toolbarOffset(p: ToolbarPlacement): number {
  const centre = (p.insets.left + p.stageWidth - p.insets.right) / 2;
  const half = p.width / 2;
  const min = p.legendRight > 0 ? p.legendRight + p.gap + half : -Infinity;
  const max = p.rightLimit - p.gap - half;
  const x = Math.max(min, Math.min(max, centre));
  return x - p.stageWidth / 2;
}
