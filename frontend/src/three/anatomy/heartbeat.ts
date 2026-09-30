/**
 * Physiological heartbeat (DESIGN_SYSTEM §6 "Physiology loops", amended by §7.9 Realistic mode).
 *
 * Phase convention (shared with `fx/cardiacCycle.ts` and `fx/cardiacClock.ts`): φ ∈ [0, 1) over one RR
 * interval, φ = 0 at the onset of ventricular systole; systole occupies [0, SYSTOLE_FRACTION).
 *
 * Two activation curves drive the anatomy (pure functions, unit tested in heartbeat.test.ts):
 *
 *   ventricular(φ) ∈ [−ATRIAL_FILL, 1]  — 0 = end-diastolic shape, 1 = end-systole (smallest ventricles).
 *     isovolumic contraction  [0,    0.05)   the wall tenses, barely moves
 *     ejection                [0.05, 0.35)   fast early ejection, peak shortening at end-systole
 *     isovolumic relaxation   [0.35, 0.42)   the wall starts to relax before the mitral valve opens
 *     rapid filling           [0.42, 0.60)   most of the recoil (early diastolic "E wave")
 *     diastasis               [0.60, 0.84)   slow filling, nearly still
 *     atrial kick             [0.84, 1)      the atria top up the ventricles: slight EXTRA filling (< 0)
 *
 *   atrial(φ) ∈ [0, 1] — a smooth bump centred in the atrial kick (the "A wave").
 *
 * The scene turns these into a small non-uniform deformation (radial + longitudinal shortening about the
 * heart's long axis, plus a regional atrial squeeze in the vertex shader); `beatScale` keeps the legacy
 * scalar (1 → 0.97 at end-systole) for the procedural placeholder heart and the fx phase lock. Scale only,
 * never luminance.
 */

export const BEAT_MIN_BPM = 40;
export const BEAT_MAX_BPM = 140;
/** End of ejection = start of diastole (the flow layer launches its pulse here). */
export const SYSTOLE_FRACTION = 0.35;
/** Legacy scalar at end-systole (LUMEN: 0.965–0.975). */
export const SYSTOLE_SCALE = 0.97;

/** Phase landmarks (fractions of the RR interval). */
export const PHASES = {
  isovolumicContraction: 0.05,
  endSystole: SYSTOLE_FRACTION,
  mitralOpening: 0.42,
  endRapidFilling: 0.6,
  atrialOnset: 0.84,
  atrialPeak: 0.93,
} as const;

/** Level of the ventricular curve at the end of isovolumic contraction / relaxation. */
const ISOVOLUMIC_LEVEL = 0.06;
const RELAXED_LEVEL = 0.88;
const DIASTASIS_LEVEL = 0.07;
/** Extra ventricular filling from the atrial kick (the curve dips this far below 0). */
export const ATRIAL_FILL = 0.12;

export const clampHeartRate = (bpm: unknown): number => {
  const n = typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : 72;
  return Math.min(BEAT_MAX_BPM, Math.max(BEAT_MIN_BPM, n));
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Wrap any real phase into [0, 1). */
export const wrap01 = (phase: number): number => phase - Math.floor(phase);
/** C¹ smooth ramp with zero slope at both ends. */
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (x: number, a: number, b: number) => (x - a) / (b - a);

/** Ventricular activation at phase φ (see the table above). Continuous over the wrap. */
export function ventricular(phase: number): number {
  const x = wrap01(phase);
  const P = PHASES;
  if (x < P.isovolumicContraction) return lerp(0, ISOVOLUMIC_LEVEL, smooth(span(x, 0, P.isovolumicContraction)));
  if (x < P.endSystole) {
    // Ejection: fast early (most of the stroke volume leaves in the first half), settling into end-systole.
    const t = span(x, P.isovolumicContraction, P.endSystole);
    return lerp(ISOVOLUMIC_LEVEL, 1, smooth(Math.sin((Math.PI / 2) * t)));
  }
  if (x < P.mitralOpening) return lerp(1, RELAXED_LEVEL, smooth(span(x, P.endSystole, P.mitralOpening)));
  if (x < P.endRapidFilling) return lerp(RELAXED_LEVEL, DIASTASIS_LEVEL, smooth(easeOut(span(x, P.mitralOpening, P.endRapidFilling))));
  if (x < P.atrialOnset) return lerp(DIASTASIS_LEVEL, 0, smooth(span(x, P.endRapidFilling, P.atrialOnset)));
  // Atrial kick: the ventricles take the last ~15 % of their filling, then systole starts again from 0.
  return -ATRIAL_FILL * atrial(x);
}

/** Atrial activation at phase φ: a smooth bump over the atrial kick, 1 at its peak, 0 elsewhere. */
export function atrial(phase: number): number {
  const x = wrap01(phase);
  const P = PHASES;
  if (x < P.atrialOnset) return 0;
  if (x < P.atrialPeak) return smooth(span(x, P.atrialOnset, P.atrialPeak));
  return 1 - smooth(span(x, P.atrialPeak, 1));
}

/**
 * Deformation amplitudes (fractions) applied at full activation. They sit inside LUMEN's 3 % budget for
 * the visible silhouette; the longitudinal term is what makes the base "descend" toward a nearly still
 * apex, which is how a real ventricle ejects (AV-plane displacement).
 */
export const BEAT_AMPLITUDE = {
  /** Radial shortening toward the long axis at end-systole. */
  radial: 0.03,
  /** Longitudinal shortening along the long axis (the base moves toward the apex). */
  longitudinal: 0.045,
  /** Regional atrial squeeze toward the atrial centre at the peak of the kick. */
  atrial: 0.04,
} as const;

/** Legacy uniform scale (procedural heart, fx phase lock): 1 → SYSTOLE_SCALE at end-systole, never > 1. */
export function beatScale(phase: number): number {
  return 1 - (1 - SYSTOLE_SCALE) * Math.max(0, ventricular(phase));
}

/** True during diastole (flow particles run faster then). */
export const inDiastole = (phase: number): boolean => wrap01(phase) >= SYSTOLE_FRACTION;

export interface BeatState {
  /** Ventricular activation (see `ventricular`). */
  v: number;
  /** Atrial activation (see `atrial`). */
  a: number;
}

/** Both activations at once, optionally scaled by an on/off envelope (0 = resting shape). */
export function beatState(phase: number, envelope = 1): BeatState {
  const k = clamp01(envelope);
  return { v: ventricular(phase) * k, a: atrial(phase) * k };
}
