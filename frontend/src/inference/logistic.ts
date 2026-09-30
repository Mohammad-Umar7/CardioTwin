/**
 * Logistic component — port of `portable.logistic_margin` / `portable.logistic_shap`.
 *
 *   m      = intercept + Σ_j coef_j · (x_j − mean_j) / scale_j        (j in column order)
 *   φ_j    = (x_j − background_mean_j) · (coef_j / scale_j)            exact linear SHAP vs the dev mean
 */
import { ModelFormatError } from './errors';
import type { LogisticComponentSpec } from './types';

export interface CompiledLogistic {
  readonly type: 'logistic';
  readonly name: string;
  readonly weight: number;
  readonly baseValue: number;
  readonly intercept: number;
  readonly coef: Float64Array;
  readonly mean: Float64Array;
  readonly scale: Float64Array;
  readonly background: Float64Array;
  /** `coef_j / scale_j`, precomputed (the same single division the reference performs per call). */
  readonly slope: Float64Array;
}

export function compileLogistic(spec: LogisticComponentSpec, nColumns: number): CompiledLogistic {
  const vectors = {
    coef: spec.coef,
    'scaler.mean': spec.scaler?.mean,
    'scaler.scale': spec.scaler?.scale,
    background_mean: spec.background_mean,
  };
  for (const [name, v] of Object.entries(vectors)) {
    if (!Array.isArray(v) || v.length !== nColumns) {
      throw new ModelFormatError(`logistic component '${spec.name}': ${name} must have ${nColumns} entries`);
    }
  }
  const coef = Float64Array.from(spec.coef);
  const scale = Float64Array.from(spec.scaler.scale);
  const slope = new Float64Array(nColumns);
  for (let j = 0; j < nColumns; j++) slope[j] = coef[j] / scale[j];
  return {
    type: 'logistic',
    name: spec.name,
    weight: spec.weight,
    baseValue: spec.base_value,
    intercept: spec.intercept,
    coef,
    mean: Float64Array.from(spec.scaler.mean),
    scale,
    background: Float64Array.from(spec.background_mean),
    slope,
  };
}

export function logisticMargin(c: CompiledLogistic, x: Float64Array): number {
  let m = c.intercept;
  const { coef, mean, scale } = c;
  for (let j = 0; j < x.length; j++) m += coef[j] * ((x[j] - mean[j]) / scale[j]);
  return m;
}

/** Writes `weight · φ_j` into `out` (accumulating), the ensemble step of `PortableModel.predict`. */
export function accumulateLogisticShap(c: CompiledLogistic, x: Float64Array, weight: number, out: Float64Array): void {
  const { background, slope } = c;
  for (let j = 0; j < x.length; j++) out[j] = out[j] + weight * ((x[j] - background[j]) * slope[j]);
}
