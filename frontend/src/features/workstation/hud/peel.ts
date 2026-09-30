/**
 * Peel control logic for the canvas toolbar (WORKSTATION_V2 §5.11): the five detents, magnetic snapping,
 * detent stepping for ←/→ and the ▶ Explode / ⟲ Assemble player. The scene's own spring smooths every
 * change of `viewerStore.explode`; the player drives the target value along LUMEN's peel timeline.
 * Pure helpers are unit-tested in hud.test.ts.
 */
import { create } from 'zustand';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { PEEL_DETENTS } from '@/three/anatomy/explode';

export interface Detent {
  id: string;
  label: string;
  value: number;
}

export const DETENTS: readonly Detent[] = PEEL_DETENTS;
/** Magnetic radius around each detent (V2 §5.11: ±0.02). */
export const SNAP_RADIUS = 0.02;
/** "Open heart" and beyond count as dissected: the button offers ⟲ Assemble. */
export const OPEN_AT = 0.95;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Snap to a detent within `radius`; otherwise the value itself (clamped to 0–1). */
export function snapToDetent(value: number, radius = SNAP_RADIUS): number {
  const v = clamp01(value);
  for (const d of DETENTS) if (Math.abs(v - d.value) <= radius) return d.value;
  return v;
}

/** The next detent strictly above (dir 1) or below (dir −1) `value`; stays at the ends. */
export function stepDetent(value: number, dir: 1 | -1): number {
  const eps = 1e-3;
  if (dir > 0) return DETENTS.find((d) => d.value > value + eps)?.value ?? DETENTS[DETENTS.length - 1]!.value;
  return [...DETENTS].reverse().find((d) => d.value < value - eps)?.value ?? DETENTS[0]!.value;
}

/** The detent nearest to `value` (its name is shown above the thumb while dragging). */
export function nearestDetent(value: number): Detent {
  let best = DETENTS[0]!;
  for (const d of DETENTS) if (Math.abs(d.value - value) < Math.abs(best.value - value)) best = d;
  return best;
}

/** Spoken value for the slider: the detent name at a detent, else the nearest stage and the percentage. */
export function peelValueText(value: number): string {
  const d = nearestDetent(value);
  if (Math.abs(d.value - value) <= 0.005) return d.label;
  return `${Math.round(value * 100)} percent open, near ${d.label.toLowerCase()}`;
}

// ------------------------------------------------------------------------------------ player

/**
 * Peel timings. ▶ Explode from rest is heart-centric and unhurried (the owner's "separates and comes back"):
 * the great vessels lift, then the anterior half swings open over PEEL_OPEN_MS while the thorax stays
 * ghosted — one camera move. From a closed chest the whole dissection plays (PEEL_FORWARD_MS for 0 → 1).
 * ⟲ Assemble takes PEEL_ASSEMBLE_MS from the open heart back to rest (scaled by the distance).
 */
export const PEEL_OPEN_MS = 2400;
export const PEEL_FORWARD_MS = 2800;
export const PEEL_ASSEMBLE_MS = 1500;
/** Shortest segment (a nudge from just below Open heart still reads as motion). */
const MIN_SEGMENT_MS = 500;

export interface PeelSegment {
  from: number;
  to: number;
  ms: number;
}

/**
 * ▶ Explode: from rest (or anywhere in the heart's range) straight to the open heart; from a closed chest, the
 * whole dissection (skin, ribs, lungs, then the heart) in one sweep — never closing the chest first.
 * ⟲ Assemble: back to rest.
 */
export function peelPlan(current: number, to: 'dissect' | 'assemble'): PeelSegment[] {
  if (to === 'assemble') {
    const span = Math.abs(current - PEEL_REST);
    if (span < 1e-3) return [];
    return [{ from: current, to: PEEL_REST, ms: Math.max(MIN_SEGMENT_MS, Math.round((PEEL_ASSEMBLE_MS * span) / (1 - PEEL_REST))) }];
  }
  if (current >= 1 - 1e-3) return [];
  const ms =
    current >= PEEL_REST - 0.02
      ? (PEEL_OPEN_MS * (1 - current)) / (1 - PEEL_REST)
      : PEEL_FORWARD_MS * (1 - current);
  return [{ from: current, to: 1, ms: Math.max(MIN_SEGMENT_MS, Math.round(ms)) }];
}

/** LUMEN `peel` easing, cubic-bezier(.65,0,.35,1) ≈ ease-in-out cubic. */
export const peelEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Peel value at `elapsed` ms into a plan (and whether it is finished). */
export function peelAt(plan: readonly PeelSegment[], elapsed: number): { value: number; done: boolean } {
  let t = elapsed;
  for (const seg of plan) {
    if (t < seg.ms) return { value: seg.from + (seg.to - seg.from) * peelEase(t / seg.ms), done: false };
    t -= seg.ms;
  }
  const last = plan[plan.length - 1];
  return { value: last ? last.to : useViewerStore.getState().explode, done: true };
}

export interface PeelPlayerState {
  playing: 'dissect' | 'assemble' | null;
  play(to: 'dissect' | 'assemble', reduced: boolean): void;
  stop(): void;
  /** P / the toolbar button: stop while playing, assemble when open, dissect otherwise. */
  toggle(reduced: boolean): void;
}

let raf = 0;

export const usePeelPlayer = create<PeelPlayerState>()((set, get) => ({
  playing: null,
  play: (to, reduced) => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const plan = peelPlan(useViewerStore.getState().explode, to);
    if (plan.length === 0) {
      set({ playing: null });
      return;
    }
    if (reduced || typeof requestAnimationFrame !== 'function') {
      useViewerStore.getState().setExplode(plan[plan.length - 1]!.to);
      set({ playing: null });
      return;
    }
    set({ playing: to });
    const start = performance.now();
    const step = (now: number) => {
      const { value, done } = peelAt(plan, now - start);
      useViewerStore.getState().setExplode(value);
      if (done) {
        raf = 0;
        set({ playing: null });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  },
  stop: () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    set({ playing: null });
  },
  toggle: (reduced) => {
    const s = get();
    if (s.playing) s.stop();
    else s.play(useViewerStore.getState().explode >= OPEN_AT ? 'assemble' : 'dissect', reduced);
  },
}));
