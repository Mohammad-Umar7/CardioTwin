/**
 * Model performance summary for the report, normalised from either source:
 *   - `model/metrics_summary.json` (format "cardiotwin-metrics-summary", a few kB, written by ml/ with the
 *     artifacts; preferred), or
 *   - `model/metrics.json` (CONTRACTS §4, ~1.4 MB; already loaded by the app shell, so the fallback is free).
 * Both carry the same numbers (the summary is derived from metrics.json and never adds a number), so the
 * report reads identically whichever file is deployed.
 */
import type { MetricsReport, TargetId } from '@/types/contracts';
import { TARGET_ORDER } from '@/types/contracts';
import { fetchStaticJson, memoize, MODEL_DIR } from '@/services/staticData';

// --------------------------------------------------------------------------------- source shapes

interface ValueCi {
  value: number;
  ci?: [number, number] | null;
}
interface MeanSd {
  mean: number;
  std?: number;
  sd?: number;
}

/** The subset of `metrics_summary.json` the report reads (ml/src/cardiotwin_ml/analysis/summary.py). */
export interface MetricsSummaryFile {
  format: 'cardiotwin-metrics-summary' | (string & {});
  format_version?: string;
  model_version?: string;
  metrics_generated_at?: string | null;
  dataset: { name: string; n: number; n_dev: number; n_test: number; prevalence: Partial<Record<TargetId, number>> };
  protocol?: { test?: string; cv?: string };
  targets: Partial<
    Record<
      TargetId,
      {
        label?: string;
        threshold: number;
        test: Partial<Record<string, ValueCi>>;
        cv: Partial<Record<string, MeanSd>>;
        robustness?: { n_splits: number; roc_auc?: { p05?: number; p50?: number; p95?: number } };
      }
    >
  >;
  headline?: { robustness?: { text?: string } };
}

type MetricsWithExtras = MetricsReport & {
  model_version?: string;
  robustness?: Partial<Record<TargetId, { n_splits?: number; roc_auc?: { p05?: number; p50?: number; p95?: number } }>>;
};

// ---------------------------------------------------------------------------------- normalised

export interface MetricCell {
  value: number;
  ci: [number, number] | null;
}

export interface PerformanceRow {
  target: TargetId;
  label: string;
  threshold: number | null;
  auc: MetricCell | null;
  sensitivity: MetricCell | null;
  specificity: MetricCell | null;
  brier: MetricCell | null;
  cvAuc: { mean: number; sd: number | null } | null;
  /** Median held-out ROC-AUC over repeated random re-splits and its 5th–95th percentile range. */
  robustAuc: { p50: number; p05: number | null; p95: number | null; nSplits: number | null } | null;
}

export interface PerformanceSummary {
  source: 'summary' | 'metrics';
  modelVersion: string | null;
  datasetName: string;
  n: number;
  nDev: number;
  nTest: number;
  prevalence: Partial<Record<TargetId, number>>;
  rows: PerformanceRow[];
}

/** Plain-language model name (V2 §5.10): internal ids such as `lr_elasticnet` never reach the page. */
export const MODEL_PLAIN_NAME = 'Logistic regression + gradient-boosted trees, calibrated';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const cell = (m: ValueCi | undefined | null): MetricCell | null =>
  m && isNum(m.value)
    ? { value: m.value, ci: m.ci && isNum(m.ci[0]) && isNum(m.ci[1]) ? [m.ci[0], m.ci[1]] : null }
    : null;

const meanSd = (m: MeanSd | undefined | null) =>
  m && isNum(m.mean) ? { mean: m.mean, sd: isNum(m.std) ? m.std : isNum(m.sd) ? m.sd : null } : null;

const robust = (
  r: { n_splits?: number; roc_auc?: { p05?: number; p50?: number; p95?: number } } | undefined | null,
): PerformanceRow['robustAuc'] =>
  r?.roc_auc && isNum(r.roc_auc.p50)
    ? {
        p50: r.roc_auc.p50,
        p05: isNum(r.roc_auc.p05) ? r.roc_auc.p05 : null,
        p95: isNum(r.roc_auc.p95) ? r.roc_auc.p95 : null,
        nSplits: isNum(r.n_splits) ? r.n_splits : null,
      }
    : null;

const ordered = (ids: string[]) => {
  const rank = (id: string) => {
    const i = (TARGET_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? TARGET_ORDER.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
};

export const isMetricsSummary = (x: unknown): x is MetricsSummaryFile =>
  !!x && typeof x === 'object' && (x as { format?: unknown }).format === 'cardiotwin-metrics-summary';

/**
 * Normalise either file. `labels` (from `schema.targets`) supply human target names when the source has
 * none. Returns null for anything that is neither shape.
 */
export function normalisePerformance(
  source: MetricsSummaryFile | MetricsReport | null | undefined,
  labels: ReadonlyMap<string, string> = new Map(),
): PerformanceSummary | null {
  if (!source || typeof source !== 'object' || !source.dataset || !source.targets) return null;
  const ds = source.dataset;
  if (isMetricsSummary(source)) {
    return {
      source: 'summary',
      modelVersion: source.model_version ?? null,
      datasetName: ds.name,
      n: ds.n,
      nDev: ds.n_dev,
      nTest: ds.n_test,
      prevalence: ds.prevalence ?? {},
      rows: ordered(Object.keys(source.targets)).flatMap((id) => {
        const t = source.targets[id];
        if (!t) return [];
        return [
          {
            target: id,
            label: labels.get(id) ?? t.label ?? id,
            threshold: isNum(t.threshold) ? t.threshold : null,
            auc: cell(t.test?.roc_auc),
            sensitivity: cell(t.test?.recall),
            specificity: cell(t.test?.specificity),
            brier: cell(t.test?.brier),
            cvAuc: meanSd(t.cv?.roc_auc),
            robustAuc: robust(t.robustness),
          },
        ];
      }),
    };
  }
  const m = source as MetricsWithExtras;
  return {
    source: 'metrics',
    modelVersion: m.model_version ?? null,
    datasetName: ds.name,
    n: ds.n,
    nDev: ds.n_dev,
    nTest: ds.n_test,
    prevalence: ds.prevalence ?? {},
    rows: ordered(Object.keys(m.targets)).flatMap((id) => {
      const t = m.targets[id];
      if (!t) return [];
      return [
        {
          target: id,
          label: labels.get(id) ?? id,
          threshold: isNum(t.threshold) ? t.threshold : null,
          auc: cell(t.test?.roc_auc),
          sensitivity: cell(t.test?.recall),
          specificity: cell(t.test?.specificity),
          brier: cell(t.test?.brier),
          cvAuc: meanSd(t.cv?.roc_auc as MeanSd | undefined),
          robustAuc: robust(m.robustness?.[id]),
        },
      ];
    }),
  };
}

// ------------------------------------------------------------------------------------- loader

/** `model/metrics_summary.json`, memoised per session (MissingAssetError when not deployed). */
export const metricsSummaryResource = memoize<MetricsSummaryFile>(() =>
  fetchStaticJson<MetricsSummaryFile>(`${MODEL_DIR}/metrics_summary.json`),
);
