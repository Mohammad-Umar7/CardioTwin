/**
 * What the Explain › Model tab states about the deployed model (WORKSTATION_V2 §5.10): the threshold and how it
 * was chosen, test ROC-AUC with CI and n, CV, calibration, robustness over re-splits and what each data
 * modality adds. Read from `model/metrics_summary.json` (a few KB, written by ml/) when present, otherwise
 * from the full `metrics.json` (CONTRACTS §4, §7.2). Every field is optional: a missing key hides its line.
 */
import { fetchStaticJson, memoize, metricsResource, MODEL_DIR } from '@/services/staticData';
import type { MetricsReport, TargetId } from '@/types/contracts';

export interface Estimate {
  value: number;
  ci?: [number, number] | null;
}

export interface ModalityStep {
  group: string;
  label: string;
  /** Cumulative development-CV ROC-AUC with this modality added. */
  auc: Estimate;
  /** Change from the previous step (null for the first). */
  delta: (Estimate & { pHolm?: number | null }) | null;
}

export interface TargetFacts {
  threshold: number | null;
  /** Youden's J on out-of-fold predictions, in words. */
  thresholdRule: string | null;
  test: {
    auc: Estimate | null;
    sensitivity: Estimate | null;
    specificity: Estimate | null;
    brier: Estimate | null;
  };
  cvAuc: { mean: number; std: number } | null;
  calibration: { slope: number | null; inTheLarge: number | null; ece: number | null };
  robustness: { nSplits: number; median: number; p05: number; p95: number; percentile: number | null } | null;
  modality: { steps: ModalityStep[]; instrumental: Estimate | null } | null;
}

export interface ModelFacts {
  source: 'summary' | 'metrics';
  modelVersion: string | null;
  dataset: {
    name: string | null;
    n: number | null;
    nTest: number | null;
    nDev: number | null;
    /** Share of patients with each condition (whole cohort). */
    prevalence: Partial<Record<TargetId, number>>;
  };
  targets: Partial<Record<TargetId, TargetFacts>>;
}

// ------------------------------------------------------------------------------------ readers

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const ci = (x: unknown): [number, number] | null => {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [a, b] = x;
  return num(a) !== null && num(b) !== null ? [a as number, b as number] : null;
};
/** `{ value, ci }` or `{ mean, ci }`. */
const estimate = (x: unknown): Estimate | null => {
  const o = obj(x);
  if (!o) return null;
  const value = num(o.value) ?? num(o.mean);
  return value === null ? null : { value, ci: ci(o.ci) };
};

const RULES: Record<string, string> = {
  youden_j_on_oof_deployed_hyperparameters:
    "chosen on the development folds to balance sensitivity and specificity (Youden's J on out-of-fold predictions)",
};
const ruleText = (rule: string | null) =>
  rule ? (RULES[rule] ?? (/youden/i.test(rule) ? RULES.youden_j_on_oof_deployed_hyperparameters! : null)) : null;

function modalitySteps(cumulative: unknown): ModalityStep[] {
  if (!Array.isArray(cumulative)) return [];
  const steps: ModalityStep[] = [];
  for (const raw of cumulative) {
    const o = obj(raw);
    const auc = estimate(o?.roc_auc);
    const group = str(o?.group);
    if (!o || !auc || !group) continue;
    const d = obj(o.delta) ?? obj(o.delta_vs_previous);
    const delta = d && num(d.mean) !== null ? { value: num(d.mean)!, ci: ci(d.ci), pHolm: num(d.p_holm) } : null;
    steps.push({ group, label: str(o.label) ?? group, auc, delta });
  }
  return steps;
}

function prevalenceOf(x: unknown): Partial<Record<TargetId, number>> {
  const o = obj(x);
  const out: Partial<Record<TargetId, number>> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (num(v) !== null) out[k] = v as number;
  return out;
}

function robustnessFrom(x: unknown): TargetFacts['robustness'] {
  const r = obj(x);
  const auc = obj(r?.roc_auc);
  const median = num(auc?.p50);
  const p05 = num(auc?.p05);
  const p95 = num(auc?.p95);
  if (!r || median === null || p05 === null || p95 === null) return null;
  return {
    nSplits: num(r.n_splits) ?? num(auc?.n) ?? 0,
    median,
    p05,
    p95,
    percentile: num(auc?.fixed_split_percentile) ?? num(r.fixed_split_percentile),
  };
}

