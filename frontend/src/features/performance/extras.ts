/**
 * Runtime readers for the additive parts of metrics.json (docs/CONTRACTS.md §4 extras and §7.2).
 *
 * `types/contracts.ts` only types the v1.0 core. Everything read here is optional and may appear
 * (or change shape) while the ML pipeline evolves, so each reader takes `unknown`, validates what it
 * needs and returns `null` instead of throwing. A section whose reader returns null is not rendered.
 */
import type { MetricsReport, TargetMetrics } from '@/types/contracts';

// ------------------------------------------------------------------------------ narrowing helpers

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const pair = (v: unknown): [number, number] | null => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  return a === null || b === null ? null : [a, b];
};
const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null) : [];
const bool = (v: unknown): boolean => v === true;

// ------------------------------------------------------------------------ per-target v1.1 extras

export interface CalibrationSummary {
  ece: number | null;
  /** Observed minus predicted mean (0 = right on average). */
  inTheLarge: number | null;
  /** 1 = right spread; < 1 = too extreme; > 1 = too cautious. */
  slope: number | null;
}

export function readCalibrationSummary(m: TargetMetrics | undefined): CalibrationSummary | null {
  const raw = (m as unknown as Rec | undefined)?.calibration_summary;
  if (!isRec(raw)) return null;
  const out = {
    ece: num(raw.ece),
    inTheLarge: num(raw.calibration_in_the_large),
    slope: num(raw.calibration_slope),
  };
  return out.ece === null && out.inTheLarge === null && out.slope === null ? null : out;
}

export interface DeployedComponents {
  logisticId: string | null;
  logisticWeight: number | null;
  treeWeight: number | null;
  nTrees: number | null;
  platt: { a: number; b: number } | null;
}

export function readComponents(m: TargetMetrics | undefined): DeployedComponents | null {
  const raw = (m as unknown as Rec | undefined)?.components;
  if (!isRec(raw)) return null;
  const lr = isRec(raw.logistic) ? raw.logistic : {};
  const xgb = isRec(raw.xgboost) ? raw.xgboost : {};
  const platt = isRec(raw.platt) ? raw.platt : null;
  const a = num(platt?.a);
  const b = num(platt?.b);
  return {
    logisticId: str(lr.name),
    logisticWeight: num(lr.weight),
    treeWeight: num(xgb.weight),
    nTrees: num(xgb.n_trees),
    platt: a !== null && b !== null ? { a, b } : null,
  };
}

export interface MetricCi {
  value: number;
  ci: [number, number] | null;
}

export interface BaselineResult {
  features: string[];
  testAuc: MetricCi | null;
  cvAuc: { mean: number; std: number } | null;
}

/** The pre-specified clinical baseline (`targets.<t>.baseline`). */
export function readBaseline(m: TargetMetrics | undefined): BaselineResult | null {
  const raw = (m as unknown as Rec | undefined)?.baseline;
  if (!isRec(raw)) return null;
  const test = isRec(raw.test) && isRec(raw.test.roc_auc) ? raw.test.roc_auc : null;
  const cv = isRec(raw.cv) && isRec(raw.cv.roc_auc) ? raw.cv.roc_auc : null;
  const testValue = num(test?.value);
  const cvMean = num(cv?.mean);
  const cvStd = num(cv?.std);
  const features = Array.isArray(raw.features)
    ? raw.features.filter((f): f is string => typeof f === 'string')
    : [];
  if (testValue === null && cvMean === null) return null;
  return {
    features,
    testAuc: testValue === null ? null : { value: testValue, ci: pair(test?.ci) },
    cvAuc: cvMean === null ? null : { mean: cvMean, std: cvStd ?? 0 },
  };
}

// ------------------------------------------------------------------------------------ robustness

export interface Distribution {
  n: number;
  mean: number;
  sd: number;
  p05: number;
  p25: number | null;
  p50: number;
  p75: number | null;
  p95: number;
  min: number | null;
  max: number | null;
  /** Value on the locked (published) split. */
  fixed: number | null;
  /** Mid-rank percentile of the locked split in the distribution (0–100). */
  fixedPercentile: number | null;
}

function readDistribution(v: unknown): Distribution | null {
  if (!isRec(v)) return null;
  const mean = num(v.mean);
  const p05 = num(v.p05);
  const p50 = num(v.p50);
  const p95 = num(v.p95);
  if (mean === null || p05 === null || p50 === null || p95 === null) return null;
  return {
    n: num(v.n) ?? 0,
    mean,
    sd: num(v.sd) ?? 0,
    p05,
    p25: num(v.p25),
    p50,
    p75: num(v.p75),
    p95,
    min: num(v.min),
    max: num(v.max),
    fixed: num(v.fixed_split),
    fixedPercentile: num(v.fixed_split_percentile),
  };
}

