/**
 * Autoplay clock for the guided demo (pure reducer + a rAF hook). Each beat runs for its duration, then
 * the demo advances; the last beat holds at 100 %. The viewer can pause at any time (WCAG 2.2.2), and a
 * hidden tab never burns time (frame deltas are capped).
 */
import { useEffect, useRef } from 'react';

export interface ClockState {
  beat: number;
  elapsed: number;
  playing: boolean;
  ended: boolean;
}

/** Longest frame delta counted, so a backgrounded tab or a long task cannot skip a beat. */
export const MAX_FRAME_MS = 100;

export function tick(s: ClockState, dtMs: number, durations: readonly number[]): ClockState {
  if (!s.playing || s.ended || durations.length === 0) return s;
  const d = durations[s.beat] ?? 0;
  const elapsed = s.elapsed + Math.min(Math.max(0, dtMs), MAX_FRAME_MS);
  if (elapsed < d) return { ...s, elapsed };
  if (s.beat < durations.length - 1) return { ...s, beat: s.beat + 1, elapsed: 0 };
  return { ...s, elapsed: d, playing: false, ended: true };
}

/** Fraction of the whole demo done, 0–1. */
export function overallProgress(s: Pick<ClockState, 'beat' | 'elapsed'>, durations: readonly number[]): number {
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const before = durations.slice(0, s.beat).reduce((a, b) => a + b, 0);
  return Math.min(1, (before + Math.min(s.elapsed, durations[s.beat] ?? 0)) / total);
}

export interface TourClockOptions {
  beat: number;
  playing: boolean;
  durations: readonly number[];
  /** Called when the clock moves to another beat on its own. */
  onAdvance(beat: number): void;
  /** Called when the last beat completes. */
  onEnd(): void;
  /** Called every frame with the current beat's progress (0–1); write to the DOM, not to React state. */
  onProgress(beat: number, fraction: number): void;
}

/** Drives `tick` from requestAnimationFrame. Restarts the beat's time whenever `beat` changes. */
export function useTourClock({ beat, playing, durations, onAdvance, onEnd, onProgress }: TourClockOptions): void {
  const state = useRef<ClockState>({ beat, elapsed: 0, playing, ended: false });
  const cb = useRef({ onAdvance, onEnd, onProgress });
  cb.current = { onAdvance, onEnd, onProgress };

  useEffect(() => {
    state.current = { beat, elapsed: 0, playing: state.current.playing, ended: false };
    cb.current.onProgress(beat, 0);
  }, [beat]);

  useEffect(() => {
    state.current = { ...state.current, playing };
  }, [playing]);

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const before = state.current;
      const after = tick(before, document.visibilityState === 'hidden' ? 0 : dt, durations);
      state.current = after;
      const d = durations[after.beat] ?? 1;
      cb.current.onProgress(after.beat, d > 0 ? after.elapsed / d : 1);
      if (after.beat !== before.beat) cb.current.onAdvance(after.beat);
      if (after.ended && !before.ended) cb.current.onEnd();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [durations]);
}
