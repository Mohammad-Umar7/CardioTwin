/**
 * Landing-page performance facts (WORKSTATION_V2 §6.1 KPI strip, protocol line, Validate pillar).
 *
 * Source of truth, in order:
 *   1. `model/metrics_summary.json` — the compact landing view written by `ml/` (a few KB);
 *   2. `model/metrics.json` — the full evaluation report (≈ 1.4 MB), used when the summary is absent.
 * Values are never hard-coded and never counted up. Test metrics carry their bootstrap CI and n; CV
 * metrics carry mean ± sd over the outer folds, so the landing states both honestly.
 */
import { fetchStaticJson, MissingAssetError, MODEL_DIR, memoize, metricsResource } from '@/services/staticData';
import { useResource } from '@/hooks/useResource';
import { EN_DASH, THIN_SPACE, formatMetricValue } from '@/lib/format';
import { TARGET_ORDER, type MetricsReport, type TargetId } from '@/types/contracts';

// ------------------------------------------------------------------------ metrics_summary.json

interface SummaryValue {
  value: number;
  ci?: [number, number] | null;
}
interface SummaryCv {
  mean: number;
  std: number;
}
interface SummaryDistribution {
  mean?: number;
  sd?: number;
  p05?: number;
  p50?: number;
  p95?: number;
}

/** Shape of `metrics_summary.json` (format "cardiotwin-metrics-summary" 1.x); every field optional-safe. */
export interface MetricsSummaryFile {
  format?: string;
  format_version?: string;
  model_version?: string;
  dataset: { name?: string; n: number; n_dev?: number; n_test: number; prevalence?: Partial<Record<string, number>> };
  protocol?: { test?: string; cv?: string };
  targets: Record<
    string,
    {
      label?: string;
      threshold?: number;
      test?: Partial<Record<string, SummaryValue>>;
      cv?: Partial<Record<string, SummaryCv>>;
      robustness?: { n_splits?: number; fixed_split_percentile?: number; roc_auc?: SummaryDistribution };
      [extra: string]: unknown;
    }
  >;
  headline?: { robustness?: { text?: string; n_splits?: number }; modality?: { text?: string }; [extra: string]: unknown };
  [extra: string]: unknown;
}

// ------------------------------------------------------------------------------ landing model

export interface MetricCi {
  value: number;
  ci: [number, number] | null;
}

export interface TargetPerformance {
  id: TargetId;
  /** Human label, e.g. "Coronary artery disease". */
  label: string;
  /** Held-out test ROC-AUC with its 95 % bootstrap CI. */
  testAuc: MetricCi | null;
  /** Development cross-validation ROC-AUC, mean ± sd over outer folds. */
  cvAuc: { mean: number; std: number } | null;
  /** Test sensitivity / specificity at the deployed threshold (the ROC operating point). */
  sensitivity: number | null;
  specificity: number | null;
  threshold: number | null;
  /**
   * The pre-specified bedside baseline (5 inputs: age, sex, typical angina, diabetes, hypertension) on the
   * same held-out patients, so the landing can say up front how much the full panel adds.
   */
  bedside: { features: string[]; testAuc: MetricCi | null } | null;
  /** Repeated random re-split distribution of held-out ROC-AUC, when the ML analysis produced it. */
  robustness: {
    median: number;
    p05: number | null;
    p95: number | null;
    nSplits: number | null;
    /** Where the locked test split ranks among the re-splits (0–100). */
    percentile: number | null;
  } | null;
}

