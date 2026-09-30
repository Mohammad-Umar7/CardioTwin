/**
 * Axis maths for the neutral evaluation charts (WORKSTATION_V2 §6.4 rule 5): round ticks only
 * (never 0.71 / 0.42 / −0.17), 4–5 per axis, labels formatted without false precision, and a
 * width estimate so axis titles can clear the tick labels by ≥ 8 px.
 */
import { MINUS } from '@/lib/format';

export interface NiceAxis {
  domain: [number, number];
  ticks: number[];
  step: number;
}

const MULTIPLIERS = [1, 2, 2.5, 5] as const;

/** Floating-point-safe rounding to the step's decimal grid. */
function snap(v: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number(v.toFixed(decimals));
}

/**
 * Round ticks covering `[lo, hi]`. Steps come from 1 · 2 · 2.5 · 5 × 10ᵏ; the chosen step gives
 * 4–5 ticks when possible (then 6, then 3), preferring the one whose niced domain wastes least.
 * `clamp` keeps the niced domain inside natural bounds (e.g. probabilities stay in [0, 1]).
 */
export function niceAxis(lo: number, hi: number, clamp?: [number, number]): NiceAxis {
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    return { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], step: 0.25 };
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  const base = 10 ** Math.floor(Math.log10(span));
  let best: { axis: NiceAxis; score: number } | null = null;
  for (const scale of [base / 10, base, base * 10]) {
    for (const mult of MULTIPLIERS) {
      const step = mult * scale;
      let d0 = snap(Math.floor(lo / step + 1e-9) * step, step);
      let d1 = snap(Math.ceil(hi / step - 1e-9) * step, step);
      if (clamp) {
        // Clamp the domain, keep ticks on the step grid (a clamped edge need not be a tick).
        d0 = Math.max(clamp[0], d0);
        d1 = Math.min(clamp[1], d1);
      }
      const first = Math.ceil(d0 / step - 1e-9);
      const last = Math.floor(d1 / step + 1e-9);
      const count = last - first + 1;
      if (count < 3 || count > 6) continue;
      const preference = count === 5 ? 0 : count === 4 ? 0.05 : count === 6 ? 0.4 : 0.6;
      const waste = (d1 - d0 - span) / (d1 - d0);
      const score = preference + waste;
      if (!best || score < best.score - 1e-9) {
        const ticks = Array.from({ length: count }, (_, i) => snap((first + i) * step, step));
        best = { axis: { domain: [d0, d1], ticks, step }, score };
      }
    }
  }
  return best?.axis ?? { domain: [lo, hi], ticks: [lo, hi], step: span };
}

/** Decimal places a tick step needs (0.25 → 2, 0.2 → 1, 5 → 0). */
export function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  for (let d = 0; d <= 6; d += 1) {
    if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  }
  return 6;
}

/** Tick label: trailing zeros dropped ("0.5", "1", "0"), true minus for negatives. */
export function formatTick(v: number, step: number): string {
  const d = stepDecimals(step);
  const s = Number(v.toFixed(d)).toString();
  if (s === '-0') return '0';
  return s.startsWith('-') ? `${MINUS}${s.slice(1)}` : s;
}

/** Approximate rendered width of a 12 px Inter label (tabular digits ≈ 7 px). */
export function labelWidth(text: string, px = 12): number {
  let w = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) w += 0.58;
    else if (ch === '.' || ch === ',' || ch === ' ' || ch === ' ') w += 0.28;
    else if (ch === MINUS || ch === '-' || ch === '+') w += 0.6;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else w += 0.52;
  }
  return w * px;
}
