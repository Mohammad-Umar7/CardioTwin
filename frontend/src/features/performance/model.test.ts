import { describe, expect, it } from 'vitest';
import type { TargetMetrics } from '@/types/contracts';
import { readCalibrationSummary, readModalityAblation, readRobustness, readSubgroups } from './extras';
import { cadMetrics, sampleReport } from './fixtures.test-data';
import {
  acrossFinding,
  calibrationFinding,
  challengerNote,
  confusionFinding,
  dcaBenefitRange,
  deployedIndex,
  discriminationWord,
  driversFinding,
  kpis,
  leaderboard,
  leaderboardFinding,
  modalityFinding,
  moreMetrics,
  operatingPoints,
  ordinal,
  pageTakeaway,
  pointMetrics,
  reconcileSentence,
  robustnessAcross,
  robustnessFinding,
  rocFinding,
  splitFacts,
  subgroupFinding,
} from './model';

const facts = splitFacts(sampleReport);

describe('facts and wording', () => {
  it('derives split sizes and fold counts from the protocol', () => {
    expect(facts).toMatchObject({ nTest: 61, nDev: 242, nFolds: 50, nBootstrap: 2000 });
  });

  it('orders percentiles in English', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 12.5].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '13th',
    ]);
  });

  it('grades discrimination in plain words', () => {
    expect(discriminationWord(0.94)).toBe('very well');
    expect(discriminationWord(0.86)).toBe('well');
    expect(discriminationWord(0.74)).toBe('moderately well');
    expect(discriminationWord(0.55)).toBe('barely better than chance');
  });

  it('states the page takeaway per target and split', () => {
    expect(pageTakeaway('CAD', cadMetrics, 'test')).toBe('Separates CAD from no CAD well on patients it never saw.');
    expect(pageTakeaway('LAD', cadMetrics, 'cv')).toBe(
      'Separates stenotic from non-stenotic LAD very well in cross-validation on the development set.',
    );
  });
});

describe('test vs CV reconciliation (§6.4 rule 2)', () => {
  it('explains a lower test AUC whose CI includes the CV mean, citing only the CV number', () => {
    const s = reconcileSentence(cadMetrics, 'test', facts)!;
    expect(s).toContain('below cross-validation (0.94 ± 0.03)');
    expect(s).toContain('small test set');
    expect(s).toContain('includes the CV value');
    expect(s).not.toContain('0.86'); // the test value lives on the ROC-AUC tile
  });

  it('flags an optimistic CV when the test CI excludes it', () => {
    const m = { ...cadMetrics, test: { ...cadMetrics.test, roc_auc: { value: 0.8, ci: [0.7, 0.9] } } } as TargetMetrics;
    expect(reconcileSentence(m, 'test', facts)).toContain('excludes the CV value');
  });

  it('explains a higher test AUC as chance variation', () => {
    const m = { ...cadMetrics, test: { ...cadMetrics.test, roc_auc: { value: 0.81, ci: [0.7, 0.91] } }, cv: { ...cadMetrics.cv, roc_auc: { mean: 0.74, std: 0.05 } } } as TargetMetrics;
    const s = reconcileSentence(m, 'test', facts)!;
    expect(s).toContain('above cross-validation (0.74 ± 0.05)');
    expect(s).toContain('chance variation');
  });

  it('cites the test value when the tiles show CV', () => {
    const s = reconcileSentence(cadMetrics, 'cv', facts)!;
    expect(s).toContain('0.86, n = 61');
    expect(s).not.toContain('0.94');
  });

  it('explains the gap with the Monte-Carlo re-splits when they are published', () => {
    const r = readRobustness(sampleReport, 'CAD')!;
    const s = reconcileSentence(cadMetrics, 'test', facts, r)!;
    expect(s).toBe(
      'Held-out ROC-AUC is below cross-validation (0.94 ± 0.03) because the locked test split is a hard draw: re-running the whole recipe on 200 random splits gives a median of 0.91, and this split ranks at the 13th percentile.',
    );
    expect(s).not.toContain('0.86');
  });

  it('calls a mid-distribution split ordinary variation, and never claims an easy split explains a lower score', () => {
    const r = { ...readRobustness(sampleReport, 'CAD')!, fixedPercentile: 58 };
    expect(reconcileSentence(cadMetrics, 'test', facts, r)).toContain('within ordinary split-to-split variation');
    const easy = { ...r, fixedPercentile: 84 };
    expect(reconcileSentence(cadMetrics, 'test', facts, easy)).not.toContain('because');
  });

  it('keeps the robustness context on the CV split', () => {
    const r = readRobustness(sampleReport, 'CAD')!;
    const s = reconcileSentence(cadMetrics, 'cv', facts, r)!;
    expect(s).toContain('0.86, n = 61');
    expect(s).toContain('hard draw');
  });
});

