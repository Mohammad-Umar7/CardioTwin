/**
 * Number and value formatting (DESIGN_SYSTEM.md §3 "Numeric treatment").
 *   probabilities → "72 %" (integer + thin space), capped at "≤5 %" / "≥95 %"; exact p only in tooltips
 *                   and Explain › Model
 *   metrics       → "0.94" + "[0.88–0.98]"
 *   deltas        → "▲ +12 pts" / "▼ −4 pts"
 *   SHAP          → "+0.94" / "−0.18" (true minus U+2212)
 *   units         → value, thin space, unit
 * Dataset quirks never reach the screen: 0/1 → "No"/"Yes", 'Fmale' → "Female", 'N' → "None".
 */
import type { FeatureSpec, FeatureValue, NormalRange } from '@/types/contracts';

export const THIN_SPACE = ' ';
export const MINUS = '−';
export const EN_DASH = '–';

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------------------ probabilities

/**
 * Display bounds for probabilities. The held-out calibration slope is below 1 (0.62 for CAD, 0.47 for LAD):
 * the model's extreme estimates are more extreme than the observed rates, so the UI never claims more
 * certainty than "≥95 %" or "≤5 %". Every value that would round to 95 or more (5 or less) shows the bound;
 * the exact p stays in the tooltip (`exact`) and in Explain › Model.
 */
export const PROBABILITY_DISPLAY_MIN = 5;
export const PROBABILITY_DISPLAY_MAX = 95;

export interface FormattedProbability {
  /** "≤", "≥" or "" */
  qualifier: '' | '≤' | '≥';
  /** Integer percent as a string, e.g. "72". */
  value: string;
  /** Full text with thin space: "72 %", "≥95 %". */
  text: string;
  /** Screen-reader text: "72 percent", "95 percent or more". */
  spoken: string;
  /** Exact probability for tooltips: "p = 0.719". */
  exact: string;
  /** The display is a bound, not the rounded value. */
  capped: boolean;
}

export function formatProbability(p: number | null | undefined): FormattedProbability {
  if (!isFiniteNumber(p)) {
    return { qualifier: '', value: '–', text: '–', spoken: 'unavailable', exact: 'p unavailable', capped: false };
  }
  const exact = `p = ${p.toFixed(3)}`;
  const rounded = Math.round(p * 100);
  if (rounded <= PROBABILITY_DISPLAY_MIN) {
    const value = String(PROBABILITY_DISPLAY_MIN);
    return { qualifier: '≤', value, text: `≤${value}${THIN_SPACE}%`, spoken: `${value} percent or less`, exact, capped: true };
  }
  if (rounded >= PROBABILITY_DISPLAY_MAX) {
    const value = String(PROBABILITY_DISPLAY_MAX);
    return { qualifier: '≥', value, text: `≥${value}${THIN_SPACE}%`, spoken: `${value} percent or more`, exact, capped: true };
  }
  const value = String(rounded);
  return { qualifier: '', value, text: `${value}${THIN_SPACE}%`, spoken: `${value} percent`, exact, capped: false };
}

/** Plain percentage for thresholds and prevalences: 0.46 → "46 %". */
export function formatPercent(x: number | null | undefined, digits = 0): string {
  if (!isFiniteNumber(x)) return '–';
  return `${(x * 100).toFixed(digits)}${THIN_SPACE}%`;
}

// ------------------------------------------------------------------------------------- deltas

export interface FormattedDelta {
  direction: 'up' | 'down' | 'none';
  glyph: '▲' | '▼' | '';
  /** "+12 pts", "−4 pts", "0 pts" */
  text: string;
  spoken: string;
}