export interface RobustnessResult {
  nSplits: number;
  rocAuc: Distribution;
  f1: Distribution | null;
  sensitivity: Distribution | null;
  specificity: Distribution | null;
  brier: Distribution | null;
  /** Percentile of the locked split's ROC-AUC (top-level copy). */
  fixedPercentile: number | null;
  baselineRocAuc: Distribution | null;
  /** Full panel minus clinical baseline, per split; `sharePositive` = fraction of splits where the panel wins. */
  deltaVsBaseline: (Distribution & { sharePositive: number | null }) | null;
  cvEstimate: { rocAuc: number; percentile: number | null } | null;
  /** Per-split ROC-AUC values (for the strip plot); empty when not exported. */
  samples: number[];
}

export function readRobustness(report: MetricsReport | undefined, target: string): RobustnessResult | null {
  const all = (report as unknown as Rec | undefined)?.robustness;
  if (!isRec(all) || !isRec(all[target])) return null;
  const t = all[target] as Rec;
  const rocAuc = readDistribution(t.roc_auc);
  if (!rocAuc) return null;
  const delta = readDistribution(t.delta_roc_auc_vs_baseline);
  const cv = isRec(t.cv_estimate) ? t.cv_estimate : null;
  const cvAuc = num(cv?.roc_auc);
  const samples = isRec(t.samples) ? nums(t.samples.roc_auc) : [];
  return {
    nSplits: num(t.n_splits) ?? rocAuc.n ?? samples.length,
    rocAuc,
    f1: readDistribution(t.f1),
    sensitivity: readDistribution(t.recall),
    specificity: readDistribution(t.specificity),
    brier: readDistribution(t.brier),
    fixedPercentile: num(t.fixed_split_percentile) ?? rocAuc.fixedPercentile,
    baselineRocAuc: readDistribution(t.baseline_roc_auc),
    deltaVsBaseline: delta
      ? { ...delta, sharePositive: num((t.delta_roc_auc_vs_baseline as Rec).share_positive) }
      : null,
    cvEstimate: cvAuc === null ? null : { rocAuc: cvAuc, percentile: num(cv?.percentile) },
    samples,
  };
}

// ------------------------------------------------------------------------------- modality ablation

export interface AucInterval {
  mean: number;
  ci: [number, number] | null;
  sd: number | null;
}

export interface DeltaInterval {
  mean: number;
  ci: [number, number] | null;
  /** Holm-adjusted p-value when present, else the raw one. */
  p: number | null;
  shareFoldsImproved: number | null;
}

export interface ModalityRow {
  /** Modality id (schema group): the one added (cumulative), removed (leave-one-out) or used alone. */
  group: string;
  groups: string[];
  nColumns: number | null;
  auc: AucInterval;
  delta: DeltaInterval | null;
}

export interface ModalityAblation {
  full: AucInterval | null;
  cumulative: ModalityRow[];
  leaveOneOut: ModalityRow[];
  single: ModalityRow[];
  instrumental: {
    bedsideGroups: string[];
    addedGroups: string[];
    bedside: AucInterval;
    full: AucInterval;
    delta: DeltaInterval | null;
  } | null;
}

function readAuc(v: unknown): AucInterval | null {
  if (!isRec(v)) return null;
  const mean = num(v.mean);
  return mean === null ? null : { mean, ci: pair(v.ci), sd: num(v.sd) };
}

function readDelta(v: unknown): DeltaInterval | null {
  if (!isRec(v)) return null;
  const mean = num(v.mean);
  if (mean === null) return null;
  return {
    mean,
    ci: pair(v.ci),
    p: num(v.p_holm) ?? num(v.p_value),
    shareFoldsImproved: num(v.share_folds_improved),
  };
}

function readModalityRows(v: unknown, deltaKey: 'delta_vs_previous' | 'delta_vs_full' | null): ModalityRow[] {
  if (!Array.isArray(v)) return [];
  const rows: ModalityRow[] = [];
  for (const r of v) {
    if (!isRec(r)) continue;
    const group = str(r.group);
    const auc = readAuc(r.roc_auc);
    if (!group || !auc) continue;
    rows.push({
      group,
      groups: Array.isArray(r.groups) ? r.groups.filter((g): g is string => typeof g === 'string') : [group],
      nColumns: num(r.n_columns),
      auc,
      delta: deltaKey ? readDelta(r[deltaKey]) : null,
    });
  }
  return rows;
}

