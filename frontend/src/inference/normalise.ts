/**
 * Input normalisation — port of `portable.normalise_value` / `portable.normalise_features`.
 *
 *   binary       0/1, true/false, and case-insensitive "1"/"0", "y"/"n", "yes"/"no", "true"/"false", "t"/"f"
 *   categorical  case-insensitive match against `options`, after the dataset `aliases` ("Fmale" → "Female")
 *   numeric      any finite number or numeric string with Python `float()` syntax (no clamping)
 *
 * Unknown keys are an error; missing / null keys take the feature `default` and are reported in
 * `imputed`, in `features` order.
 */
import { FeatureInputError } from './errors';
import type { EdgeFeatureInput, EdgeFeatureValue, NormalisedValue, PortableFeature } from './types';

const TRUE_WORDS: ReadonlySet<string> = new Set(['1', 'y', 'yes', 'true', 't']);
const FALSE_WORDS: ReadonlySet<string> = new Set(['0', 'n', 'no', 'false', 'f']);

/** Python `float()` literal syntax (digits with single underscores, optional fraction and exponent). */
const PY_FLOAT_LITERAL = /^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/;
/** Literals Python parses to non-finite floats (rejected afterwards, like the reference). */
const PY_NON_FINITE_LITERAL = /^[+-]?(?:inf|infinity|nan)$/i;

/** `repr`-like rendering for error messages. */
function show(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Parse a string exactly where Python's `float(str)` succeeds; `null` where it raises. */
export function parsePythonFloat(text: string): number | null {
  const s = text.trim();
  if (PY_FLOAT_LITERAL.test(s)) return Number(s.replace(/_/g, ''));
  if (PY_NON_FINITE_LITERAL.test(s)) return s.toLowerCase().includes('nan') ? Number.NaN : s.startsWith('-') ? -Infinity : Infinity;
  return null;
}

/** Coerce one API value to its canonical form. Throws `FeatureInputError` on anything unusable. */
export function normaliseValue(feature: PortableFeature, value: EdgeFeatureValue): NormalisedValue {
  const { key, type } = feature;
  if (type === 'binary') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 0 ? 0 : 1;
    if (typeof value === 'string') {
      const word = value.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return 1;
      if (FALSE_WORDS.has(word)) return 0;
    }
    throw new FeatureInputError(`${key}: expected a binary value, got ${show(value)}`, [key]);
  }
  if (type === 'categorical') {
    if (typeof value === 'string') {
      let s = value.trim();
      for (const [alias, target] of Object.entries(feature.aliases ?? {})) {
        if (s.toLowerCase() === alias.toLowerCase()) {
          s = target;
          break;
        }
      }
      for (const option of feature.options ?? []) {
        if (s.toLowerCase() === option.toLowerCase()) return option;
      }
    }
    throw new FeatureInputError(`${key}: expected one of ${show(feature.options ?? [])}, got ${show(value)}`, [key]);
  }
  if (typeof value === 'boolean') throw new FeatureInputError(`${key}: expected a number, got a boolean`, [key]);
  let out: number | null = null;
  if (typeof value === 'number') out = value;
  else if (typeof value === 'string') out = parsePythonFloat(value);
  if (out === null) throw new FeatureInputError(`${key}: expected a number, got ${show(value)}`, [key]);
  if (!Number.isFinite(out)) throw new FeatureInputError(`${key}: value must be finite`, [key]);
  return out;
}

export interface NormalisedFeatures {
  /** Every model feature, keyed by raw name, in canonical form. */
  values: Record<string, NormalisedValue>;
  /** Keys filled with their default, in `features` order. */
  imputed: string[];
}

/**
 * Validate keys, normalise values and fill missing features with their defaults. `known` (the set of
 * feature keys) may be passed in by callers that normalise many requests against one model.
 */
export function normaliseFeatures(
  features: readonly PortableFeature[],
  input: EdgeFeatureInput,
  known: ReadonlySet<string> = new Set(features.map((f) => f.key)),
): NormalisedFeatures {
  let unknown: string[] | null = null;
  for (const key in input) {
    if (Object.prototype.hasOwnProperty.call(input, key) && !known.has(key)) (unknown ??= []).push(key);
  }
  if (unknown) throw new FeatureInputError(`unknown feature(s): ${show(unknown)}`, unknown);
  const values: Record<string, NormalisedValue> = {};
  const imputed: string[] = [];
  for (const f of features) {
    const raw = Object.prototype.hasOwnProperty.call(input, f.key) ? input[f.key] : undefined;
    if (raw !== null && raw !== undefined) {
      values[f.key] = normaliseValue(f, raw);
    } else {
      values[f.key] = f.default;
      imputed.push(f.key);
    }
  }
  return { values, imputed };
}
