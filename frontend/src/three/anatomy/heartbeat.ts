/**
 * Physiological heartbeat (DESIGN_SYSTEM §6 "Physiology loops", amended by §7.9 Realistic mode).
 *
 * Phase convention (shared with `fx/cardiacCycle.ts` and `fx/cardiacClock.ts`): φ ∈ [0, 1) over one RR
 * interval, φ = 0 at the onset of ventricular systole (mitral valve closure). φ is the PHYSIOLOGICAL phase: its
 * landmarks (`PHASES`) are fixed, and the clock runs each interval between them in its own real duration at the
 * patient's heart rate (`phaseDurations`). So the curves below never change shape with the rate: at 100 bpm
 * systole still takes ~0.3 s and diastole shortens, the rapid-filling and atrial waves fusing as diastasis
 * vanishes — as in a real heart, instead of the whole cycle scaling evenly.
 *
 *   interval                  φ               duration at 70 bpm (healthy adult; Weissler 1968, ASE norms)
 *   isovolumic contraction    [0,    0.05)    ~45 ms — the wall tenses, the volume holds
 *   ejection                  [0.05, 0.35)    LVET ~295 ms — fast early (peak rate a third of the way in)
 *   isovolumic relaxation     [0.35, 0.42)    IVRT ~75–95 ms — the volume holds; the LV untwists
 *   rapid filling (E wave)    [0.42, 0.60)    ~170 ms — most of the filling
 *   diastasis                 [0.60, 0.84)    what is left of the cycle — nearly still
 *   atrial systole (A wave)   [0.84, 1)       ~120 ms — the atria top up the ventricles, ending at mitral closure
 *
 * Three activation curves drive the anatomy (pure functions, unit tested in heartbeat.test.ts):
 *
 *   ventricular(φ) ∈ [0, 1] — the ventricular volume: 0 = end-diastole (the fullest, at φ = 0 after the atrial
 *     kick), 1 = end-systole. It never runs backwards: filling only rises through diastole to end-diastole.
 *   atrial(φ) ∈ [0, 1] — the atrial contraction: it squeezes through the A wave, holds at end-diastole and lets go
 *     early in ventricular systole while the atria start refilling (reservoir phase).
 *   twist(φ) ∈ [0, 1] — LV twist: it builds with ejection and recoils fast — ~40 % within isovolumic relaxation
 *     and the rest early in rapid filling — well ahead of the volume (the untwisting that sucks blood in).
 *
 * The scene turns these into a small non-uniform deformation (beatDeform.ts); `beatScale` keeps the legacy
 * scalar (1 → 0.97 at end-systole) for the procedural placeholder heart and the fx phase lock. Scale only, never
 * luminance.
 */

export const BEAT_MIN_BPM = 40;
export const BEAT_MAX_BPM = 140;
/** End of ejection = start of diastole (the flow layer launches its pulse here). */
export const SYSTOLE_FRACTION = 0.35;
/** Legacy scalar at end-systole (LUMEN: 0.965–0.975). */
export const SYSTOLE_SCALE = 0.97;

/** Phase landmarks (the physiological phase; each interval runs in its own real duration, `phaseDurations`). */
export const PHASES = {
  isovolumicContraction: 0.05,
  endSystole: SYSTOLE_FRACTION,
  mitralOpening: 0.42,
  endRapidFilling: 0.6,
  atrialOnset: 0.84,
  /** The atria are fully contracted from here to mitral closure (φ = 1). */
  atrialPeak: 0.985,
} as const;

/** Ventricular level at the end of isovolumic contraction / relaxation (the volume holds; the shape settles). */
const ISOVOLUMIC_LEVEL = 0.04;
const RELAXED_LEVEL = 0.97;
/** Share of the stroke refilled during a resting diastasis (slow filling); a shorter one refills less. */
export const DIASTASIS_SHARE = 0.06;
/** Diastasis long enough for its full share (s); slow filling is a steady trickle, so its share scales with time. */
const FULL_DIASTASIS_S = 0.15;
/** Default share of the stroke the atrial kick refills (a ~50-year-old; it grows with age, `beatProfileFrom`). */
export const ATRIAL_SHARE = 0.27;
/** Where the atria let go after their kick, early in ventricular systole. */
const ATRIAL_RELEASE = 0.12;
/** End of the twist's recoil (early rapid filling). */
const UNTWIST_END = 0.55;

