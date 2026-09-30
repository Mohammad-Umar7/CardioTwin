/**
 * "Drives {target} most" ranking for the patient card (WORKSTATION_V2 §5.5): the top inputs by |SHAP|
 * for the current target, Age and Sex excluded (they live in the card header), ties broken by schema
 * order. Without a prediction the list falls back to the schema order of the key groups (symptoms, ECG,
 * echo) and carries no direction.
 */
import type { SchemaIndex } from '@/hooks/useData';
import type { Contribution, Explanation, FeatureSpec } from '@/types/contracts';

/** Direction-mark length in 3 steps by |SHAP| share of the whole explanation. */
export type Strength = 1 | 2 | 3;

export interface KeyInput {
  key: string;
  spec: FeatureSpec;
  /** Log-odds contribution, or null in the fallback ranking. */
  shap: number | null;
  direction: 'raises' | 'lowers' | null;
  strength: Strength | null;
}

/** |SHAP| share at or above which the mark is long (3) or medium (2). Below 1 %: not listed as a driver. */
export const STRENGTH_SHARE = { strong: 0.12, moderate: 0.05 } as const;
export const DEFAULT_EXCLUDE = ['Age', 'Sex'] as const;
/** Fallback ranking when no prediction is available (V2 §5.5 "no prediction"). */
export const FALLBACK_GROUPS = ['symptoms', 'ecg', 'echo'] as const;

export function strengthOf(share: number): Strength {
  return share >= STRENGTH_SHARE.strong ? 3 : share >= STRENGTH_SHARE.moderate ? 2 : 1;
}

export const STRENGTH_WORD: Record<Strength, string> = { 3: 'strongly', 2: 'moderately', 1: 'slightly' };

export interface RankOptions {
  n?: number;
  exclude?: readonly string[];
}

/** Contributions ordered by |SHAP| desc, ties by schema order (stable across engines). */
export function orderContributions(explanation: Explanation, index: SchemaIndex): Contribution[] {
  const order = new Map(index.features.map((f, i) => [f.key, i]));
  return [...explanation.contributions].sort(
    (a, b) =>
      Math.abs(b.shap) - Math.abs(a.shap) ||
      (order.get(a.feature) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.feature) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function rankKeyInputs(
  index: SchemaIndex,
  explanation: Explanation | null | undefined,
  { n = 5, exclude = DEFAULT_EXCLUDE }: RankOptions = {},
): KeyInput[] {
  const skip = new Set(exclude);
  if (!explanation || explanation.contributions.length === 0) {
    const out: KeyInput[] = [];
    for (const group of FALLBACK_GROUPS) {
      for (const spec of index.groups.find((g) => g.id === group)?.features ?? []) {
        if (skip.has(spec.key)) continue;
        out.push({ key: spec.key, spec, shap: null, direction: null, strength: null });
      }
    }
    return out.slice(0, n);
  }
  const total = explanation.contributions.reduce((s, c) => s + Math.abs(c.shap), 0);
  const out: KeyInput[] = [];
  for (const c of orderContributions(explanation, index)) {
    if (out.length >= n) break;
    const spec = index.byKey.get(c.feature);
    if (!spec || skip.has(c.feature) || c.shap === 0) continue;
    const share = total > 0 ? Math.abs(c.shap) / total : 0;
    out.push({
      key: c.feature,
      spec,
      shap: c.shap,
      direction: c.shap > 0 ? 'raises' : 'lowers',
      strength: strengthOf(share),
    });
  }
  return out;
}

/** "Typical angina, yes, raises CAD risk strongly." */
export function keyInputAriaLabel(item: KeyInput, spokenValue: string, target: string): string {
  const base = `${item.spec.label}, ${spokenValue}`;
  if (!item.direction || !item.strength) return `${base}.`;
  return `${base}, ${item.direction} ${target} risk ${STRENGTH_WORD[item.strength]}.`;
}
