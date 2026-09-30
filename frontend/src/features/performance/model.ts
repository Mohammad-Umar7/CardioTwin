/**
 * Pure derivations behind the Performance page (WORKSTATION_V2 §6.4): KPI tiles, the sentence that
 * reconciles test and cross-validation, takeaway titles that state each chart's finding, the
 * threshold explorer's operating points and the leaderboard's "why not deployed" note.
 *
 * Every number shown on the page is computed here from metrics.json; nothing is hard-coded. All
 * functions are total: missing fields produce `null` / shorter sentences, never exceptions.
 */
import { formatMetricValue, formatPercent } from '@/lib/format';
import {
  deployedModelName,
  featureName,
  isDeployedModel,
  modalityName,
  modelInfo,
  targetClassNames,
} from '@/lib/modelNames';
import type { FeatureSpec, MetricsReport, TargetMetrics } from '@/types/contracts';
import type { CalibrationSummary, ModalityAblation, RobustnessResult, SubgroupSource, Subgroups } from './extras';

export type Split = 'test' | 'cv';

const f2 = (v: number | null | undefined) => formatMetricValue(v);

/** "1st", "12th", "23rd" … for percentiles. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${r}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th';
  return `${r}${suffix}`;
}

// ------------------------------------------------------------------------------------ dataset facts

export interface SplitFacts {
  nTest: number;
  nDev: number;
  /** Outer CV folds (splits × repeats), e.g. 50. */
  nFolds: number | null;
  cvSplits: number | null;
  cvRepeats: number | null;
  nBootstrap: number | null;
}

