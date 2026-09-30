import { describe, expect, it } from 'vitest';
import { sampleMetrics } from '@/test/fixtures';
import type { MetricsReport } from '@/types/contracts';
import { isMetricsSummary, normalisePerformance, type MetricsSummaryFile } from './performance';

const labels = new Map([
  ['CAD', 'Coronary artery disease'],
  ['LAD', 'Left anterior descending artery'],
]);

/** Shape written by ml/src/cardiotwin_ml/analysis/summary.py (build_metrics_summary). */
const summary: MetricsSummaryFile = {
  format: 'cardiotwin-metrics-summary',
  format_version: '1.0.0',
  model_version: '1.1.0',
  metrics_generated_at: '2026-09-30T05:48:46+00:00',
  dataset: { name: 'Extension of Z-Alizadeh Sani', n: 303, n_dev: 242, n_test: 61, prevalence: { CAD: 0.713 } },
  targets: {
    RCA: {
      label: 'Right coronary artery',
      threshold: 0.318,
      test: { roc_auc: { value: 0.759, ci: [0.627, 0.866] }, recall: { value: 0.78, ci: [0.61, 0.91] } },
      cv: { roc_auc: { mean: 0.727, std: 0.07 } },
    },
    CAD: {
      label: 'CAD',
      threshold: 0.747,
      test: {
        roc_auc: { value: 0.858, ci: [0.743, 0.955] },
        recall: { value: 0.841, ci: [0.727, 0.932] },
        specificity: { value: 0.765, ci: [0.588, 0.941] },
        brier: { value: 0.123, ci: [0.068, 0.182] },
      },
      cv: { roc_auc: { mean: 0.937, std: 0.034 } },
      robustness: { n_splits: 200, roc_auc: { p05: 0.82, p50: 0.91, p95: 0.96 } },
    },
  },
};

describe('normalisePerformance', () => {
  it('reads metrics_summary.json in contract target order with schema labels', () => {
    const s = normalisePerformance(summary, labels)!;
    expect(s.source).toBe('summary');
    expect(s.modelVersion).toBe('1.1.0');
    expect(s).toMatchObject({ n: 303, nDev: 242, nTest: 61 });
    expect(s.rows.map((r) => r.target)).toEqual(['CAD', 'RCA']);
    const cad = s.rows[0]!;
    expect(cad.label).toBe('Coronary artery disease');
    expect(cad.auc).toEqual({ value: 0.858, ci: [0.743, 0.955] });
    expect(cad.sensitivity?.value).toBe(0.841);
    expect(cad.cvAuc).toEqual({ mean: 0.937, sd: 0.034 });
    expect(cad.robustAuc).toEqual({ p50: 0.91, p05: 0.82, p95: 0.96, nSplits: 200 });
    const rca = s.rows[1]!;
    expect(rca.label).toBe('Right coronary artery');
    expect(rca.specificity).toBeNull();
    expect(rca.brier).toBeNull();
    expect(rca.robustAuc).toBeNull();
  });

  it('reads metrics.json (CONTRACTS §4) into the same shape', () => {
    const s = normalisePerformance(sampleMetrics, labels)!;
    expect(s.source).toBe('metrics');
    expect(s.rows.map((r) => r.target)).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
    const cad = s.rows[0]!;
    expect(cad.auc?.value).toBe(0.93);
    expect(cad.auc?.ci?.[0]).toBeCloseTo(0.87, 10);
    expect(cad.sensitivity?.value).toBe(0.93);
    expect(cad.specificity?.value).toBe(0.8);
    expect(cad.threshold).toBe(0.46);
    expect(cad.cvAuc?.sd).toBe(0.03);
    expect(s.rows[2]!.label).toBe('LCX');
  });

  it('picks up the robustness block that ml/ adds to metrics.json', () => {
    const m = { ...sampleMetrics, robustness: { LAD: { n_splits: 100, roc_auc: { p05: 0.7, p50: 0.8, p95: 0.88 } } } };
    const s = normalisePerformance(m as MetricsReport, labels)!;
    expect(s.rows.find((r) => r.target === 'LAD')!.robustAuc).toEqual({ p50: 0.8, p05: 0.7, p95: 0.88, nSplits: 100 });
    expect(s.rows.find((r) => r.target === 'CAD')!.robustAuc).toBeNull();
  });

  it('rejects anything that is neither file', () => {
    expect(normalisePerformance(null)).toBeNull();
    expect(normalisePerformance({} as MetricsReport)).toBeNull();
    expect(isMetricsSummary(sampleMetrics)).toBe(false);
    expect(isMetricsSummary(summary)).toBe(true);
  });
});