/** `metrics_summary.json` (format "cardiotwin-metrics-summary" 1.x). Throws on anything else. */
export function factsFromSummary(summary: unknown): ModelFacts {
  const s = obj(summary);
  if (!s || !String(s.format ?? '').startsWith('cardiotwin-metrics-summary') || !obj(s.targets)) {
    throw new Error('metrics_summary.json has an unexpected shape');
  }
  const dataset = obj(s.dataset);
  const targets: ModelFacts['targets'] = {};
  for (const [id, raw] of Object.entries(obj(s.targets)!)) {
    const t = obj(raw);
    if (!t) continue;
    const test = obj(t.test);
    const cv = obj(obj(t.cv)?.roc_auc);
    const cal = obj(t.calibration);
    const modality = obj(t.modality);
    const instrumental = obj(modality?.instrumental);
    targets[id] = {
      threshold: num(t.threshold),
      thresholdRule: ruleText(str(t.threshold_rule) ?? 'youden_j_on_oof_deployed_hyperparameters'),
      test: {
        auc: estimate(test?.roc_auc),
        sensitivity: estimate(test?.recall),
        specificity: estimate(test?.specificity),
        brier: estimate(test?.brier),
      },
      cvAuc: cv && num(cv.mean) !== null ? { mean: num(cv.mean)!, std: num(cv.std) ?? 0 } : null,
      calibration: { slope: num(cal?.calibration_slope), inTheLarge: num(cal?.calibration_in_the_large), ece: num(cal?.ece) },
      robustness: robustnessFrom(t.robustness),
      modality: modality
        ? { steps: modalitySteps(modality.cumulative), instrumental: estimate(instrumental?.delta) }
        : null,
    };
  }
  return {
    source: 'summary',
    modelVersion: str(s.model_version),
    dataset: {
      name: str(dataset?.name),
      n: num(dataset?.n),
      nTest: num(dataset?.n_test),
      nDev: num(dataset?.n_dev),
      prevalence: prevalenceOf(dataset?.prevalence),
    },
    targets,
  };
}

/** The full evaluation report (CONTRACTS §4 + the v1.1 keys of §7.2). */
export function factsFromMetrics(metrics: MetricsReport): ModelFacts {
  const m = metrics as unknown as Json;
  const targets: ModelFacts['targets'] = {};
  for (const [id, raw] of Object.entries(metrics.targets)) {
    const t = obj(raw);
    if (!t) continue;
    const test = obj(t.test);
    const cv = obj(obj(t.cv)?.roc_auc);
    const cal = obj(t.calibration_summary);
    const ablation = obj(obj(m.modality_ablation)?.[id]);
    const instrumental = obj(ablation?.instrumental);
    targets[id] = {
      threshold: num(t.threshold),
      thresholdRule: ruleText(str(t.threshold_rule)),
      test: {
        auc: estimate(test?.roc_auc),
        sensitivity: estimate(test?.recall),
        specificity: estimate(test?.specificity),
        brier: estimate(test?.brier),
      },
      cvAuc: cv && num(cv.mean) !== null ? { mean: num(cv.mean)!, std: num(cv.std) ?? 0 } : null,
      calibration: { slope: num(cal?.calibration_slope), inTheLarge: num(cal?.calibration_in_the_large), ece: num(cal?.ece) },
      robustness: robustnessFrom(obj(m.robustness)?.[id]),
      modality: ablation
        ? { steps: modalitySteps(ablation.cumulative), instrumental: estimate(instrumental?.delta) }
        : null,
    };
  }
  return {
    source: 'metrics',
    modelVersion: str(m.model_version) ?? str(metrics.version),
    dataset: {
      name: metrics.dataset.name ?? null,
      n: metrics.dataset.n ?? null,
      nTest: metrics.dataset.n_test ?? null,
      nDev: metrics.dataset.n_dev ?? null,
      prevalence: prevalenceOf(metrics.dataset.prevalence),
    },
    targets,
  };
}

/** Summary first (small); the full report only when the summary is missing or malformed. */
export const modelFactsResource = memoize<ModelFacts>(async () => {
  try {
    return factsFromSummary(await fetchStaticJson<unknown>(`${MODEL_DIR}/metrics_summary.json`));
  } catch {
    return factsFromMetrics(await metricsResource.get());
  }
});
