/**
 * ICE (individual conditional expectation) strips: how each target's probability changes when one
 * input of THIS patient sweeps its range, everything else held fixed. One `predictBatch` message for
 * all strips (scores only, no SHAP), cancellable with an AbortSignal when the inputs change again.
 */
import { sanitizeFeatures } from '@/services/engine';
import type { FeatureValue, FeatureVector, TargetId } from '@/types/contracts';
import type { InferenceClient, RequestOptions } from './client';

export interface IceFeatureRequest {
  key: string;
  /** Values to evaluate, in display order (numbers for numerics, 0/1 for binaries, options for categoricals). */
  values: readonly FeatureValue[];
}

export interface IceStrip {
  feature: string;
  values: FeatureValue[];
  /** Probability per value, for every target (switch targets without recomputing). */
  probabilities: Record<TargetId, number[]>;
}

/** `n` evenly spaced values over [min, max] (inclusive), optionally snapped to `step` and de-duplicated. */
export function linspace(min: number, max: number, n: number, step?: number | null): number[] {
  if (!(n >= 2) || !Number.isFinite(min) || !Number.isFinite(max)) return Number.isFinite(min) ? [min] : [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = min + ((max - min) * i) / (n - 1);
    if (step && step > 0) {
      v = Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
      v = Number(v.toPrecision(12)); // drop binary noise such as 0.30000000000000004
    }
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

/** `base` with `feature` replaced by each of `values` (one row per value). */
export function iceRows(base: FeatureVector, feature: string, values: readonly FeatureValue[]): FeatureVector[] {
  return values.map((value) => ({ ...base, [feature]: value }));
}

/** Evaluate many ICE strips in ONE worker round trip. */
export async function computeIce(
  client: InferenceClient,
  base: FeatureVector,
  features: readonly IceFeatureRequest[],
  options: RequestOptions = {},
): Promise<IceStrip[]> {
  const clean = sanitizeFeatures(base);
  const rows: FeatureVector[] = [];
  for (const f of features) rows.push(...iceRows(clean, f.key, f.values));
  const scores = await client.predictBatch(rows, { signal: options.signal });
  const strips: IceStrip[] = [];
  let offset = 0;
  for (const f of features) {
    // Filled for every model target below (the contract types the map with the known target ids).
    const probabilities = {} as Record<TargetId, number[]>;
    for (let i = 0; i < f.values.length; i++) {
      const score = scores[offset + i]!;
      for (const [target, prediction] of Object.entries(score.predictions)) {
        (probabilities[target] ??= []).push(prediction.probability);
      }
    }
    strips.push({ feature: f.key, values: [...f.values], probabilities });
    offset += f.values.length;
  }
  return strips;
}