/** Delta between two probabilities, in percentage points. */
export function formatDeltaPts(delta: number): FormattedDelta {
  const pts = Math.round(delta * 100);
  if (!Number.isFinite(pts) || pts === 0) {
    return { direction: 'none', glyph: '', text: `0${THIN_SPACE}pts`, spoken: 'no change' };
  }
  const up = pts > 0;
  const abs = Math.abs(pts);
  return {
    direction: up ? 'up' : 'down',
    glyph: up ? '▲' : '▼',
    text: `${up ? '+' : MINUS}${abs}${THIN_SPACE}pts`,
    spoken: `${up ? 'up' : 'down'} ${abs} ${abs === 1 ? 'point' : 'points'}`,
  };
}

/**
 * The change between two probabilities as they are displayed: the difference of the two printed integers,
 * so "was 67 %" and "79 %" never sit beside "+11 pts". When either end is capped (≤5 % / ≥95 %) the exact
 * value stays hidden and the change reads as a bound: "was ≥95 %" → 62 % is "▼ ≥33 pts", not the exact
 * "−36 pts" that would give the capped value away.
 */
export function formatShownDeltaPts(from: number, to: number): FormattedDelta {
  const shown = (p: number) => {
    const f = formatProbability(p);
    return { v: Number(f.value), capped: f.capped };
  };
  const a = shown(from);
  const b = shown(to);
  const pts = b.v - a.v;
  if (!Number.isFinite(pts) || pts === 0) {
    return { direction: 'none', glyph: '', text: `0${THIN_SPACE}pts`, spoken: 'no change' };
  }
  const up = pts > 0;
  const abs = Math.abs(pts);
  // A capped end moves the true value further out, so the displayed difference is a lower bound.
  const bound = a.capped || b.capped;
  return {
    direction: up ? 'up' : 'down',
    glyph: up ? '▲' : '▼',
    text: bound ? `≥${abs}${THIN_SPACE}pts` : `${up ? '+' : MINUS}${abs}${THIN_SPACE}pts`,
    spoken: `${up ? 'up' : 'down'} ${bound ? 'at least ' : ''}${abs} ${abs === 1 ? 'point' : 'points'}`,
  };
}

// --------------------------------------------------------------------------------------- SHAP

/** Signed log-odds with the true minus: "+0.94", "−0.18", "0.00". */
export function formatShap(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v).toFixed(digits);
  if (Number(abs) === 0) return (0).toFixed(digits);
  return `${v > 0 ? '+' : MINUS}${abs}`;
}

/** Signed number with the true minus, for log-odds axes ("base −0.21"). */
export function formatSigned(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? `${MINUS}${s}` : s;
}

// ------------------------------------------------------------------------------------ metrics

export function formatMetricValue(v: number | null | undefined, digits = 2): string {
  return isFiniteNumber(v) ? v.toFixed(digits) : '–';
}

/**
 * The difference between two metrics as they are printed (each rounded first), so "0.92 → 0.94" never sits
 * beside "+0.03": every delta a reader sees equals the difference of the two values it sits between.
 */
export function printedDifference(from: number, to: number, digits = 2): number {
  const k = 10 ** digits;
  return (Math.round(to * k) - Math.round(from * k)) / k;
}

/** "[0.88–0.98]" */
export function formatCi(ci: readonly [number, number] | null | undefined, digits = 2): string {
  if (!ci || !isFiniteNumber(ci[0]) || !isFiniteNumber(ci[1])) return '';
  return `[${ci[0].toFixed(digits)}${EN_DASH}${ci[1].toFixed(digits)}]`;
}

// ---------------------------------------------------------------------------- feature values

