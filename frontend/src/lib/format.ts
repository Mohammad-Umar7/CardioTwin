/**
 * Number and value formatting (DESIGN_SYSTEM.md §3 "Numeric treatment").
 *   probabilities → "72 %" (integer + thin space), "<1 %", ">99 %"; exact p only in tooltips
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

export interface FormattedProbability {
  /** "<", ">" or "" */
  qualifier: '' | '<' | '>';
  /** Integer percent as a string, e.g. "72". */
  value: string;
  /** Full text with thin space: "72 %", "<1 %". */
  text: string;
  /** Screen-reader text: "72 percent", "less than 1 percent". */
  spoken: string;
  /** Exact probability for tooltips: "p = 0.719". */
  exact: string;
}

export function formatProbability(p: number | null | undefined): FormattedProbability {
  if (!isFiniteNumber(p)) {
    return { qualifier: '', value: '–', text: '–', spoken: 'unavailable', exact: 'p unavailable' };
  }
  const exact = `p = ${p.toFixed(3)}`;
  if (p < 0.01) return { qualifier: '<', value: '1', text: `<1${THIN_SPACE}%`, spoken: 'less than 1 percent', exact };
  if (p > 0.99)
    return { qualifier: '>', value: '99', text: `>99${THIN_SPACE}%`, spoken: 'more than 99 percent', exact };
  const value = String(Math.round(p * 100));
  return { qualifier: '', value, text: `${value}${THIN_SPACE}%`, spoken: `${value} percent`, exact };
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
  return unit ? `${formatNumber(n, spec.step)}${THIN_SPACE}${unit}` : formatNumber(n, spec.step);
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
