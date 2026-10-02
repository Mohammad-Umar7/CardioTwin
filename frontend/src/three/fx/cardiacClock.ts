/**
 * The shared heartbeat clock of the scene (one per page, a module singleton).
 *
 * WHY: every rhythmic thing on screen — the myocardial beat, the diastolic flow surge of the particles,
 * the per-beat pulse wave — must sit on the SAME phase, at the patient's own rate. The clock is advanced
 * exactly once per rendered frame by <CardiacClockDriver> (useFrame priority −1, i.e. before every
 * default-priority subscriber), so any consumer reading it inside useFrame sees this frame's value.
 *
 * Its phase is the PHYSIOLOGICAL phase of `anatomy/heartbeat.ts`: each interval between the landmarks (isovolumic
 * contraction, ejection, isovolumic relaxation, rapid filling, diastasis, atrial systole) runs in its own real
 * duration at the patient's rate (`phaseDurations`), so a faster heart shortens diastole, not systole. One beat
 * still takes exactly one RR interval.
 *
 * FOR THE 3D LAYER (`anatomy/useHeartbeat.ts`): replace the local `phase` ref with
 *     const beats = cardiacClock.beats;            // cumulative beats, phase = beats mod 1
 *     apply(beatScale(beats));
 * The rate rule is identical to the one in useHeartbeat (PR clamped 40–140 bpm, new rate at the next beat
 * boundary). Until that switch lands, the clock phase-locks itself to the observed heart scale (see
 * `observeHeartScale`), so particles and pulse still surge on the heart's real diastole.
 */
import {
  DEFAULT_PROFILE,
  PHASE_INTERVALS,
  SYSTOLE_FRACTION,
  clampHeartRate,
  phaseDurations,
  type BeatProfile,
} from '../anatomy/heartbeat';
import { wrapPhase } from './cardiacCycle';

/** What sets the intervals' durations besides the rate. */
export type BeatPhysiology = Pick<BeatProfile, 'age' | 'hypertension' | 'female'>;

const samePhysiology = (a: BeatPhysiology, b: BeatPhysiology) => a.age === b.age && a.hypertension === b.hypertension && a.female === b.female;
/** Index of the interval of `PHASE_INTERVALS` that phase x ∈ [0, 1) lies in. */
function intervalAt(x: number): number {
  for (let i = 0; i < PHASE_INTERVALS.length; i += 1) if (x < PHASE_INTERVALS[i]![1] - 1e-12) return i;
  return PHASE_INTERVALS.length - 1;
}

/** Largest relative rate change the phase-lock may apply while absorbing an error (±15 %). */
export const PLL_MAX_SLEW = 0.15;
/** Phase errors below this (in beats) are treated as locked: one frame at 140 bpm ≈ 0.04 beats. */
export const PLL_DEADBAND = 0.035;
/** Errors above this snap immediately (first lock, or after the heart was paused). */
export const PLL_SNAP = 0.3;

export class CardiacClock {
  /** Cumulative beats since the clock started; the phase is `beats mod 1` (0 = onset of systole). */
  beats = 0;
  /** Current rate in beats per minute (changes only at a beat boundary). */
  bpm = 72;
  /** Rate requested for the next beat boundary. */
  private pendingBpm = 72;
  /** Physiology (age, hypertension, sex) of the current beat and the one requested for the next. */
  private physiology: BeatPhysiology = DEFAULT_PROFILE;
  private pendingPhysiology: BeatPhysiology = DEFAULT_PROFILE;
  /** Real duration (s) of each interval of the current beat. */
  private durations = phaseDurations({ ...DEFAULT_PROFILE, bpm: 72 });
  /** Elapsed-time key of the last tick, so several callers in one frame advance it only once. */
  private lastKey = Number.NaN;
  /** Phase error still to be absorbed by slewing the rate (beats). */
  private correction = 0;
  /** Phase-lock detector state. */
  private lastScale = Number.NaN;
  private falling = false;
  /** Phase advanced by the last tick (beats), used to compensate the detector's latency. */
  private lastStep = 0;

  get phase(): number {
    return wrapPhase(this.beats);
  }

  get inDiastole(): boolean {
    return this.phase >= SYSTOLE_FRACTION;
  }

  /** Seconds per beat at the current rate. */
  get period(): number {
    return 60 / this.bpm;
  }

  /** Request a heart rate (bpm, clamped 40–140); it takes effect at the next beat boundary. */
  setRate(bpm: unknown): void {
    this.pendingBpm = clampHeartRate(bpm);
  }

