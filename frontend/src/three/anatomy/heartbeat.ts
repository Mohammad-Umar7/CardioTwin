/**
 * Heartbeat (DESIGN_SYSTEM §6 "Physiology loops"): HR from the patient's PR (clamped 40–140 bpm);
 * systole = 35 % of the RR interval, scaling 1 → 0.97 with ease-in-out; diastole = 65 %, ease-out back
 * to 1. Scale only — never luminance.
 */

export const BEAT_MIN_BPM = 40;
export const BEAT_MAX_BPM = 140;
export const SYSTOLE_FRACTION = 0.35;
export const SYSTOLE_SCALE = 0.97;

export const clampHeartRate = (bpm: unknown): number => {
  const n = typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : 72;
  return Math.min(BEAT_MAX_BPM, Math.max(BEAT_MIN_BPM, n));
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Scale factor at `phase` ∈ [0, 1) of the cardiac cycle. */
export function beatScale(phase: number): number {
  const x = phase - Math.floor(phase);
  const depth = 1 - SYSTOLE_SCALE;
  if (x < SYSTOLE_FRACTION) return 1 - depth * easeInOut(x / SYSTOLE_FRACTION);
  return SYSTOLE_SCALE + depth * easeOut((x - SYSTOLE_FRACTION) / (1 - SYSTOLE_FRACTION));
}

/** True during diastole (flow particles run ×1.6 faster then). */
export const inDiastole = (phase: number): boolean => phase - Math.floor(phase) >= SYSTOLE_FRACTION;
