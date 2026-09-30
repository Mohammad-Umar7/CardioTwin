import { afterEach, describe, expect, it, vi } from 'vitest';
import { metricsResource } from '@/services/staticData';
import { jsonResponse, sampleMetrics } from '@/test/fixtures';
import {
  formatCv,
  fromMetricsReport,
  fromSummary,
  landingMetricsResource,
  performanceFor,
  reconcileTestAndCv,
  rocThumbnail,
  type MetricsSummaryFile,
} from './landingMetrics';

/** Shaped like ml/src/cardiotwin_ml/analysis/summary.py::build_metrics_summary. */
const summary: MetricsSummaryFile = {
  format: 'cardiotwin-metrics-summary',
  format_version: '1.0.0',
  model_version: '1.1.0',
  source: 'metrics.json',
  dataset: { name: 'Extension of Z-Alizadeh Sani', n: 303, n_dev: 242, n_test: 61, prevalence: { CAD: 0.71 } },
  protocol: { test: 'locked test set of 61 patients', cv: 'development set, repeated stratified 5-fold x 10' },
  targets: {
    RCA: {
      label: 'Right coronary artery',
      threshold: 0.318,
      test: { roc_auc: { value: 0.7586, ci: [0.627, 0.866] }, recall: { value: 0.78 }, specificity: { value: 0.53 } },
      cv: { roc_auc: { mean: 0.7266, std: 0.07 } },
    },
    CAD: {
      label: 'Coronary artery disease',
      threshold: 0.747,
      test: { roc_auc: { value: 0.8583, ci: [0.7433, 0.9545] }, recall: { value: 0.84 }, specificity: { value: 0.76 } },
      cv: { roc_auc: { mean: 0.9367, std: 0.0345 } },
      robustness: { n_splits: 200, fixed_split_percentile: 12, roc_auc: { mean: 0.9, p05: 0.84, p50: 0.91, p95: 0.96 } },
    },
  },
};

describe('fromSummary', () => {
  it('keeps test CIs, CV mean ± sd and the operating point, in contract order', () => {
    const lm = fromSummary(summary);
    expect(lm.source).toBe('summary');
    expect(lm.n).toBe(303);
    expect(lm.nTest).toBe(61);
    expect(lm.targets.map((t) => t.id)).toEqual(['CAD', 'RCA']);
    const cad = performanceFor(lm, 'CAD')!;
    expect(cad.testAuc).toEqual({ value: 0.8583, ci: [0.7433, 0.9545] });
    expect(cad.cvAuc).toEqual({ mean: 0.9367, std: 0.0345 });
    expect(cad.sensitivity).toBe(0.84);
    expect(cad.specificity).toBe(0.76);
    expect(cad.robustness).toEqual({ median: 0.91, p05: 0.84, p95: 0.96, nSplits: 200 });
    expect(performanceFor(lm, 'RCA')!.robustness).toBeNull();
  });

  it('rejects a file that is not a summary', () => {
    expect(() => fromSummary({} as MetricsSummaryFile)).toThrow(/unexpected shape/);
  });
});

describe('fromMetricsReport', () => {
  it('reads the same facts from the full report', () => {
    const lm = fromMetricsReport(sampleMetrics, { CAD: 'Coronary artery disease' });
    expect(lm.source).toBe('metrics');
    expect(lm.n).toBe(303);
    const cad = performanceFor(lm, 'CAD')!;
    expect(cad.label).toBe('Coronary artery disease');
    expect(cad.testAuc?.value).toBe(0.93);
    expect(cad.cvAuc?.mean).toBeCloseTo(0.92);
    expect(lm.targets.map((t) => t.id)).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
  });
});

describe('rocThumbnail', () => {
  it('anchors the curve at (0,0) and (1,1) and places the test operating point', () => {
    const roc = rocThumbnail(sampleMetrics, 'CAD')!;
    expect(roc.points[0]).toEqual([0, 0]);
    expect(roc.points[roc.points.length - 1]).toEqual([1, 1]);
    const [x, y] = roc.operating!;
    expect(x).toBeCloseTo(0.2);
    expect(y).toBeCloseTo(0.93);
  });

  it('is null without a curve', () => {
    expect(rocThumbnail(null)).toBeNull();
    expect(rocThumbnail(sampleMetrics, 'XYZ')).toBeNull();
  });
});

describe('landingMetricsResource', () => {
  afterEach(() => {
    landingMetricsResource.reset();
    metricsResource.reset();
    vi.unstubAllGlobals();
  });

  it('prefers metrics_summary.json', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.includes('metrics_summary.json') ? jsonResponse(summary) : new Response('', { status: 404 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const lm = await landingMetricsResource.get();
    expect(lm.source).toBe('summary');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('model/metrics.json'))).toBe(false);
  });

  it('falls back to metrics.json when the summary is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('metrics_summary.json')
            ? new Response('<!doctype html>', { status: 200 })
            : url.includes('metrics.json')
              ? jsonResponse(sampleMetrics)
              : new Response('', { status: 404 }),
        ),
      ),
    );
    const lm = await landingMetricsResource.get();
    expect(lm.source).toBe('metrics');
    expect(performanceFor(lm, 'CAD')?.testAuc?.value).toBe(0.93);
  });
});

describe('honest test vs CV text', () => {
  it('formats CV as mean ± sd and reconciles it with the test CI', () => {
    const cad = performanceFor(fromSummary(summary), 'CAD')!;
    expect(formatCv(cad.cvAuc)).toBe('0.94 ± 0.03');
    const text = reconcileTestAndCv(cad, 61)!;
    expect(text).toMatch(/^Test ROC-AUC 0\.86 \(n = 61, CI 0\.74–0\.95\) is below cross-validation/);
    expect(text).toMatch(/the CI includes the CV value/);
  });

  it('says so when the CI excludes the CV value', () => {
    const t = { ...performanceFor(fromSummary(summary), 'CAD')!, testAuc: { value: 0.7, ci: [0.6, 0.8] as [number, number] } };
    expect(reconcileTestAndCv(t, 61)).toMatch(/does not include the CV value/);
    expect(reconcileTestAndCv(null, 61)).toBeNull();
  });
});
