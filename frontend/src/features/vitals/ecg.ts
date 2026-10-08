/**
 * A schematic lead-II ECG on the scene's PHYSIOLOGICAL cardiac phase (`three/anatomy/heartbeat.ts`: φ = 0 at
 * mitral closure, the onset of ventricular systole). Decoration for the live monitor strip, never data: it shows
 * the twin's rhythm at the patient's recorded rate, not this patient's ECG.
 *
 * Each wave is a Gaussian on the circular phase, timed against the mechanical beat at ~70 bpm:
 *   P   atrial depolarisation, ~120 ms before the R peak (the atrial kick follows it, φ 0.84 → 1)
 *   QRS ventricular depolarisation just before mitral closure (electromechanical delay ≈ 20–40 ms)
 *   T   repolarisation, peaking mid-ejection and ending with it (φ ≈ 0.35)
 */
interface Wave {
  centre: number;
  sigma: number;
  amp: number;
}

export const ECG_WAVES: readonly Wave[] = [
  { centre: 0.813, sigma: 0.03, amp: 0.13 }, // P
  { centre: 0.957, sigma: 0.0065, amp: -0.11 }, // Q
  { centre: 0.973, sigma: 0.0072, amp: 1 }, // R
  { centre: 0.99, sigma: 0.0075, amp: -0.24 }, // S
  { centre: 0.29, sigma: 0.045, amp: 0.27 }, // T
];

/** Signed shortest distance between two phases on the unit circle, in (−0.5, 0.5]. */
function circular(a: number, b: number): number {
  const d = a - b;
  return d - Math.round(d);
}

/** ECG amplitude at phase φ (any real; wrapped), ≈ −0.25 … 1 (R peak = 1). */
export function ecgAt(phase: number): number {
  let y = 0;
  for (const w of ECG_WAVES) {
    const d = circular(phase, w.centre);
    y += w.amp * Math.exp(-(d * d) / (2 * w.sigma * w.sigma));
  }
  return y;
}

/** Display rate: the recorded pulse rate rounded, or null when the input is missing or implausible. */
export function displayRate(pr: unknown): number | null {
  return typeof pr === 'number' && Number.isFinite(pr) && pr >= 20 && pr <= 250 ? Math.round(pr) : null;
}
