/**
 * Value semantics shared by the patient card, the Inputs drawer and the palette commands
 * (WORKSTATION_V2 §5.5, §5.6). Pure functions over the feature schema; no React, no stores.
 */
import { formatFeatureValue, formatNumber, formatUnit, rangeStatus, THIN_SPACE } from '@/lib/format';
import type { FeatureSpec, FeatureValue, FeatureVector } from '@/types/contracts';

/** Binary "present": 1 / "1" / true / "Y" / "yes". */
export function isPresent(value: FeatureValue | boolean | null | undefined): boolean {
  if (value === 1 || value === true) return true;
  if (typeof value === 'string') return ['1', 'y', 'yes', 'true'].includes(value.trim().toLowerCase());
  return false;
}

/** Equality with a numeric tolerance (values round-trip through inputs and JSON). */
export function sameValue(a: FeatureValue | undefined, b: FeatureValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a === undefined || b === undefined) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Why an input is "outside normal" (V2 §5.6 section 2):
 *   above / below — a numeric value outside `schema.normal`;
 *   present       — a binary finding recorded as Yes;
 *   finding       — a categorical value other than its normal option ("N": no BBB, no VHD).
 * Null when the value is unremarkable (or the feature has no notion of normal, e.g. Age, Sex).
 */
export type Abnormality = 'above' | 'below' | 'present' | 'finding';

export function abnormality(spec: FeatureSpec, value: FeatureValue | undefined): Abnormality | null {
  if (value === undefined || value === null || value === '') return null;
  if (spec.type === 'binary') return isPresent(value) ? 'present' : null;
  if (spec.type === 'categorical') {
    const normal = spec.options?.find((o) => String(o.value).toUpperCase() === 'N');
    if (!normal) return null;
    return String(value).toUpperCase() === 'N' ? null : 'finding';
  }
  const n = typeof value === 'number' ? value : Number(value);
  const status = rangeStatus(Number.isFinite(n) ? n : undefined, spec.normal);
  return status === 'above' || status === 'below' ? status : null;
}

/** ▲ / ▼ for numerics outside the reference range, '' otherwise (never red: text/secondary). */
export function rangeGlyph(spec: FeatureSpec, value: FeatureValue | undefined): '▲' | '▼' | '' {
  const a = abnormality(spec, value);
  return a === 'above' ? '▲' : a === 'below' ? '▼' : '';
}

/** Numeric value of a feature (NaN when missing or not a number). */
export function numericValue(value: FeatureValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** Compact units for the 52 px unit column (the full unit stays in the label tooltip). */
const SHORT_UNITS: Readonly<Record<string, string>> = {
  'beats/min': 'bpm',
  'cells/µL': '/µL',
  '×10³/µL': '10³/µL',
};

/** Display unit of a numeric input ("y", "mg/dL", "bpm"). */
export function unitOf(spec: FeatureSpec): string {
  const unit = formatUnit(spec.unit);
  return SHORT_UNITS[unit] ?? unit;
}

/** Value and unit split for tabular display: { value: "101", unit: "mg/dL" }; binaries read Yes / No. */
export function displayParts(spec: FeatureSpec, value: FeatureValue | undefined): { value: string; unit: string } {
  if (spec.type !== 'numeric') return { value: formatFeatureValue(spec, value), unit: '' };
  const n = numericValue(value);
  if (!Number.isFinite(n)) return { value: '–', unit: '' };
  return { value: formatNumber(n, spec.step), unit: unitOf(spec) };
}

/** Short on-screen label of a categorical option: "None", "Mild", "Mod.", "LBBB" (full term in a tooltip). */
export function optionShort(label: string): string {
  return label.length > 6 && !/^[A-Z0-9]+$/.test(label) ? `${label.slice(0, 3)}.` : label;
}

/** "70 y", "Yes", "LBBB" — the one-line value used in tooltips, "was" captions and toasts. */
export function displayValue(spec: FeatureSpec, value: FeatureValue | undefined): string {
  const { value: v, unit } = displayParts(spec, value);
  return unit ? `${v}${THIN_SPACE}${unit}` : v;
}

/** Spoken value for aria-labels: "yes", "50 percent", "101 milligrams per decilitre" is overkill — keep units short. */
export function spokenValue(spec: FeatureSpec, value: FeatureValue | undefined): string {
  if (spec.type === 'binary') return isPresent(value) ? 'yes' : 'no';
  const { value: v, unit } = displayParts(spec, value);
  if (!unit) return v;
  return `${v} ${unit === '%' ? 'percent' : unit === 'y' ? 'years' : unit}`;
}

/** Keys whose value differs between two vectors (union of keys). */
export function changedKeys(features: FeatureVector, reference: FeatureVector): string[] {
  const keys = new Set([...Object.keys(features), ...Object.keys(reference)]);
  return [...keys].filter((k) => !sameValue(features[k], reference[k]));
}

/**
 * Snap a numeric input to the schema's step (zero-anchored, so a BMI of 26.8 stays 26.8 even though the
 * schema minimum is 18.1154) and clamp it to [min, max].
 */
export function snapNumeric(spec: FeatureSpec, n: number): number {
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = spec.max ?? Number.POSITIVE_INFINITY;
  const step = spec.step && spec.step > 0 ? spec.step : null;
  let v = step ? Math.round(n / step) * step : n;
  v = Math.min(max, Math.max(min, v));
  return Number(v.toPrecision(12));
}

/** Whether a typed number is inside the schema range (the edge of the range is allowed). */
export function inRange(spec: FeatureSpec, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  if (spec.min !== null && spec.min !== undefined && n < spec.min - 1e-9) return false;
  if (spec.max !== null && spec.max !== undefined && n > spec.max + 1e-9) return false;
  return true;
}

/** The value a binary input takes when flipped. */
export const flipped = (value: FeatureValue | undefined): 0 | 1 => (isPresent(value) ? 0 : 1);

/**
 * Card labels (V2 §5.5): the schema label, abbreviated only where it cannot fit the 150 px column
 * ("Wall-motion abn." as in the spec). The full label stays in the tooltip and the aria-label.
 */
const CARD_LABELS: Readonly<Record<string, string>> = {
  'Region RWMA': 'Wall-motion abn.',
  'Poor R Progression': 'Poor R-wave progr.',
  LVH: 'LV hypertrophy',
  'Weak Peripheral Pulse': 'Weak periph. pulse',
  Nonanginal: 'Non-anginal pain',
  'Thyroid Disease': 'Thyroid disease',
  'EX-Smoker': 'Former smoker',
  CRF: 'Chronic renal failure',
  BUN: 'Urea nitrogen',
  VHD: 'Valve disease',
};

export function cardLabel(spec: FeatureSpec): string {
  return CARD_LABELS[spec.key] ?? spec.label;
}