export const clampHeartRate = (bpm: unknown): number => {
  const n = typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : 72;
  return Math.min(BEAT_MAX_BPM, Math.max(BEAT_MIN_BPM, n));
};

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
/** Wrap any real phase into [0, 1). */
export const wrap01 = (phase: number): number => phase - Math.floor(phase);
/** C¹ smooth ramp with zero slope at both ends (rate peaks half-way). */
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/**
 * C¹ ramp whose rate peaks a third of the way in and falls to zero at both ends (rate 12·t·(1 − t)²): ejection and
 * the E wave are fast early and slow late.
 */
const early = (t: number) => {
  const x = clamp01(t);
  const u = 1 - x;
  return 1 - u * u * u * (1 + 3 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (x: number, a: number, b: number) => (x - a) / (b - a);

/**
 * Ventricular volume curve at phase φ (see the table above): 0 = end-diastole, 1 = end-systole. `atrialShare` is
 * the share of the stroke the atrial kick refills (E/A balance), `diastasisShare` the slow filling's
 * (`diastasisShareFor`). Continuous and C¹ over the wrap.
 */
export function ventricular(phase: number, atrialShare = ATRIAL_SHARE, diastasisShare = DIASTASIS_SHARE): number {
  const x = wrap01(phase);
  const P = PHASES;
  const sA = clamp(atrialShare, 0, 0.6);
  const endRapid = sA + clamp(diastasisShare, 0, 0.2);
  if (x < P.isovolumicContraction) return ISOVOLUMIC_LEVEL * smooth(span(x, 0, P.isovolumicContraction));
  if (x < P.endSystole) return lerp(ISOVOLUMIC_LEVEL, 1, early(span(x, P.isovolumicContraction, P.endSystole)));
  if (x < P.mitralOpening) return lerp(1, RELAXED_LEVEL, smooth(span(x, P.endSystole, P.mitralOpening)));
  if (x < P.endRapidFilling) return lerp(RELAXED_LEVEL, endRapid, early(span(x, P.mitralOpening, P.endRapidFilling)));
  if (x < P.atrialOnset) return lerp(endRapid, sA, smooth(span(x, P.endRapidFilling, P.atrialOnset)));
  // Atrial kick: the last of the filling, reaching end-diastole exactly at mitral closure (φ = 1 ≡ 0).
  return sA * (1 - smooth(span(x, P.atrialOnset, 1)));
}

/**
 * Atrial contraction at phase φ: 0 at rest, 1 fully contracted. It builds through the A wave, holds to mitral
 * closure and lets go early in ventricular systole (the atria are smallest at the onset of systole). Continuous
 * and C¹ over the wrap.
 */
export function atrial(phase: number): number {
  const x = wrap01(phase);
  const P = PHASES;
  if (x < ATRIAL_RELEASE) return 1 - smooth(x / ATRIAL_RELEASE);
  if (x < P.atrialOnset) return 0;
  if (x < P.atrialPeak) return smooth(span(x, P.atrialOnset, P.atrialPeak));
  return 1;
}

/**
 * LV twist at phase φ: 0 untwisted, 1 at end-systole. It follows ejection, then recoils fast — ~40 % within
 * isovolumic relaxation, done early in rapid filling. Continuous and C¹ over the wrap.
 */
export function twist(phase: number): number {
  const x = wrap01(phase);
  if (x < PHASES.endSystole) return ventricular(x);
  if (x < UNTWIST_END) return 1 - early(span(x, PHASES.endSystole, UNTWIST_END));
  return 0;
}

/**
 * Deformation amplitudes at full activation (end-systole, or the peak of the atrial kick), as fractions of the
 * apex-to-base length L or of the local radius. They follow adult cine-MRI / speckle-tracking norms, scaled to
 * this heart (L ≈ 72 mm), and drive the one displacement field of `beatDeform.ts`:
 *   - the AV plane descends toward a nearly still apex: mitral annular plane systolic excursion (MAPSE)
 *     12–15 mm in a heart ~90 mm long, i.e. 13 % of L here; the ventricles shorten evenly from apex to base;
 *   - the epicardium moves in by about 6 % of its radius; inside the LV wall the cavity loses another 45 % of its
 *     cross-section while the shortening, nearly incompressible wall gains area: the endocardium moves in 5–8 mm,
 *     the wall thickens ~40 % (a heart without its LV frame keeps the 6 % only);
 *   - LV twist: the apex rotates about 9° counter-clockwise and the base about 4° clockwise, viewed from the
 *     apex (net twist 10–15°);
 *   - the atria fill and swell while the ventricles eject (reservoir phase), then squeeze in the atrial kick
 *     (with the AV plane's stretch, the left atrium empties ~45 % of its largest volume, normal 50–65 %).
 */
export const BEAT_AMPLITUDE = {
  /** AV-plane descent toward the apex at end-systole, fraction of the apex-to-base length. */
  longitudinal: 0.13,
  /** Inward motion of the ventricular epicardium toward the long axis at end-systole, fraction of the radius. */
  radial: 0.06,
  /** Further fraction of the LV cavity's cross-section lost inside its wall at end-systole (the wall thickens). */
  lvArea: 0.45,
  /** Rotation of the apex at end-systole, degrees, counter-clockwise viewed from the apex. */
  twistApexDeg: 9,
  /** Rotation of the base at end-systole, degrees, clockwise viewed from the apex. */
  twistBaseDeg: 4,
  /** Atrial squeeze toward the atrial centre at the peak of the kick, fraction of the distance. */
  atrial: 0.07,
  /** Atrial swell away from the atrial centre at end-systole (reservoir filling), fraction of the distance. */
  atrialReservoir: 0.035,
} as const;

/** Legacy uniform scale (procedural heart, fx phase lock): 1 → SYSTOLE_SCALE at end-systole, never > 1. */
export function beatScale(phase: number): number {
  return 1 - (1 - SYSTOLE_SCALE) * Math.max(0, ventricular(phase));
}

/** True during diastole (flow particles run faster then). */
export const inDiastole = (phase: number): boolean => wrap01(phase) >= SYSTOLE_FRACTION;

// --------------------------------------------------------------------------------------- the patient

/** What shapes one patient's beat, from their clinical inputs (`beatProfileFrom`). */
export interface BeatProfile {
  /** Heart rate, bpm (40–140). */
  bpm: number;
  /** Age, years: relaxation slows with age (longer IVRT, a larger atrial share of the filling). */
  age: number;
  /** Hypertension: impaired relaxation (longer IVRT, a larger atrial share). */
  hypertension: boolean;
  female: boolean;
  /** Share of the stroke the atrial kick refills (E/A balance), 0.15–0.42. */
  atrialShare: number;
  /** Contraction amplitude relative to a normal heart: ejection fraction / 58 %, 0.35–1.05. */
  contractility: number;
}

/** Ejection fraction the default deformation stands for (a normal LV, EF 55–65 %). */
export const NORMAL_EF = 58;

export const DEFAULT_PROFILE: BeatProfile = {
  bpm: 72,
  age: 50,
  hypertension: false,
  female: false,
  atrialShare: ATRIAL_SHARE,
  contractility: 1,
};

const numberOr = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/**
 * The beat of one patient, from the cohort's clinical inputs (`PR` pulse rate, `Age`, `HTN`, `Sex`, `EF-TTE`).
 * The atrial share follows the E/A ratio's well-documented fall with age (E/A ≈ 1.5 at 30 y, ≈ 1 by 60 y) and with
 * hypertension; the contraction amplitude follows the echo ejection fraction. Missing inputs fall back to a
 * healthy 50-year-old at 72 bpm.
 */
export function beatProfileFrom(features: Readonly<Record<string, unknown>> | null | undefined): BeatProfile {
  const f = features ?? {};
  const age = clamp(numberOr(f.Age, DEFAULT_PROFILE.age), 18, 95);
  const hypertension = numberOr(f.HTN, 0) >= 0.5;
  const female = typeof f.Sex === 'string' && /^f/i.test(f.Sex);
  const ef = numberOr(f['EF-TTE'], NORMAL_EF);
  return {
    bpm: clampHeartRate(f.PR),
    age,
    hypertension,
    female,
    atrialShare: clamp(0.13 + 0.0035 * (age - 20) + (hypertension ? 0.04 : 0), 0.15, 0.42),
    contractility: clamp(ef / NORMAL_EF, 0.35, 1.05),
  };
}

/**
 * Slow-filling share of a beat whose diastasis lasts `seconds`: a steady trickle, so a short diastasis refills
 * little — at a fast rate the E wave runs almost straight into the A wave instead of jumping the diastasis.
 */
export function diastasisShareFor(seconds: number): number {
  return DIASTASIS_SHARE * clamp01(seconds / FULL_DIASTASIS_S);
}

/** Intervals of `PHASES`, in order: [start, end) of each. */
export const PHASE_INTERVALS: readonly (readonly [number, number])[] = [
  [0, PHASES.isovolumicContraction],
  [PHASES.isovolumicContraction, PHASES.endSystole],
  [PHASES.endSystole, PHASES.mitralOpening],
  [PHASES.mitralOpening, PHASES.endRapidFilling],
  [PHASES.endRapidFilling, PHASES.atrialOnset],
  [PHASES.atrialOnset, 1],
];

/** Rapid filling and atrial systole at rest (s), before a short diastole compresses them. */
const RAPID_FILLING_S = 0.17;
const ATRIAL_SYSTOLE_S = 0.12;
/** Diastasis kept while the E and A waves are compressed (s): it vanishes last. */
const MIN_DIASTASIS_S = 0.012;

/**
 * Real duration (s) of each interval of `PHASE_INTERVALS` at the profile's rate; they sum to one RR interval.
 * Systole follows the systolic time intervals' rate regressions (Weissler 1968: LVET = 413 − 1.7·HR ms in men,
 * 418 − 1.6·HR in women; IVCT ≈ PEP − the electromechanical delay ≈ 76 − 0.4·HR ms); IVRT lengthens with age and
 * hypertension and shortens a little with rate; diastasis takes what is left, and once it is gone the E and A waves
 * shorten together (they fuse above ~110 bpm).
 */
export function phaseDurations(profile: Pick<BeatProfile, 'bpm' | 'age' | 'hypertension' | 'female'>): number[] {
  const bpm = clampHeartRate(profile.bpm);
  const rr = 60 / bpm;
  const ivct = clamp((76 - 0.4 * bpm) / 1000, 0.02, 0.065);
  const lvet = clamp(((profile.female ? 418 : 413) - (profile.female ? 1.6 : 1.7) * bpm) / 1000, 0.15, 0.36);
  const ivrt = clamp(0.072 + 0.0006 * Math.max(0, profile.age - 40) + (profile.hypertension ? 0.01 : 0) - 0.0003 * (bpm - 70), 0.05, 0.12);
  const available = Math.max(0, rr - ivct - lvet - ivrt);
  let e = RAPID_FILLING_S;
  let a = ATRIAL_SYSTOLE_S;
  const keep = Math.min(MIN_DIASTASIS_S, 0.05 * available);
  if (e + a > available - keep) {
    const k = Math.max(0, available - keep) / (e + a);
    e *= k;
    a *= k;
  }
  const diastasis = Math.max(0, available - e - a);
  return [ivct, lvet, ivrt, e, diastasis, a];
}

export interface BeatState {
  /** Ventricular activation (see `ventricular`), scaled by the contraction amplitude. */
  v: number;
  /** Atrial activation (see `atrial`). */
  a: number;
  /** LV twist (see `twist`), scaled by the contraction amplitude. */
  t: number;
}

/** All activations at once for one patient, optionally scaled by an on/off envelope (0 = resting shape). */
export function beatState(phase: number, envelope = 1, profile: Pick<BeatProfile, 'atrialShare' | 'contractility'> = DEFAULT_PROFILE): BeatState {
  const k = clamp01(envelope);
  const c = profile.contractility;
  return { v: ventricular(phase, profile.atrialShare) * c * k, a: atrial(phase) * k, t: twist(phase) * c * k };
}