describe('KPI tiles', () => {
  it('shows the four spec tiles with CI and n on the test split', () => {
    const tiles = kpis(cadMetrics, 'test', 'CAD', facts, 44 / 61);
    expect(tiles.map((t) => t.label)).toEqual(['ROC-AUC', 'Sensitivity', 'Specificity', 'Brier score']);
    expect(tiles[0]).toMatchObject({ value: 0.858289, interval: [0.743282, 0.954545], other: 0.936672 });
    expect(tiles[1]!.sub).toBe('37 of 44 with CAD flagged');
    expect(tiles[2]!.sub).toBe('13 of 17 without CAD not flagged');
    expect(tiles[3]!.higherIsBetter).toBe(false);
  });

  it('shows mean ± sd intervals and the test value as the comparison on the CV split', () => {
    const [auc] = kpis(cadMetrics, 'cv', 'CAD', facts, 0.7);
    expect(auc!.value).toBeCloseTo(0.9367, 4);
    expect(auc!.interval![0]).toBeCloseTo(0.9367 - 0.0345, 4);
    expect(auc!.other).toBeCloseTo(0.8583, 4);
    expect(auc!.sub).toBe('mean ± sd over 50 folds');
  });

  it('lists secondary metrics for the disclosure with human labels', () => {
    const rows = moreMetrics(cadMetrics);
    expect(rows.map((r) => r.id)).toEqual(['pr_auc', 'f1', 'mcc']);
    expect(rows[0]).toMatchObject({ test: '0.94', testCi: '0.88–0.98', cv: '0.97 ± 0.02' });
  });
});

describe('threshold explorer', () => {
  const points = operatingPoints(cadMetrics);

  it('adds the deployed point that the ROC export dropped and sorts low → high', () => {
    const dep = points[deployedIndex(points)]!;
    expect(dep).toMatchObject({ threshold: 0.747431, tp: 37, fp: 4, tn: 13, fn: 7, deployed: true });
    for (let i = 1; i < points.length; i += 1) expect(points[i]!.threshold).toBeGreaterThanOrEqual(points[i - 1]!.threshold);
    expect(points.filter((p) => p.deployed)).toHaveLength(1);
  });

  it('keeps totals constant at every operating point', () => {
    for (const p of points) {
      expect(p.tp + p.fn).toBe(44);
      expect(p.tn + p.fp).toBe(17);
    }
  });

  it('computes sensitivity, specificity, PPV, NPV and net benefit exactly', () => {
    const m = pointMetrics(points[deployedIndex(points)]!);
    expect(m.sensitivity).toBeCloseTo(37 / 44, 10);
    expect(m.specificity).toBeCloseTo(13 / 17, 10);
    expect(m.ppv).toBeCloseTo(37 / 41, 10);
    expect(m.npv).toBeCloseTo(13 / 20, 10);
    expect(m.netBenefit).toBeCloseTo(37 / 61 - (4 / 61) * (0.747431 / (1 - 0.747431)), 10);
    const none = pointMetrics({ threshold: 1, tp: 0, fp: 0, tn: 17, fn: 44, deployed: false });
    expect(none.ppv).toBeNull();
    expect(none.netBenefit).toBeNull();
  });
});

