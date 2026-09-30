/**
 * "Biggest levers" (WORKSTATION_V2 §5.10 What-if, P2): for the inputs that move an estimate most, the
 * model's answer if that one input were different — a finding flipped, a measure moved to the edge of its
 * reference range, an abnormal category cleared. These are MODEL COUNTERFACTUALS, not treatment advice: they
 * say how this model responds, not what would happen to the patient.
 *
 * Pure candidate generation and result shaping; the scoring (one worker batch) lives in `useLevers.ts`.
 */
import { NEGLIGIBLE_SHAP, sortedContributions } from '@/lib/explain';
import { rangeStatus } from '@/lib/format';
import type { Explanation, FeatureSpec, FeatureValue, FeatureVector, TargetId } from '@/types/contracts';

/** Inputs no one can change: never offered as a lever. */
export const IMMUTABLE_INPUTS: ReadonlySet<string> = new Set(['Age', 'Sex', 'Length']);

export type LeverKind = 'flip' | 'normalise' | 'clear';

export interface LeverCandidate {
  feature: string;
  from: FeatureValue;
  to: FeatureValue;
  kind: LeverKind;
}

const isPresent = (v: unknown) => v === 1 || v === '1' || v === true;

/** The counterfactual value for one input, or null when it has no natural "other" value. */
export function counterfactualValue(spec: FeatureSpec, value: FeatureValue | undefined): Omit<LeverCandidate, 'feature'> | null {
  if (value === undefined || value === null || value === '') return null;
  if (spec.type === 'binary') {
    const on = isPresent(value);
    return { from: on ? 1 : 0, to: on ? 0 : 1, kind: 'flip' };
  }
  if (spec.type === 'categorical') {
    const none = spec.options?.find((o) => String(o.value).toUpperCase() === 'N' || /^none$/i.test(o.label));
    if (!none || String(value).toUpperCase() === String(none.value).toUpperCase()) return null;
    return { from: value, to: none.value, kind: 'clear' };
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const status = rangeStatus(n, spec.normal);
  let to: number | null = null;
  if (status === 'above' && spec.normal?.high != null) to = spec.normal.high;
  if (status === 'below' && spec.normal?.low != null) to = spec.normal.low;
  if (to === null) return null;
  if (spec.min != null) to = Math.max(spec.min, to);
  if (spec.max != null) to = Math.min(spec.max, to);
  return to === n ? null : { from: n, to, kind: 'normalise' };
}

/**
 * Up to `max` levers for one target: the changeable inputs with the largest |SHAP|, each with a
 * counterfactual value. Current inputs win over the explanation's echo (the explanation can lag a frame).
 */
export function leverCandidates(
  features: FeatureVector,
  explanation: Explanation | null | undefined,
  specOf: (key: string) => FeatureSpec | undefined,
  max = 8,
): LeverCandidate[] {
  const out: LeverCandidate[] = [];
  for (const c of sortedContributions(explanation)) {
    if (out.length >= max) break;
    if (IMMUTABLE_INPUTS.has(c.feature) || Math.abs(c.shap) < NEGLIGIBLE_SHAP) continue;
    const spec = specOf(c.feature);
    if (!spec) continue;
    const current = (features[c.feature] ?? c.value) as FeatureValue | undefined;
    const cf = counterfactualValue(spec, current);
    if (cf) out.push({ feature: c.feature, ...cf });
  }
  return out;
}

/** Candidates for several targets, merged by input (the same input has the same counterfactual). */
export function mergeCandidates(lists: readonly LeverCandidate[][]): LeverCandidate[] {
  const byKey = new Map<string, LeverCandidate>();
  for (const list of lists) for (const c of list) if (!byKey.has(c.feature)) byKey.set(c.feature, c);
  return [...byKey.values()];
}

/** Rows to score: the unchanged inputs first (the reference), then one row per candidate. */
export function leverRows(features: FeatureVector, candidates: readonly LeverCandidate[]): FeatureVector[] {
  return [features, ...candidates.map((c) => ({ ...features, [c.feature]: c.to }))];
}

export interface Lever extends LeverCandidate {
  /** Probability of the target now (reference row) and with this one input changed. */
  now: number;
  then: number;
  /** then − now, on the 0–1 scale. */
  delta: number;
}

/**
 * Levers for one target, largest |Δ| first. `probabilities[0]` is the reference row, then one per candidate
 * in `candidates` order (the output of `leverRows`). `wanted` limits the list to that target's candidates.
 */
export function rankLevers(
  target: TargetId,
  candidates: readonly LeverCandidate[],
  probabilities: readonly Partial<Record<TargetId, number>>[],
  wanted?: ReadonlySet<string>,
): Lever[] {
  const now = probabilities[0]?.[target];
  if (typeof now !== 'number') return [];
  const levers: Lever[] = [];
  candidates.forEach((c, i) => {
    if (wanted && !wanted.has(c.feature)) return;
    const then = probabilities[i + 1]?.[target];
    if (typeof then !== 'number') return;
    levers.push({ ...c, now, then, delta: then - now });
  });
  return levers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.feature.localeCompare(b.feature));
}