export interface LandingMetrics {
  source: 'summary' | 'metrics';
  modelVersion: string | null;
  n: number;
  nDev: number | null;
  nTest: number;
  /** Plain-language protocol sentences (tooltips). */
  protocol: { test: string | null; cv: string | null };
  /** Contract order: CAD · LAD · LCX · RCA, then any added targets. */
  targets: TargetPerformance[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const orderIds = (ids: string[]): string[] => {
  const rank = (id: string) => {
    const i = (TARGET_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? TARGET_ORDER.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
};

const toCi = (m: SummaryValue | { value: number; ci?: [number, number] | null } | undefined): MetricCi | null =>
  m && isNum(m.value)
    ? { value: m.value, ci: m.ci && isNum(m.ci[0]) && isNum(m.ci[1]) ? [m.ci[0], m.ci[1]] : null }
    : null;

const toCv = (m: { mean: number; std: number } | undefined) =>
  m && isNum(m.mean) ? { mean: m.mean, std: isNum(m.std) ? m.std : 0 } : null;

const valueOf = (m: { value: number } | undefined): number | null => (m && isNum(m.value) ? m.value : null);

/** `targets.<t>.baseline` in either artifact: summary (`test_roc_auc`) or full report (`test.roc_auc`). */
function bedsideOf(raw: unknown): TargetPerformance['bedside'] {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as { features?: unknown; test_roc_auc?: SummaryValue; test?: { roc_auc?: SummaryValue } };
  const testAuc = toCi(b.test_roc_auc ?? b.test?.roc_auc);
  if (!testAuc) return null;
  const features = Array.isArray(b.features) ? b.features.filter((f): f is string => typeof f === 'string') : [];
  return { features, testAuc };
}

/**
 * Repairs UTF-8 text that a producer decoded as Windows-1252 and re-encoded ("Â±" for "±", "â€“" for
 * "–"), so prose from the artifacts never shows mojibake. Clean strings pass through unchanged.
 */
export function repairText(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/Â±/g, '±')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/Ã—/g, '×')
    .replace(/â‰¥/g, '≥')
    .replace(/â‰¤/g, '≤')
    .replace(/\u00c2\u00a0/g, '\u00a0')
    .replace(/\u00e2\u20ac\u2030/g, '\u2009');
}

/** Normalise `metrics_summary.json`. Throws on a file that is not a summary (caller falls back). */
export function fromSummary(s: MetricsSummaryFile, labels: Partial<Record<string, string>> = {}): LandingMetrics {
  if (!s || typeof s !== 'object' || !s.dataset || !isNum(s.dataset.n) || !s.targets) {
    throw new Error('metrics_summary.json has an unexpected shape');
  }
  const targets = orderIds(Object.keys(s.targets)).map((id): TargetPerformance => {
    const t = s.targets[id]!;
    const rob = t.robustness?.roc_auc;
    return {
      id,
      label: t.label ?? labels[id] ?? id,
      testAuc: toCi(t.test?.roc_auc),
      cvAuc: toCv(t.cv?.roc_auc),
      sensitivity: valueOf(t.test?.recall),
      specificity: valueOf(t.test?.specificity),
      threshold: isNum(t.threshold) ? t.threshold : null,
      bedside: bedsideOf(t.baseline),
      robustness:
        rob && isNum(rob.p50)
          ? {
              median: rob.p50,
              p05: isNum(rob.p05) ? rob.p05 : null,
              p95: isNum(rob.p95) ? rob.p95 : null,
              nSplits: isNum(t.robustness?.n_splits) ? (t.robustness?.n_splits ?? null) : null,
              percentile: isNum(t.robustness?.fixed_split_percentile) ? (t.robustness?.fixed_split_percentile ?? null) : null,
            }
          : null,
    };
  });
  return {
    source: 'summary',
    modelVersion: s.model_version ?? null,
    n: s.dataset.n,
    nDev: isNum(s.dataset.n_dev) ? s.dataset.n_dev : null,
    nTest: s.dataset.n_test,
    protocol: { test: repairText(s.protocol?.test), cv: repairText(s.protocol?.cv) },
    targets,
  };
}

/** Normalise the full `metrics.json` (fallback when the summary is absent). */
export function fromMetricsReport(m: MetricsReport, labels: Partial<Record<string, string>> = {}): LandingMetrics {
  const raw = m as MetricsReport & { model_version?: string };
  const robustness = (
    m as unknown as {
      robustness?: Record<string, { n_splits?: number; fixed_split_percentile?: number; roc_auc?: SummaryDistribution }>;
    }
  ).robustness;
  const targets = orderIds(Object.keys(m.targets)).map((id): TargetPerformance => {
    const t = m.targets[id]!;
    const rob = robustness?.[id];
    return {
      id,
      label: labels[id] ?? id,
      testAuc: toCi(t.test.roc_auc),
      cvAuc: toCv(t.cv.roc_auc),
      sensitivity: valueOf(t.test.recall),
      specificity: valueOf(t.test.specificity),
      threshold: isNum(t.threshold) ? t.threshold : null,
      bedside: bedsideOf((t as unknown as { baseline?: unknown }).baseline),
      robustness:
        rob?.roc_auc && isNum(rob.roc_auc.p50)
          ? {
              median: rob.roc_auc.p50,
              p05: isNum(rob.roc_auc.p05) ? rob.roc_auc.p05 : null,
              p95: isNum(rob.roc_auc.p95) ? rob.roc_auc.p95 : null,
              nSplits: isNum(rob.n_splits) ? rob.n_splits : null,
              percentile: isNum(rob.fixed_split_percentile) ? rob.fixed_split_percentile : null,
            }
          : null,
    };
  });
  const p = m.protocol;
  const cvSentence =
    isNum(p.cv_splits) && isNum(p.cv_repeats)
      ? `development set, repeated stratified ${p.cv_splits}-fold × ${p.cv_repeats}, cross-fitted ensemble (mean ± sd over folds)`
      : null;
  const testSentence = isNum(p.n_bootstrap)
    ? `locked test set of ${m.dataset.n_test} patients, 95 % CIs from ${p.n_bootstrap} stratified bootstrap resamples`
    : null;
  return {
    source: 'metrics',
    modelVersion: raw.model_version ?? null,
    n: m.dataset.n,
    nDev: isNum(m.dataset.n_dev) ? m.dataset.n_dev : null,
    nTest: m.dataset.n_test,
    protocol: { test: testSentence, cv: cvSentence },
    targets,
  };
}

/** The target's performance entry, or null. */
export const performanceFor = (lm: LandingMetrics | null | undefined, id: TargetId): TargetPerformance | null =>
  lm?.targets.find((t) => t.id === id) ?? null;

// ------------------------------------------------------------------------------ text

const PM = '±';

/** "0.94 ± 0.03" */
export const formatCv = (cv: { mean: number; std: number } | null | undefined): string =>
  cv ? `${formatMetricValue(cv.mean)}${THIN_SPACE}${PM}${THIN_SPACE}${formatMetricValue(cv.std)}` : EN_DASH;

/**
 * How much the full panel adds over the bedside baseline, said before a judge finds it on Model performance:
 * "A 5-input bedside baseline (age, sex, typical angina, diabetes, hypertension) scores 0.82 on the same
 * held-out patients; ECG, laboratory and echocardiography take it to 0.86."
 */
export function bedsideSentence(t: TargetPerformance | null, nameOf: (key: string) => string): string | null {
  const b = t?.bedside;
  if (!b?.testAuc || !t?.testAuc) return null;
  const names = b.features.map((k) => nameOf(k).toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return (
    `A ${b.features.length || 'few'}-input bedside baseline${list ? ` (${list})` : ''} scores ` +
    `${formatMetricValue(b.testAuc.value)} on the same held-out patients; ECG, laboratory and echocardiography ` +
    `take it to ${formatMetricValue(t.testAuc.value)}.`
  );
}

/**
 * One honest sentence reconciling test and CV (V2 §6.4 rule 2): the held-out value, its CI, the CV
 * value, and whether the CI contains it.
 */
export function reconcileTestAndCv(t: TargetPerformance | null, nTest: number | null): string | null {
  if (!t?.testAuc || !t.cvAuc) return null;
  const test = formatMetricValue(t.testAuc.value);
  const ci = t.testAuc.ci;
  const cv = formatCv(t.cvAuc);
  const n = nTest ? `n${THIN_SPACE}=${THIN_SPACE}${nTest}, ` : '';
  const ciText = ci ? `CI ${formatMetricValue(ci[0])}${EN_DASH}${formatMetricValue(ci[1])}` : 'no CI';
  const relation = t.testAuc.value < t.cvAuc.mean ? 'below' : t.testAuc.value > t.cvAuc.mean ? 'above' : 'equal to';
  const contains = ci ? ci[0] <= t.cvAuc.mean && t.cvAuc.mean <= ci[1] : false;
  const r = t.robustness;
  const resplits =
    r && r.nSplits
      ? ` Across ${r.nSplits} random re-splits the median held-out ROC-AUC is ${formatMetricValue(r.median)}` +
        (r.p05 !== null && r.p95 !== null
          ? ` (90${THIN_SPACE}% of splits ${formatMetricValue(r.p05)}${EN_DASH}${formatMetricValue(r.p95)})`
          : '') +
        (r.percentile !== null ? `; this locked split ranks at the ${ordinal(Math.round(r.percentile))} percentile.` : '.')
      : '';
  return (
    `Test ROC-AUC ${test} (${n}${ciText}) is ${relation} cross-validation (${cv}). ` +
    (contains
      ? 'That is expected with a small held-out set, and the CI includes the CV value.'
      : 'The CI does not include the CV value, so read the test estimate as the more conservative one.') +
    resplits
  );
}

/** 1 → "1st", 3 → "3rd", 12 → "12th", 58 → "58th". */
export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const teen = v % 100 >= 11 && v % 100 <= 13;
  const suffix = teen ? 'th' : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

// ------------------------------------------------------------------------------ ROC thumbnail

export interface RocThumbnail {
  /** [fpr, tpr] pairs, sorted by fpr, anchored at (0,0) and (1,1). */
  points: [number, number][];
  /** Deployed operating point (1 − specificity, sensitivity) on the test set, when known. */
  operating: [number, number] | null;
}

/** ROC curve points for the Validate pillar thumbnail (no numbers are ever drawn on it). */
export function rocThumbnail(m: MetricsReport | null | undefined, target: TargetId = 'CAD'): RocThumbnail | null {
  const t = m?.targets[target];
  const roc = t?.curves?.roc;
  if (!roc || !Array.isArray(roc.fpr) || roc.fpr.length !== roc.tpr.length || roc.fpr.length < 2) return null;
  const pts = roc.fpr
    .map((x, i) => [x, roc.tpr[i]!] as [number, number])
    .filter(([x, y]) => isNum(x) && isNum(y))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts[0]![0] !== 0 || pts[0]![1] !== 0) pts.unshift([0, 0]);
  const last = pts[pts.length - 1]!;
  if (last[0] !== 1 || last[1] !== 1) pts.push([1, 1]);
  const sens = valueOf(t.test.recall);
  const spec = valueOf(t.test.specificity);
  return { points: pts, operating: sens !== null && spec !== null ? [1 - spec, sens] : null };
}

// ------------------------------------------------------------------------------ loaders

export const METRICS_SUMMARY_PATH = `${MODEL_DIR}/metrics_summary.json`;

/** Summary first (small), full report as a fallback. Memoised for the session. */
export const landingMetricsResource = memoize<LandingMetrics>(async () => {
  try {
    return fromSummary(await fetchStaticJson<MetricsSummaryFile>(METRICS_SUMMARY_PATH));
  } catch (error) {
    // A missing or malformed summary is expected while ml/ has not produced it yet.
    if (!(error instanceof MissingAssetError) && !(error instanceof Error && /unexpected shape/.test(error.message))) {
      throw error;
    }
    return fromMetricsReport(await metricsResource.get());
  }
});

export const useLandingMetrics = () => useResource(landingMetricsResource);
