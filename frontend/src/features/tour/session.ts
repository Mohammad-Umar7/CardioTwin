/**
 * One guided-demo session: what to restore, the last applied beat state, the frozen "highest-risk vessel"
 * and the running peel. Module-level so React StrictMode's mount → unmount → mount in development does not
 * capture twice or restore halfway.
 */
import type { TargetId } from '@/types/contracts';
import type { BeatState } from './script';
import { PeelAnimator } from './runtime';
import type { TourSnapshot } from './snapshot';

export interface TourSession {
  snapshot: TourSnapshot;
  /** State of the beat applied last (null = nothing applied yet: plan everything). */
  applied: BeatState | null;
  /** Highest-risk vessel, frozen at first use so a what-if cannot move the selection mid-demo. */
  top: TargetId | null;
  peel: PeelAnimator;
  /** Element focused before the demo opened, to hand focus back. */
  returnFocus: HTMLElement | null;
  /** Incremented per applied beat, so stale async continuations can bail out. */
  epoch: number;
  /** The showcase patient check ran (it waits for the cohort). */
  showcased: boolean;
}

let current: TourSession | null = null;
let mounts = 0;
let pendingEnd: ReturnType<typeof setTimeout> | null = null;

export const getSession = (): TourSession | null => current;

export function beginSession(snapshot: TourSnapshot): TourSession {
  current = {
    snapshot,
    applied: null,
    top: null,
    peel: new PeelAnimator(),
    returnFocus: typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
    epoch: 0,
    showcased: false,
  };
  return current;
}

/** Clears the session and returns it (null when none was active), so exactly one caller restores. */
export function endSession(): TourSession | null {
  const s = current;
  current = null;
  s?.peel.cancel();
  return s;
}

/**
 * Mount bookkeeping for the tour layer: `onUnmountedFor0ms` runs when the layer unmounts for real (not a
 * StrictMode remount), e.g. when something else closes the tour.
 */
export function trackMount(onUnmounted: () => void): () => void {
  mounts += 1;
  if (pendingEnd) {
    clearTimeout(pendingEnd);
    pendingEnd = null;
  }
  return () => {
    mounts -= 1;
    pendingEnd = setTimeout(() => {
      pendingEnd = null;
      if (mounts === 0) onUnmounted();
    }, 0);
  };
}