describe('chart findings', () => {
  it('turns AUC into pairs', () => {
    expect(rocFinding('CAD', 0.858)).toBe('Ranks a patient with CAD above one without in 86 % of pairs');
    expect(rocFinding('LAD', 0.742)).toBe('Ranks a stenotic LAD above a non-stenotic one in 74 % of pairs');
  });

  it('describes calibration from its summary', () => {
    expect(calibrationFinding(readCalibrationSummary(cadMetrics))).toBe(
      'Right on average, but estimates are more extreme than observed rates',
    );
    expect(calibrationFinding({ ece: 0.1, inTheLarge: 0.01, slope: 1.47 })).toContain('more cautious');
    expect(calibrationFinding({ ece: 0.1, inTheLarge: -0.08, slope: 1 })).toBe('Overestimates risk on average, with the right spread');
  });

  it('finds the net-benefit range', () => {
    expect(dcaBenefitRange(cadMetrics)).toEqual([0.2, 0.9]);
  });

  it('states the confusion matrix and drivers in words', () => {
    expect(confusionFinding('CAD', cadMetrics)).toBe('Flags 37 of 44 patients with CAD, with 4 false alarms among 17');
    expect(driversFinding('CAD', cadMetrics)).toBe(
      'Typical angina drives CAD estimates most, then age and regional wall-motion abnormality',
    );
  });
});

describe('leaderboard (§6.4 rule 4)', () => {
  const { rows, reference } = leaderboard(cadMetrics, 'lr_elasticnet');

  it('sorts by CV AUC, names the deployed row after its components and sets the reference aside', () => {
    expect(rows.map((r) => r.id)).toEqual(['random_forest', 'ensemble', 'xgboost', 'lr_elasticnet']);
    expect(rows.find((r) => r.deployed)!.name).toBe('Ensemble: elastic-net logistic regression + gradient-boosted trees');
    expect(reference?.id).toBe('dummy_prior');
    for (const r of rows) expect(r.name).not.toMatch(/_/);
  });

  it('explains why a tying model is not deployed', () => {
    const note = challengerNote(rows, 'lr_elasticnet')!;
    expect(note).toContain('Random forest ties the ensemble in cross-validation (0.94)');
    expect(note).toContain('log-loss 0.31 vs 0.36');
    expect(leaderboardFinding(rows)).toBe('The deployed ensemble ties the best of 4 models');
  });

  it('says nothing when the deployed model leads outright', () => {
    const lead = rows.map((r) => (r.deployed ? { ...r, mean: 0.95 } : r));
    expect(challengerNote(lead, null)).toBeNull();
  });

  it('recognises the challenger that is the ensemble’s own linear part', () => {
    const rca = rows.map((r) => (r.id === 'lr_elasticnet' ? { ...r, mean: 0.95 } : r));
    expect(challengerNote(rca, 'lr_elasticnet')).toContain('already contains this model');
  });
});

describe('analysis findings', () => {
  it('summarises robustness with the fixed split percentile', () => {
    const r = readRobustness(sampleReport, 'CAD')!;
    expect(robustnessFinding(r)).toBe(
      'Held-out ROC-AUC spans 0.84–0.96 across 200 re-splits; the published split was a hard one (13th percentile)',
    );
  });

  it('lines up every target with a published re-split analysis and states the cross-target finding', () => {
    const rows = robustnessAcross(sampleReport, ['CAD', 'LAD'], readRobustness);
    expect(rows.map((r) => r.target)).toEqual(['CAD']);
    expect(rows[0]).toMatchObject({ p50: 0.91, fixed: 0.858, fixedPercentile: 12.5 });
    expect(rows[0]!.cv).toBeCloseTo(0.9367, 4);
    const row = (target: string, cv: number, pct: number) => ({ target, p05: 0.8, p25: 0.85, p50: 0.88, p75: 0.9, p95: 0.95, fixed: 0.86, fixedPercentile: pct, cv });
    expect(acrossFinding([row('CAD', 0.94, 3), row('LAD', 0.87, 1.5), row('LCX', 0.9, 84), row('RCA', 0.85, 58)])).toBe(
      'Cross-validation lands inside the re-split range for every target; the locked split was a hard draw for CAD and LAD and an easy one for LCX',
    );
    expect(acrossFinding([row('CAD', 0.99, 50)])).toBe(
      'Cross-validation lands inside the re-split range for no target; the locked split was a typical draw',
    );
    expect(acrossFinding([])).toBe('Held-out ROC-AUC across random re-splits');
  });

  it('makes the multimodal gain the headline', () => {
    const a = readModalityAblation(sampleReport, 'CAD')!;
    expect(modalityFinding(a)).toBe('ECG, labs and echo lift ROC-AUC from 0.90 to 0.94 over bedside information');
  });

  it('reports subgroups with no clear difference', () => {
    const s = readSubgroups(sampleReport, 'CAD')!;
    expect(subgroupFinding(s, 'test')).toBe('No clear difference in discrimination across sex');
  });
});
