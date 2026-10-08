/**
 * Where the persistent canvas is currently mounted. Pages render <CanvasSlot stage="…"/>; SceneHost
 * moves the single WebGL canvas into the most recently registered slot (and parks it off-screen,
 * paused, when no page wants it).
 */
import { create } from 'zustand';
import type { Stage } from '@/state/viewerStore';

export interface SceneSlotState {
  slot: HTMLElement | null;
  stage: Stage;
  register(el: HTMLElement, stage: Stage): void;
  unregister(el: HTMLElement): void;
}

export const useSceneSlot = create<SceneSlotState>()((set, get) => ({
  slot: null,
  stage: 'hidden',
  register: (el, stage) => set({ slot: el, stage }),
  unregister: (el) => {
    if (get().slot === el) set({ slot: null, stage: 'hidden' });
  },
}));

export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How long a handoff request stays valid: the route change it announces follows at once. */
const HANDOFF_TTL_MS = 1000;

const pending: { rect: SlotRect | null; at: number } = { rect: null, at: 0 };

/**
 * A page about to hand the canvas to the next page at the SAME place and size (the landing's dolly lands on
 * the workstation's own framing) announces the canvas's current rectangle. SceneHost then skips its veil for
 * that one move: the last frame drawn on this page is already the next page's first.
 */
export function announceSeamlessHandoff(rect: SlotRect): void {
  pending.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  pending.at = performance.now();
}

/** The announced rectangle, once (null when none is pending or it has expired). */
export function takeSeamlessHandoff(): SlotRect | null {
  const rect = pending.rect && performance.now() - pending.at <= HANDOFF_TTL_MS ? pending.rect : null;
  pending.rect = null;
  return rect;
}

/** Same place and size, to the pixel. */
export const sameSlotRect = (a: SlotRect, b: SlotRect): boolean =>
  Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