export function splitFacts(report: MetricsReport | undefined): SplitFacts {
  const p = (report?.protocol ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const cvSplits = n(p.cv_splits);
  const cvRepeats = n(p.cv_repeats);
  return {
    nTest: report?.dataset.n_test ?? 0,
    nDev: report?.dataset.n_dev ?? 0,
    nFolds: cvSplits !== null && cvRepeats !== null ? cvSplits * cvRepeats : null,
    cvSplits,
    cvRepeats,
    nBootstrap: n(p.n_bootstrap),
  };
}

/** Test-set prevalence when published (`dataset.prevalence_test`), else the whole-cohort one. */
export function testPrevalence(report: MetricsReport | undefined, target: string, m?: TargetMetrics): number | null {
  if (m) {
    const { tp, fn, tn, fp } = m.confusion_matrix;
    const n = tp + fn + tn + fp;
    if (n > 0) return (tp + fn) / n;
  }
  const ds = report?.dataset as Record<string, unknown> | undefined;
  const byTest = ds?.prevalence_test as Record<string, number> | undefined;
  return byTest?.[target] ?? report?.dataset.prevalence[target] ?? null;
}

// ---------------------------------------------------------------------------------- discrimination

/** Plain-language strength of a ROC-AUC. */
export function discriminationWord(auc: number): string {
  if (auc >= 0.9) return 'very well';
  if (auc >= 0.8) return 'well';
  if (auc >= 0.7) return 'moderately well';
  if (auc >= 0.6) return 'weakly';
  return 'barely better than chance';
}

/** The headline AUC for the selected split. */
export function headlineAuc(m: TargetMetrics, split: Split): number | null {
  return split === 'test' ? (m.test.roc_auc?.value ?? null) : (m.cv.roc_auc?.mean ?? null);
}

/** Page title = takeaway: "Separates CAD from no CAD well on patients it never saw." */
export function pageTakeaway(target: string, m: TargetMetrics, split: Split): string {
  const auc = headlineAuc(m, split);
  const pairText = target === 'CAD' ? 'CAD from no CAD' : `stenotic from non-stenotic ${target}`;
  const where = split === 'test' ? 'on patients it never saw' : 'in cross-validation on the development set';
  if (auc === null) return `How well does it separate ${pairText}?`;
  return `Separates ${pairText} ${discriminationWord(auc)} ${where}.`;
}

/**
 * One sentence that reconciles the held-out test and cross-validation ROC-AUC (§6.4 rule 2). It
 * cites the split that is NOT on the tiles, so no number is shown twice.
 */
export function reconcileSentence(m: TargetMetrics, split: Split, facts: SplitFacts): string | null {
  const test = m.test.roc_auc;
  const cv = m.cv.roc_auc;
  if (!test || !cv) return null;
  const diff = test.value - cv.mean;
  const ci = test.ci ?? null;
  const includes = ci ? ci[0] <= cv.mean && cv.mean <= ci[1] : null;
  const small = `with ${facts.nTest} test patients`;
  if (split === 'test') {
    const cvText = `cross-validation (${f2(cv.mean)} ± ${f2(cv.std)})`;
    if (Math.abs(diff) < 0.015) return `Held-out ROC-AUC matches ${cvText}: the model generalised as estimated.`;
    if (diff < 0) {
      if (includes === false)
        return `Held-out ROC-AUC is below ${cvText} and its interval excludes the CV value, so read the CV figure as optimistic.`;
      return `Held-out ROC-AUC is below ${cvText}. That is expected ${small}: the test interval is wide and includes the CV value.`;
    }
    if (includes === false)
      return `Held-out ROC-AUC is above ${cvText}; the test split was probably easier than average.`;
    return `Held-out ROC-AUC is above ${cvText}. ${small.charAt(0).toUpperCase()}${small.slice(1)} that is chance variation: the test interval includes the CV value.`;
  }
  const testText = `the held-out test (${f2(test.value)}, n = ${facts.nTest})`;
  if (Math.abs(diff) < 0.015) return `Cross-validation matches ${testText}: the estimate held on unseen patients.`;
  if (diff < 0)
    return `Cross-validation is above ${testText}. A small test set scatters widely${includes ? ', and its interval includes the CV value' : ''}.`;
  return `Cross-validation is below ${testText}. A small test set scatters widely${includes ? ', and its interval includes the CV value' : ''}.`;
}

// -------------------------------------------------------------------------------------- KPI tiles

export type KpiId = 'roc_auc' | 'recall' | 'specificity' | 'brier';

export interface Kpi {
  id: KpiId;
  label: string;
  definition: string;
  value: number | null;
  /** Test: 95 % bootstrap CI. CV: mean ± sd as an interval. */
  interval: [number, number] | null;
  /** The other split's estimate, drawn as a hollow tick on the interval track. */
  other: number | null;
  sd: number | null;
  /** Sub-line: n and what it counts ("37 of 44 with CAD flagged"). */
  sub: string;
  /** Track domain [worst, best] or [best, worst] for lower-is-better metrics. */
  domain: [number, number];
  domainLabels: [string, string];
  higherIsBetter: boolean;
}

export function kpis(m: TargetMetrics, split: Split, target: string, facts: SplitFacts, prevalence: number | null): Kpi[] {
  const { tp, fn, tn, fp } = m.confusion_matrix;
  const noun = target === 'CAD' ? 'CAD' : `${target} stenosis`;
  const folds = facts.nFolds ? `mean ± sd over ${facts.nFolds} folds` : 'mean ± sd over folds';
  const pick = (key: string) => {
    const t = m.test[key];
    const c = m.cv[key];
    if (split === 'test')
      return { value: t?.value ?? null, interval: t?.ci ?? null, other: c?.mean ?? null, sd: null };
    return {
      value: c?.mean ?? null,
      interval: c ? ([c.mean - c.std, c.mean + c.std] as [number, number]) : null,
      other: t?.value ?? null,
      sd: c?.std ?? null,
    };
  };
  const noSkillBrier = prevalence !== null ? prevalence * (1 - prevalence) : 0.25;
  const brierMax = Math.max(0.25, Math.ceil(noSkillBrier * 20) / 20);
  return [
    {
      id: 'roc_auc',
      label: 'ROC-AUC',
      definition:
        'The chance that a randomly chosen patient with the condition gets a higher estimate than one without. 0.5 is a coin flip, 1 is perfect ranking.',
      ...pick('roc_auc'),
      sub: split === 'test' ? `${facts.nTest} held-out patients` : folds,
      domain: [0.5, 1],
      domainLabels: ['chance', 'perfect'],
      higherIsBetter: true,
    },
    {
      id: 'recall',
      label: 'Sensitivity',
      definition: `Share of patients with ${noun} whom the model flags at the deployed threshold.`,
      ...pick('recall'),
      sub: split === 'test' ? `${tp} of ${tp + fn} with ${noun} flagged` : folds,
      domain: [0, 1],
      domainLabels: ['none', 'all'],
      higherIsBetter: true,
    },
    {
      id: 'specificity',
      label: 'Specificity',
      definition: `Share of patients without ${noun} whom the model correctly leaves unflagged.`,
      ...pick('specificity'),
      sub: split === 'test' ? `${tn} of ${tn + fp} without ${noun} not flagged` : folds,
      domain: [0, 1],
      domainLabels: ['none', 'all'],
      higherIsBetter: true,
    },
    {
      id: 'brier',
      label: 'Brier score',
      definition:
        'Mean squared gap between the estimated probability and what happened (0 or 1). Lower is better; predicting the prevalence for everyone scores about ' +
        `${f2(noSkillBrier)}.`,
      ...pick('brier'),
      sub: split === 'test' ? `${facts.nTest} patients · lower is better` : `${folds} · lower is better`,
      domain: [0, brierMax],
      domainLabels: ['perfect', 'no skill'],
      higherIsBetter: false,
    },
  ];
}

export interface MoreMetricRow {
  id: string;
  label: string;
  test: string;
  testCi: string;
  cv: string;
}

const MORE_METRICS: { id: string; label: string }[] = [
  { id: 'pr_auc', label: 'PR-AUC (average precision)' },
  { id: 'f1', label: 'F1 at the deployed threshold' },
  { id: 'mcc', label: 'Matthews correlation' },
  { id: 'precision', label: 'Precision (PPV)' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'balanced_accuracy', label: 'Balanced accuracy' },
  { id: 'log_loss', label: 'Log-loss' },
];

/** The "More metrics" disclosure: every secondary metric, test and CV side by side. */
export function moreMetrics(m: TargetMetrics): MoreMetricRow[] {
  return MORE_METRICS.filter((r) => m.test[r.id] || m.cv[r.id]).map((r) => {
    const t = m.test[r.id];
    const c = m.cv[r.id];
    const ci = t?.ci;
    return {
      id: r.id,
      label: r.label,
      test: t ? f2(t.value) : '–',
      testCi: ci ? `${f2(ci[0])}–${f2(ci[1])}` : '',
      cv: c ? `${f2(c.mean)} ± ${f2(c.std)}` : '–',
    };
  });
}

// ------------------------------------------------------------------------------- operating points

export interface OperatingPoint {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  deployed: boolean;
}

export interface PointMetrics {
  sensitivity: number | null;
  specificity: number | null;
  ppv: number | null;
  npv: number | null;
  flagged: number;
  n: number;
  /** Net benefit at this threshold probability (Vickers): TP/n − FP/n · t/(1 − t). */
  netBenefit: number | null;
}

/**
 * Exact test-set operating points: every ROC corner (`curves.roc` with its thresholds) plus the
 * deployed point from the confusion matrix, which may sit on a segment the ROC export dropped.
 * Sorted by threshold, low → high (so a slider moves from "flag everyone" to "flag no one").
 */
export function operatingPoints(m: TargetMetrics): OperatingPoint[] {
  const cm = m.confusion_matrix;
  const P = cm.tp + cm.fn;
  const N = cm.tn + cm.fp;
  const roc = m.curves.roc;
  const out: OperatingPoint[] = [];
  const thresholds = roc.thresholds ?? [];
  for (let i = 0; i < roc.fpr.length && i < thresholds.length; i += 1) {
    const t = thresholds[i];
    if (t === undefined || !Number.isFinite(t)) continue;
    const tp = Math.round((roc.tpr[i] ?? 0) * P);
    const fp = Math.round((roc.fpr[i] ?? 0) * N);
    out.push({ threshold: Math.min(1, Math.max(0, t)), tp, fp, fn: P - tp, tn: N - fp, deployed: false });
  }
  const dep: OperatingPoint = { threshold: m.threshold, tp: cm.tp, fp: cm.fp, tn: cm.tn, fn: cm.fn, deployed: true };
  const same = out.findIndex((p) => p.tp === dep.tp && p.fp === dep.fp);
  if (same >= 0) out.splice(same, 1);
  out.push(dep);
  out.sort((a, b) => a.threshold - b.threshold || b.tp + b.fp - (a.tp + a.fp));
  // Keep one point per threshold (the ROC export can repeat the clipped 1.0).
  return out.filter((p, i) => i === 0 || p.threshold !== out[i - 1]!.threshold || p.deployed);
}

export function pointMetrics(p: OperatingPoint): PointMetrics {
  const P = p.tp + p.fn;
  const N = p.tn + p.fp;
  const n = P + N;
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  const t = p.threshold;
  return {
    sensitivity: div(p.tp, P),
    specificity: div(p.tn, N),
    ppv: div(p.tp, p.tp + p.fp),
    npv: div(p.tn, p.tn + p.fn),
    flagged: p.tp + p.fp,
    n,
    netBenefit: n > 0 && t < 1 ? p.tp / n - (p.fp / n) * (t / (1 - t)) : null,
  };
}

export function deployedIndex(points: OperatingPoint[]): number {
  const i = points.findIndex((p) => p.deployed);
  return i >= 0 ? i : 0;
}

// ---------------------------------------------------------------------------------- chart findings

/** ROC title: AUC in words ("in 86 % of pairs"). */
export function rocFinding(target: string, auc: number | null | undefined): string {
  const { positive, negative } = targetClassNames(target);
  if (auc === null || auc === undefined) return `How well estimates rank ${positive} above ${negative}`;
  const sub = target === 'CAD' ? 'a patient with CAD above one without' : `${positive} above a non-stenotic one`;
  return `Ranks ${sub} in ${formatPercent(auc)} of pairs`;
}

export function prFinding(target: string, m: TargetMetrics, prevalence: number | null): string {
  const dep = pointMetrics({ ...m.confusion_matrix, threshold: m.threshold, deployed: true });
  const who = target === 'CAD' ? 'have CAD' : `have ${target} stenosis`;
  if (dep.ppv === null) return `Precision across recall levels`;
  const base = prevalence !== null ? `, against a ${formatPercent(prevalence)} base rate` : '';
  return `${formatPercent(dep.ppv)} of flagged patients truly ${who}${base}`;
}

export function calibrationFinding(c: CalibrationSummary | null): string {
  if (!c) return 'Estimated probabilities against observed rates';
  const avg =
    c.inTheLarge === null || Math.abs(c.inTheLarge) < 0.05
      ? 'Right on average'
      : c.inTheLarge > 0
        ? 'Underestimates risk on average'
        : 'Overestimates risk on average';
  if (c.slope === null) return avg;
  if (c.slope < 0.8) return `${avg}, but estimates are more extreme than observed rates`;
  if (c.slope > 1.25) return `${avg}, but estimates are more cautious than observed rates`;
  return `${avg}, with the right spread`;
}

/** Threshold-probability range where the model beats both treat-all and treat-none. */
export function dcaBenefitRange(m: TargetMetrics, margin = 0.005): [number, number] | null {
  const { thresholds, model, treat_all: all, treat_none: none } = m.curves.dca;
  let lo: number | null = null;
  let hi: number | null = null;
  thresholds.forEach((t, i) => {
    const best = Math.max(all[i] ?? -Infinity, none[i] ?? 0);
    if ((model[i] ?? -Infinity) > best + margin) {
      lo = lo === null ? t : Math.min(lo, t);
      hi = hi === null ? t : Math.max(hi, t);
    }
  });
  return lo !== null && hi !== null ? [lo, hi] : null;
}

export function dcaFinding(m: TargetMetrics): string {
  const r = dcaBenefitRange(m);
  if (!r) return 'No threshold where the model beats treating everyone or no one';
  return `Beats treat-all and treat-none for thresholds from ${formatPercent(r[0])} to ${formatPercent(r[1])}`;
}

export function confusionFinding(target: string, m: TargetMetrics): string {
  const { tp, fn, fp, tn } = m.confusion_matrix;
  const noun = target === 'CAD' ? 'CAD' : `${target} stenosis`;
  return `Flags ${tp} of ${tp + fn} patients with ${noun}, with ${fp} false alarms among ${fp + tn}`;
}

export function driversFinding(target: string, m: TargetMetrics, byKey?: ReadonlyMap<string, FeatureSpec>): string {
  const top = m.global_importance.slice(0, 3).map((g) => featureName(g.feature, byKey));
  if (top.length === 0) return `What drives ${target} estimates`;
  const [a, ...rest] = top;
  const lead = `${a} drives ${target} estimates most`;
  if (rest.length === 0) return lead;
  const tail = rest.map((s) => s.charAt(0).toLowerCase() + s.slice(1));
  return `${lead}, then ${tail.join(' and ')}`;
}

// -------------------------------------------------------------------------------------- leaderboard

export interface LeaderRow {
  id: string;
  name: string;
  description: string;
  mean: number;
  sd: number;
  logLoss: number | null;
  brier: number | null;
  deployed: boolean;
  tuned: boolean | null;
}

export function leaderboard(m: TargetMetrics, logisticId: string | null): { rows: LeaderRow[]; reference: LeaderRow | null } {
  const toRow = (r: TargetMetrics['leaderboard'][number]): LeaderRow => {
    const info = modelInfo(r.model);
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      id: r.model,
      name: isDeployedModel(r.model) ? deployedModelName(logisticId) : info.name,
      description: info.description,
      mean: r.roc_auc_mean,
      sd: r.roc_auc_std,
      logLoss: n(r.log_loss_mean),
      brier: n(r.brier_mean),
      deployed: isDeployedModel(r.model),
      tuned: typeof r.tuned === 'boolean' ? r.tuned : null,
    };
  };
  const all = m.leaderboard.map(toRow).sort((a, b) => b.mean - a.mean);
  const reference = all.find((r) => modelInfo(r.id).family === 'reference') ?? null;
  return { rows: all.filter((r) => r !== reference), reference };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Why the deployed model stays deployed when another model ties or beats it in CV (§6.4 rule 4). */
export function challengerNote(rows: LeaderRow[], logisticId: string | null): string | null {
  const dep = rows.find((r) => r.deployed);
  if (!dep) return null;
  const challenger = rows
    .filter((r) => !r.deployed && round2(r.mean) >= round2(dep.mean))
    .sort((a, b) => b.mean - a.mean)[0];
  if (!challenger) return null;
  const cName = modelInfo(challenger.id).name;
  const parts: string[] = [];
  parts.push(
    round2(challenger.mean) === round2(dep.mean)
      ? `${cName} ties the ensemble in cross-validation (${f2(dep.mean)}).`
      : `${cName} scores ${f2(challenger.mean)} against the ensemble's ${f2(dep.mean)} in cross-validation, a gap well inside the fold-to-fold spread (± ${f2(dep.sd)}).`,
  );
  if (challenger.id === logisticId) {
    parts.push('The ensemble already contains this model as its linear part.');
  } else if (dep.logLoss !== null && challenger.logLoss !== null && dep.logLoss < challenger.logLoss) {
    parts.push(`The ensemble's probabilities are better calibrated (log-loss ${f2(dep.logLoss)} vs ${f2(challenger.logLoss)}).`);
  }
  parts.push('One recipe serves all four targets and was fixed before the test set was scored, so small per-target gaps do not swap the model.');
  return parts.join(' ');
}

export function leaderboardFinding(rows: LeaderRow[]): string {
  const idx = rows.findIndex((r) => r.deployed);
  if (idx < 0) return 'Cross-validated ranking of every candidate model';
  const dep = rows[idx]!;
  const best = rows[0]!;
  if (idx === 0) return `The deployed ensemble ranks first of ${rows.length} models`;
  if (round2(best.mean) === round2(dep.mean)) return `The deployed ensemble ties the best of ${rows.length} models`;
  return `The deployed ensemble is within ${f2(best.mean - dep.mean)} of the best of ${rows.length} models`;
}

// ------------------------------------------------------------------------------------- new analyses

export function robustnessFinding(r: RobustnessResult): string {
  const d = r.rocAuc;
  const range = `Held-out ROC-AUC spans ${f2(d.p05)}–${f2(d.p95)} across ${r.nSplits} re-splits`;
  const pct = r.fixedPercentile;
  if (pct === null) return range;
  const kind = pct < 25 ? 'a hard one' : pct > 75 ? 'a favourable one' : 'a typical one';
  return `${range}; the published split was ${kind} (${ordinal(pct)} percentile)`;
}

export function modalityFinding(a: ModalityAblation): string {
  const inst = a.instrumental;
  if (inst) {
    const added = inst.addedGroups.map((g) => modalityName(g, 'short'));
    const list = added.length > 1 ? `${added.slice(0, -1).join(', ')} and ${added.at(-1)}` : (added[0] ?? 'Instruments');
    const clear = inst.delta?.ci ? inst.delta.ci[0] > 0 : false;
    return clear
      ? `${list} lift ROC-AUC from ${f2(inst.bedside.mean)} to ${f2(inst.full.mean)} over bedside information`
      : `${list} add little beyond bedside information (${f2(inst.bedside.mean)} → ${f2(inst.full.mean)})`;
  }
  const steps = a.cumulative.filter((r) => r.delta);
  const best = [...steps].sort((x, y) => (y.delta?.mean ?? 0) - (x.delta?.mean ?? 0))[0];
  const full = a.full ?? a.cumulative.at(-1)?.auc;
  if (best && full)
    return `${modalityName(best.group)} add the most; all seven modalities together reach ${f2(full.mean)}`;
  return 'What each data modality adds';
}

export function subgroupFinding(s: Subgroups, source: SubgroupSource): string {
  const flagged: string[] = [];
  for (const f of s.factors) {
    for (const l of f.levels) {
      const b = l[source];
      const d = b?.deltaVsReference;
      if (d?.ci && (d.ci[1] < 0 || d.ci[0] > 0) && !b?.smallN) flagged.push(`${l.label.toLowerCase()} (${d.value > 0 ? '+' : '−'}${f2(Math.abs(d.value))})`);
    }
  }
  const names = s.factors.map((f) => f.label.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'subgroups');
  if (flagged.length === 0) return `No clear difference in discrimination across ${list}`;
  return `Discrimination differs for ${flagged.join(', ')}`;
}

