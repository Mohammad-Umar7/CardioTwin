/**
 * Frame-rate sampling for the adaptive tier (pure; unit tested in three.test.ts). Frames are counted in
 * `windowMs` windows; `iterations` windows make one decision against the [decline, incline) bounds; a gap
 * longer than `gapMs` between two frames (the page was not composited) restarts the current window and
 * never counts as a slow frame.
 */
export const QUALITY_MONITOR = { windowMs: 250, iterations: 8, gapMs: 100, decline: 45, incline: 58, flipflops: 3 } as const;

export interface QualitySampler {
  last: number;
  t0: number;
  frames: number;
  windows: number[];
  /** Direction of the last tier move (+1 up, −1 down, 0 none) and how many times it reversed. */
  lastMove: number;
  flips: number;
}

export interface QualityStep {
  /** Frame rate of a window that just closed, else null. */
  fps: number | null;
  move: 'up' | 'down' | 'fallback' | null;
}

export function qualityStep(s: QualitySampler, now: number, hidden = false, cfg = QUALITY_MONITOR): QualityStep {
  const none: QualityStep = { fps: null, move: null };
  if (hidden || s.last === 0 || now - s.last > cfg.gapMs) {
    // A pause invalidates the decision in progress too: it restarts from fresh windows.
    s.last = hidden ? 0 : now;
    s.t0 = now;
    s.frames = 0;
    s.windows = [];
    return none;
  }
  s.last = now;
  s.frames += 1;
  const elapsed = now - s.t0;
  if (elapsed < cfg.windowMs) return none;
  const fps = Math.round(((s.frames * 1000) / elapsed) * 10) / 10;
  s.t0 = now;
  s.frames = 0;
  s.windows.push(fps);
  if (s.windows.length < cfg.iterations) return { fps, move: null };
  const avg = s.windows.reduce((a, b) => a + b, 0) / s.windows.length;
  s.windows = [];
  const dir = avg >= cfg.incline ? 1 : avg < cfg.decline ? -1 : 0;
  if (dir === 0) return { fps, move: null };
  if (s.lastMove !== 0 && dir !== s.lastMove) s.flips += 1;
  s.lastMove = dir;
  if (s.flips >= cfg.flipflops) return { fps, move: 'fallback' };
  return { fps, move: dir > 0 ? 'up' : 'down' };
}
