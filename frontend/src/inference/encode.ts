/**
 * Encoding — port of `portable.encode` / `portable.derived_value`: API-normalised values → the float64
 * column vector in `model.columns` order (encoded raw features first, then derived columns).
 */
import { ModelFormatError } from './errors';
import type { DerivedSpec, NormalisedValue, PortableModelSpec } from './types';

function asFloat(value: NormalisedValue | undefined, context: string): number {
  if (typeof value !== 'number') throw new ModelFormatError(`${context}: expected a numeric value, got ${String(value)}`);
  return value;
}

/** One derived column (`ratio`, `sum`, `ckd_epi_2021`), evaluated exactly as the reference does. */
export function derivedValue(
  spec: DerivedSpec,
  values: Readonly<Record<string, NormalisedValue>>,
  constants: PortableModelSpec['constants'],
): number {
  const { op, inputs } = spec;
  const input = (i: number) => asFloat(values[inputs[i] ?? ''], `${spec.feature} (${op})`);
  if (op === 'ratio') {
    return input(0) / Math.max(input(1), constants.ratio_min_denominator);
  }
  if (op === 'sum') {
    let total = 0.0;
    for (let i = 0; i < inputs.length; i++) total += input(i);
    return total;
  }
  if (op === 'ckd_epi_2021') {
    const scr = Math.max(input(0), constants.ckd_epi_min_creatinine);
    const age = input(1);
    const female = values[inputs[2] ?? ''] === 'Female';
    const kappa = female ? 0.7 : 0.9;
    const alpha = female ? -0.241 : -0.302;
    const ratio = scr / kappa;
    const egfr = 142.0 * Math.pow(Math.min(ratio, 1.0), alpha) * Math.pow(Math.max(ratio, 1.0), -1.2) * Math.pow(0.9938, age);
    return female ? egfr * 1.012 : egfr;
  }
  throw new ModelFormatError(`unknown derived op '${op}'`);
}

export interface EncodedRow {
  /** Encoded vector, length `columns.length`. */
  x: Float64Array;
  /** Derived column values keyed by derived feature name. */
  derived: Record<string, number>;
}

/** API-normalised values → encoded float64 vector in `model.columns` order. */
export function encode(model: PortableModelSpec, values: Readonly<Record<string, NormalisedValue>>): EncodedRow {
  const x = new Float64Array(model.columns.length);
  let j = 0;
  const push = (v: number) => {
    if (j >= x.length) throw new ModelFormatError('encoded row is longer than model.columns');
    x[j++] = v;
  };
  for (const enc of model.encoding) {
    const v = values[enc.feature];
    switch (enc.kind) {
      case 'numeric':
      case 'binary':
        push(asFloat(v, enc.feature));
        break;
      case 'ordinal': {
        const mapped = typeof v === 'string' ? enc.map[v] : undefined;
        if (mapped === undefined) throw new ModelFormatError(`${enc.feature}: no ordinal code for ${String(v)}`);
        push(mapped);
        break;
      }
      case 'onehot':
        for (const category of enc.categories) push(v === category ? 1.0 : 0.0);
        break;
      default:
        throw new ModelFormatError(`unknown encoding kind '${(enc as { kind: string }).kind}'`);
    }
  }
  const derived: Record<string, number> = {};
  for (const spec of model.derived) {
    const d = derivedValue(spec, values, model.constants);
    derived[spec.feature] = d;
    push(d);
  }
  if (j !== model.columns.length) throw new ModelFormatError('encoded row length does not match model columns');
  return { x, derived };
}
