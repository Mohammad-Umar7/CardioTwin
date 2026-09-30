/**
 * Pure cardiac-cycle maths for the flow layer (no three.js, no React — unit tested in cardiac.test.ts).
 *
 * Phase convention (shared with `anatomy/heartbeat.ts`): φ ∈ [0, 1) over one RR interval, φ = 0 at the
 * onset of systole; systole occupies [0, SYSTOLE_FRACTION), diastole the rest.
 *
 * Coronary flow is predominantly DIASTOLIC: the contracting myocardium squeezes its own intramural
 * vessels, so left-coronary inflow nearly stalls in systole and surges early in diastole once the wall
 * relaxes and the aortic valve has closed. The profile below is a smooth, illustrative waveform with that
 * shape (ramp-down in early systole, near-stall, early-diastolic peak, decay to an end-diastolic plateau).
 * It is normalised so its mean over the cycle is exactly 1: multiplying by a mean speed gives the
 * instantaneous speed, and the time-integral over a beat is independent of the waveform.
 * Illustrative only — NOT a haemodynamic simulation.
 */
import { SYSTOLE_FRACTION } from '../anatomy/heartbeat';

/** Raw waveform levels before normalisation: near-stall, end-diastolic plateau, early-diastolic peak. */
const STALL = 0.18;
const PLATEAU = 0.8;
const PEAK = 2.4;
/** Time-to-peak as a fraction of diastole. */
const TAU = 0.2;
/** Fraction of systole over which flow falls from the plateau to the stall level. */
const SYSTOLIC_FALL = 0.18;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Wrap any real phase into [0, 1). */
export const wrapPhase = (phase: number): number => phase - Math.floor(phase);

/** Un-normalised waveform at phase φ. Continuous and C¹ at both the systolic and diastolic onsets. */
function rawFlow(phase: number): number {
  const x = wrapPhase(phase);
  if (x < SYSTOLE_FRACTION) {
    const s = x / SYSTOLE_FRACTION;
    return STALL + (PLATEAU - STALL) * (1 - smoothstep(0, SYSTOLIC_FALL, s));
  }
  const d = (x - SYSTOLE_FRACTION) / (1 - SYSTOLE_FRACTION);
  const u = d / TAU;
  // 0 at d = 0, 1 at d = TAU, decaying through diastole and faded to exactly 0 at end-diastole.
  const surge = u * u * Math.exp(2 * (1 - u)) * (1 - smoothstep(0.7, 1, d));
  return STALL + (PLATEAU - STALL) * smoothstep(0, TAU, d) + (PEAK - PLATEAU) * surge;
}

/** Samples of the cumulative integral; linear interpolation between them is accurate to < 1e-5. */
export const FLOW_TABLE_SIZE = 2048;

const { table: CUMULATIVE, mean: RAW_MEAN } = (() => {
  // Trapezoidal integration on a fine grid, then normalise so the integral over one cycle is 1.
  const n = FLOW_TABLE_SIZE;
  const sub = 8;
  const table = new Float64Array(n + 1);
  let acc = 0;
  let prev = rawFlow(0);
  for (let i = 1; i <= n * sub; i += 1) {
    const cur = rawFlow(i / (n * sub));
    acc += ((prev + cur) / 2) * (1 / (n * sub));
    prev = cur;
    if (i % sub === 0) table[i / sub] = acc;
  }
  for (let i = 0; i <= n; i += 1) table[i]! /= acc;
  return { table, mean: acc };
})();

/**
 * Instantaneous coronary flow speed at phase φ, relative to the cycle mean (mean = 1).
 * `phasicity` blends toward steady flow: 1 = full diastolic-dominant waveform (left coronary tree),
 * ≈ 0.6 = the flatter right-coronary pattern (the thin right ventricle compresses the RCA far less),
 * 0 = constant speed. The mean stays 1 for any phasicity.
 */
export function coronaryFlowSpeed(phase: number, phasicity = 1): number {
  return 1 + phasicity * (rawFlow(phase) / RAW_MEAN - 1);
}

/** ∫₀^φ coronaryFlowSpeed(x, 1) dx for φ ∈ [0, 1] (so flowIntegral(1) = 1). */
export function flowIntegral(phase: number): number {
  const x = clamp01(phase) * FLOW_TABLE_SIZE;
  const i = Math.min(FLOW_TABLE_SIZE - 1, Math.floor(x));
  const f = x - i;
  return CUMULATIVE[i]! + (CUMULATIVE[i + 1]! - CUMULATIVE[i]!) * f;
}

/**
 * Flow "distance" in beat-normalised units between two points of the cumulative beat counter
 * (beats = whole cycles elapsed + phase): ∫ speed dφ. Exact for any frame rate, because it differences
 * the analytic cumulative integral instead of summing per-frame samples. With phasicity k:
 * Δ = Δbeats + k·(ΔF − Δbeats).
 */
export function flowAdvance(beatsFrom: number, beatsTo: number, phasicity = 1): number {
  const cumulative = (b: number) => Math.floor(b) + flowIntegral(wrapPhase(b));
  const plain = beatsTo - beatsFrom;
  return plain + phasicity * (cumulative(beatsTo) - cumulative(beatsFrom) - plain);
}

/** Share of the cycle's flow delivered during diastole (for documentation and tests). */
export function diastolicFlowShare(): number {
  return 1 - flowIntegral(SYSTOLE_FRACTION);
}

/**
 * The per-beat pulse wavefront (§ fx README): launched at the start of diastole with the inflow surge
 * and carried from the ostia (arc length 0) to beyond the distal tips (arc length 1 + tail) within
 * PULSE_TRAVEL of the cycle, decelerating as it goes. Returns the front position in normalised arc
 * length, or null while no wave is in flight.
 */
export const PULSE_TRAVEL = 0.42;
export const PULSE_OVERSHOOT = 1.25;
export function pulseFront(phase: number): number | null {
  const x = wrapPhase(phase);
  const since = x - SYSTOLE_FRACTION;
  if (since < 0 || since > PULSE_TRAVEL + 1e-9) return null;
  const t = Math.min(1, since / PULSE_TRAVEL);
  return PULSE_OVERSHOOT * (1 - (1 - t) * (1 - t)); // ease-out: fast from the ostium, slower distally
}