/** Decimal places implied by a slider step (1 → 0, 0.1 → 1, 0.05 → 2). */
export function decimalsForStep(step: number | null | undefined): number {
  if (!isFiniteNumber(step) || step <= 0 || step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function formatNumber(v: number, step?: number | null): string {
  const d = decimalsForStep(step);
  const fixed = v.toFixed(d);
  return v < 0 ? fixed.replace('-', MINUS) : fixed;
}

/** Friendly unit text (dataset uses plain ASCII units). */
export function formatUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  const map: Record<string, string> = {
    years: 'y',
    percent: '%',
    '%': '%',
    'mg/dl': 'mg/dL',
    'mg/dL': 'mg/dL',
    bpm: 'bpm',
    mmHg: 'mmHg',
    mmhg: 'mmHg',
    'kg/m2': 'kg/m²',
    'kg/m^2': 'kg/m²',
    'mEq/lit': 'mEq/L',
    'mEq/L': 'mEq/L',
    'mm/h': 'mm/h',
  };
  return map[unit] ?? unit;
}

/** Categorical option: short on-screen code + full term for the tooltip. */
export function optionDisplay(spec: FeatureSpec, value: FeatureValue | null | undefined): { short: string; full: string } {
  if (value === null || value === undefined || value === '') return { short: '–', full: 'Not recorded' };
  const raw = String(value);
  const normalised = raw.toLowerCase() === 'fmale' ? 'Female' : raw;
  const option = spec.options?.find((o) => String(o.value).toLowerCase() === normalised.toLowerCase());
  const full = option?.label ?? normalised;
  let short = normalised;
  if (normalised === 'N') short = 'None';
  else if (/^[a-z]/.test(normalised)) short = normalised.charAt(0).toUpperCase() + normalised.slice(1);
  return { short, full };
}

/** On-screen value of a feature, e.g. "62 y", "Yes", "Female", "LBBB", "140 mmHg". */
export function formatFeatureValue(spec: FeatureSpec, value: FeatureValue | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return '–';
  if (spec.type === 'binary') {
    const on = value === 1 || value === true || value === '1' || String(value).toUpperCase() === 'Y';
    return on ? 'Yes' : 'No';
  }
  if (spec.type === 'categorical') return optionDisplay(spec, value as FeatureValue).short;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const unit = formatUnit(spec.unit);
  const text = groupThousands(formatNumber(n, spec.step));
  return unit ? `${text}${THIN_SPACE}${unit}` : text;
}

/** "5800" → "5,800" for display (as the other pages print counts); never used for editable field values. */
function groupThousands(text: string): string {
  const [int = '', frac] = text.split('.');
  const sign = int.startsWith(MINUS) ? MINUS : '';
  const digits = sign ? int.slice(1) : int;
  if (digits.length < 4) return text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

// ---------------------------------------------------------------------------- normal ranges

export type RangeStatus = 'below' | 'within' | 'above';

export function rangeStatus(value: FeatureValue | null | undefined, normal: NormalRange | null | undefined): RangeStatus | null {
  if (!normal || typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (normal.low === null && normal.high === null) return null;
  if (normal.low !== null && value < normal.low) return 'below';
  if (normal.high !== null && value > normal.high) return 'above';
  return 'within';
}

/** "ref 90–120", "ref ≥ 50", "ref ≤ 100"; empty when no range applies. */
export function formatNormalRange(normal: NormalRange | null | undefined, step?: number | null): string {
  if (!normal) return '';
  const { low, high } = normal;
  // A single allowed value (wall-motion regions: 0) reads "ref 0", never "0–0".
  if (low !== null && low === high) return `ref ${formatNumber(low, step)}`;
  if (low !== null && high !== null) return `ref ${formatNumber(low, step)}${EN_DASH}${formatNumber(high, step)}`;
  if (low !== null) return `ref ≥${THIN_SPACE}${formatNumber(low, step)}`;
  if (high !== null) return `ref ≤${THIN_SPACE}${formatNumber(high, step)}`;
  return '';
}

/** Spoken range for aria-valuetext: "normal range 50 to 70". */
export function spokenNormalRange(normal: NormalRange | null | undefined): string {
  if (!normal) return '';
  const { low, high } = normal;
  if (low !== null && high !== null) return `normal range ${low} to ${high}`;
  if (low !== null) return `normal at least ${low}`;
  if (high !== null) return `normal at most ${high}`;
  return '';
}
