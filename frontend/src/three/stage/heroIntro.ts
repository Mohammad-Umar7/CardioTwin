/**
 * The landing hero and its "Enter Workstation" dolly, shared by the landing page (DOM) and the 3D stage.
 *
 *   useHeroIntro   discrete state: the page starts the dolly (`enter`) and navigates when its clock runs out;
 *                  the camera rig plays the same clock, so a throttled frame loop never holds the navigation
 *                  back. `live` says whether the hero may move on its own (on screen, motion allowed).
 *   heroRuntime    per-frame values (no React state): written by the camera rig and the page's pointer
 *                  listener, read by the anatomy rig (the chest fade), the vessel colours and the backdrop.
 *
 * The workstation never reads either: every reader checks `viewerStore.stage === 'hero'` first.
 */
import { create } from 'zustand';
import type { StageInsets } from '@/state/uiStore';

export type HeroIntroPhase = 'idle' | 'entering';

export interface HeroIntroState {
  phase: HeroIntroPhase;
  /** `performance.now()` when the dolly started. */
  startedAt: number;
  /** Length of the camera move (ms). */
  duration: number;
  /**
   * The free area the workstation publishes on arrival (its cards' insets), so the dolly ends on the
   * workstation's own home framing and the route change needs no cut. Null: frame the heart in this canvas.
   */
  arrival: StageInsets | null;
  /** The hero is on screen and motion is allowed: the idle drift and the pointer parallax may run. */
  live: boolean;

  enter(duration: number, arrival: StageInsets | null): void;
  reset(): void;
  setLive(live: boolean): void;
}

export const useHeroIntro = create<HeroIntroState>()((set, get) => ({
  phase: 'idle',
  startedAt: 0,
  duration: 0,
  arrival: null,
  live: false,

  enter: (duration, arrival) => {
    if (get().phase === 'entering') return;
    set({ phase: 'entering', startedAt: performance.now(), duration: Math.max(1, duration), arrival });
  },
  reset: () => set({ phase: 'idle', startedAt: 0, duration: 0, arrival: null }),
  setLive: (live) => {
    if (get().live !== live) set({ live });
  },
}));

export const heroRuntime = {
  /** Dolly progress 0..1 (0 on the landing at rest, 1 on the workstation's home framing). */
  intro: 0,
  /** Shift of the backdrop's light centre (share of the canvas width), so it sits behind the torso. */
  backdropShift: 0,
  /** Gain on the backdrop's coloured light (1 = the workstation's; the hero keeps it low, no blue haze). */
  backdropGlow: 1,
  /** Pointer over the page, −1..1 from the hero's centre; inactive without a fine pointer. */
  pointer: { x: 0, y: 0, active: false },
};