export function readModalityAblation(
  report: MetricsReport | undefined,
  target: string,
): ModalityAblation | null {
  const all = (report as unknown as Rec | undefined)?.modality_ablation;
  if (!isRec(all) || !isRec(all[target])) return null;
  const t = all[target] as Rec;
  const cumulative = readModalityRows(t.cumulative, 'delta_vs_previous');
  const leaveOneOut = readModalityRows(t.leave_one_out, 'delta_vs_full');
  if (cumulative.length === 0 && leaveOneOut.length === 0) return null;
  const inst = isRec(t.instrumental) ? t.instrumental : null;
  const bedside = readAuc(inst?.bedside_roc_auc);
  const instFull = readAuc(inst?.full_roc_auc);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []);
  return {
    full: isRec(t.full) ? readAuc(t.full.roc_auc) : null,
    cumulative,
    leaveOneOut,
    single: readModalityRows(t.single, null),
    instrumental:
      inst && bedside && instFull
        ? {
            bedsideGroups: strs(inst.bedside_groups),
            addedGroups: strs(inst.added_groups),
            bedside,
            full: instFull,
            delta: readDelta(inst.delta),
          }
        : null,
  };
}

// ------------------------------------------------------------------------------------- subgroups

export type SubgroupSource = 'test' | 'oof';

export interface SubgroupBlock {
  n: number;
  nPos: number | null;
  prevalence: number | null;
  rocAuc: MetricCi | null;
  sensitivity: MetricCi | null;
  specificity: MetricCi | null;
  smallN: boolean;
  deltaVsReference: MetricCi | null;
}

export interface SubgroupLevel {
  id: string;
  label: string;
  test: SubgroupBlock | null;
  oof: SubgroupBlock | null;
}

export interface SubgroupFactor {
  id: string;
  label: string;
  reference: string | null;
  levels: SubgroupLevel[];
}

export interface Subgroups {
  overall: { test: SubgroupBlock | null; oof: SubgroupBlock | null };
  factors: SubgroupFactor[];
}

function readMetricCi(v: unknown): MetricCi | null {
  if (!isRec(v)) return null;
  const value = num(v.value);
  return value === null ? null : { value, ci: pair(v.ci) };
}

function readBlock(v: unknown): SubgroupBlock | null {
  if (!isRec(v)) return null;
  const n = num(v.n);
  if (n === null) return null;
  return {
    n,
    nPos: num(v.n_pos),
    prevalence: num(v.prevalence),
    rocAuc: readMetricCi(v.roc_auc),
    sensitivity: readMetricCi(v.sensitivity),
    specificity: readMetricCi(v.specificity),
    smallN: bool(v.small_n),
    deltaVsReference: readMetricCi(v.delta_roc_auc_vs_reference),
  };
}

export function readSubgroups(report: MetricsReport | undefined, target: string): Subgroups | null {
  const all = (report as unknown as Rec | undefined)?.subgroups;
  if (!isRec(all) || !isRec(all[target])) return null;
  const t = all[target] as Rec;
  const factors: SubgroupFactor[] = [];
  if (isRec(t.factors)) {
    for (const [id, f] of Object.entries(t.factors)) {
      if (!isRec(f) || !Array.isArray(f.levels)) continue;
      const levels: SubgroupLevel[] = [];
      for (const l of f.levels) {
        if (!isRec(l)) continue;
        const lid = str(l.id);
        const label = str(l.label);
        if (!lid || !label) continue;
        levels.push({ id: lid, label, test: readBlock(l.test), oof: readBlock(l.oof) });
      }
      if (levels.length > 0)
        factors.push({ id, label: str(f.label) ?? id, reference: str(f.reference), levels });
    }
  }
  if (factors.length === 0) return null;
  const overall = isRec(t.overall) ? t.overall : {};
  return { overall: { test: readBlock(overall.test), oof: readBlock(overall.oof) }, factors };
}

// ----------------------------------------------------------------------------------- analysis meta

/** `metrics.json → analysis.<key>.method` etc.: plain-text protocol of each descriptive analysis. */
export function readAnalysisNote(
  report: MetricsReport | undefined,
  key: string,
  field = 'method',
): string | null {
  const meta = (report as unknown as Rec | undefined)?.analysis;
  if (!isRec(meta) || !isRec(meta[key])) return null;
  return str((meta[key] as Rec)[field]);
}

export function readAnalysisNumber(
  report: MetricsReport | undefined,
  key: string,
  field: string,
): number | null {
  const meta = (report as unknown as Rec | undefined)?.analysis;
  if (!isRec(meta) || !isRec(meta[key])) return null;
  return num((meta[key] as Rec)[field]);
}
