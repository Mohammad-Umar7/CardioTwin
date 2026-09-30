/**
 * What-if scoring for the patient UI (WORKSTATION_V2 §9.3 B, P2): ICE strips in the expanded row,
 * counterfactual tooltips on finding chips, the palette's "CAD 98 % → 91 %" preview and the switcher's
 * CAD pips. Everything runs on the shared in-browser inference worker (`@/inference`, scores only, no
 * SHAP), so it costs microseconds per row and never touches the server.
 *
 * Every function resolves to `null` instead of throwing when the edge model is unavailable (no
 * model.json, worker failure, aborted): callers simply hide the extra detail. Results are cached by the
 * exact input vector, so hovering the same chip twice never recomputes.
 */
import { computeIce, getSharedInferenceClient, linspace } from '@/inference';
import { sanitizeFeatures } from '@/services/engine';
import type { FeatureSpec, FeatureValue, FeatureVector, TargetId } from '@/types/contracts';
import { flipped } from './values';

export type TargetProbabilities = Partial<Record<TargetId, number>>;

/** Stable key for a feature vector (sorted entries). */
export function vectorKey(features: FeatureVector): string {
  return JSON.stringify(Object.keys(features).sort().map((k) => [k, features[k]]));
}

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  clear(): void {
    this.map.clear();
  }
}

const scoreCache = new Lru<TargetProbabilities>(2048);
const iceCache = new Lru<IceResult>(128);

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Probabilities for many rows in one worker message (cached per row). Null when unavailable. */
export async function scoreRows(rows: readonly FeatureVector[], signal?: AbortSignal): Promise<TargetProbabilities[] | null> {
  const keys = rows.map(vectorKey);
  const missing: number[] = [];
  keys.forEach((k, i) => {
    if (!scoreCache.get(k)) missing.push(i);
  });
  if (missing.length > 0) {
    try {
      const client = getSharedInferenceClient();
      const scores = await client.predictBatch(
        missing.map((i) => sanitizeFeatures(rows[i]!)),
        { signal },
      );
      scores.forEach((score, j) => {
        const out = {} as TargetProbabilities;
        for (const [t, p] of Object.entries(score.predictions)) out[t] = p.probability;
        scoreCache.set(keys[missing[j]!]!, out);
      });
    } catch (e) {
      if (!isAbort(e) && import.meta.env.DEV) console.info('[patient] what-if scoring unavailable', e);
      return null;
    }
  }
  const out = keys.map((k) => scoreCache.get(k));
  return out.every(Boolean) ? (out as TargetProbabilities[]) : null;
}

/** Probabilities if each binary `key` were flipped (one batch). Map key → probabilities. */
export async function flipCounterfactuals(
  features: FeatureVector,
  keys: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, TargetProbabilities> | null> {
  const rows = keys.map((k) => ({ ...features, [k]: flipped(features[k]) }));
  const scores = await scoreRows(rows, signal);
  if (!scores) return null;
  return new Map(keys.map((k, i) => [k, scores[i]!]));
}

/** Probabilities with one input set to `value`. */
export async function scoreWith(features: FeatureVector, key: string, value: FeatureValue, signal?: AbortSignal) {
  const scores = await scoreRows([{ ...features, [key]: value }], signal);
  return scores?.[0] ?? null;
}

export interface IceResult {
  feature: string;
  values: number[];
  probabilities: Record<TargetId, number[]>;
}

export const ICE_SAMPLES = 32;

/**
 * ICE strip of a numeric input: p(target) across [min, max] with everything else held at `features`.
 * The strip of the input being dragged never changes (its own value is swept), so the cache key leaves
 * that input out.
 */
export async function iceStrip(features: FeatureVector, spec: FeatureSpec, signal?: AbortSignal): Promise<IceResult | null> {
  if (spec.type !== 'numeric' || spec.min == null || spec.max == null || spec.ice === false) return null;
  const rest = { ...features };
  delete rest[spec.key];
  const cacheKey = `${spec.key}|${vectorKey(rest)}`;
  const cached = iceCache.get(cacheKey);
  if (cached) return cached;
  try {
    const values = linspace(spec.min, spec.max, ICE_SAMPLES, spec.step);
    const [strip] = await computeIce(getSharedInferenceClient(), features, [{ key: spec.key, values }], { signal });
    if (!strip) return null;
    const result: IceResult = { feature: spec.key, values, probabilities: strip.probabilities };
    iceCache.set(cacheKey, result);
    return result;
  } catch (e) {
    if (!isAbort(e) && import.meta.env.DEV) console.info('[patient] ICE unavailable', e);
    return null;
  }
}

/** Tests: forget every cached result. */
export function clearWhatIfCaches(): void {
  scoreCache.clear();
  iceCache.clear();
}