  /** Request the patient's physiology (interval durations); it takes effect at the next beat boundary. */
  setPhysiology(physiology: BeatPhysiology): void {
    if (!samePhysiology(physiology, this.pendingPhysiology)) {
      this.pendingPhysiology = { age: physiology.age, hypertension: physiology.hypertension, female: physiology.female };
    }
  }

  /** Real duration (s) of each interval of the current beat (`PHASE_INTERVALS`). */
  get intervalDurations(): readonly number[] {
    return this.durations;
  }

  /** The next beat starts: its rate and physiology take effect. */
  private beginBeat(): void {
    if (this.bpm === this.pendingBpm && this.physiology === this.pendingPhysiology) return;
    this.bpm = this.pendingBpm;
    this.physiology = this.pendingPhysiology;
    this.durations = phaseDurations({ ...this.physiology, bpm: this.bpm });
  }

  /**
   * Phase advanced in `dt` seconds from `this.beats`, each interval at its own speed (crossing a beat boundary
   * switches to the requested rate there).
   */
  private advance(dt: number): number {
    let beats = this.beats;
    let left = dt;
    for (let guard = 0; left > 1e-12 && guard < 64; guard += 1) {
      const phase = wrapPhase(beats);
      const start = beats - phase;
      const i = intervalAt(phase);
      const [a, b] = PHASE_INTERVALS[i]!;
      const duration = this.durations[i]!;
      const rate = duration > 1e-9 ? (b - a) / duration : Number.POSITIVE_INFINITY;
      const need = (b - phase) / rate;
      if (need > left) {
        beats += left * rate;
        left = 0;
      } else {
        beats = start + b;
        left -= need;
        if (b >= 1) this.beginBeat();
      }
    }
    return beats - this.beats;
  }

  /**
   * Advance by `delta` seconds (clamped to 0.1 s so a background tab does not fast-forward). Idempotent
   * per `key` (the frame's elapsed time): a second call with the same key is a no-op.
   */
  tick(delta: number, key: number = Number.NaN): void {
    if (!Number.isNaN(key) && key === this.lastKey) return;
    this.lastKey = key;
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const before = this.beats;
    let step = this.advance(dt);
    if (this.correction !== 0) {
      const slew = Math.max(-PLL_MAX_SLEW * step, Math.min(PLL_MAX_SLEW * step, this.correction));
      step += slew;
      this.correction -= slew;
    }
    this.beats += step;
    this.lastStep = step;
    if (Math.floor(this.beats) !== Math.floor(before)) this.beginBeat();
  }

  /**
   * Phase-lock to an observed beat: pass the heart's current beat scale every frame. The minimum of the
   * scale marks end-systole (φ = SYSTOLE_FRACTION); when the scale turns from falling to rising the
   * clock's phase error is measured and absorbed by slewing the rate by ≤ ±15 % (large errors snap).
   * A scale that never changes (beat off, reduced motion) leaves the clock free-running.
   *
   * Latency: the driver ticks before the heart's own useFrame, so the scale read here is last frame's;
   * the smallest sample is two frames old when the turn is seen, so the heart is now ≈ 2 steps past it.
   */
  observeHeartScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    const prev = this.lastScale;
    this.lastScale = scale;
    if (Number.isNaN(prev) || Math.abs(scale - prev) < 1e-6) return;
    const falling = scale < prev;
    if (this.falling && !falling) this.lockTo(SYSTOLE_FRACTION + 2 * this.lastStep);
    this.falling = falling;
  }

  /** Align the clock so that "now" is at `phase` (gradually unless the error is large). */
  lockTo(phase: number): void {
    let error = wrapPhase(phase - this.phase + 0.5) - 0.5; // shortest signed distance, (−0.5, 0.5]
    error -= this.correction; // part of it may already be queued
    if (Math.abs(error) < PLL_DEADBAND) return;
    if (Math.abs(error + this.correction) > PLL_SNAP) {
      this.beats += error + this.correction;
      this.correction = 0;
      return;
    }
    this.correction += error;
  }

  /** Reset (tests, or a remounted canvas). */
  reset(beats = 0, bpm = 72, physiology: BeatPhysiology = DEFAULT_PROFILE): void {
    this.beats = beats;
    this.bpm = bpm;
    this.pendingBpm = bpm;
    this.physiology = physiology;
    this.pendingPhysiology = physiology;
    this.durations = phaseDurations({ ...physiology, bpm });
    this.lastKey = Number.NaN;
    this.correction = 0;
    this.lastScale = Number.NaN;
    this.falling = false;
    this.lastStep = 0;
  }
}

/** The scene's clock. Read it inside useFrame; never store its values in React state. */
export const cardiacClock = new CardiacClock();
