import { describe, expect, it } from 'vitest';
import type { MetricsReport } from '@/types/contracts';
import metricsRaw from '../../../public/model/metrics.json?raw';
import summaryRaw from '../../../public/model/metrics_summary.json?raw';
import { factsFromMetrics, factsFromSummary } from './modelFacts';

const summary = JSON.parse(summaryRaw) as unknown;
const metrics = JSON.parse(metricsRaw) as MetricsReport;

describe('model facts', () => {
  const a = factsFromSummary(summary);
  const b = factsFromMetrics(metrics);

  it('reads the headline test AUC, CI, threshold and n from metrics_summary.json', () => {
    const cad = a.targets.CAD!;
    expect(a.source).toBe('summary');
    expect(a.dataset.nTest).toBe(61);
    expect(cad.test.auc?.value).toBeGreaterThan(0.5);
    expect(cad.test.auc?.ci?.[0]).toBeLessThan(cad.test.auc!.value);
    expect(cad.threshold).toBeGreaterThan(0);
    expect(cad.thresholdRule).toMatch(/Youden/);
  });

  it('agrees with the full metrics.json on every shared number', () => {
    for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
      const x = a.targets[t]!;
      const y = b.targets[t]!;
      expect(x.threshold).toBeCloseTo(y.threshold!, 6);
      expect(x.test.auc?.value).toBeCloseTo(y.test.auc!.value, 6);
      expect(x.test.sensitivity?.value).toBeCloseTo(y.test.sensitivity!.value, 6);
      expect(x.cvAuc?.mean).toBeCloseTo(y.cvAuc!.mean, 2);
      expect(x.calibration.slope).toBeCloseTo(y.calibration.slope!, 6);
      expect(x.robustness?.median).toBeCloseTo(y.robustness!.median, 6);
      expect(x.modality?.steps.map((s) => s.group)).toEqual(y.modality?.steps.map((s) => s.group));
      expect(x.modality?.instrumental?.value).toBeCloseTo(y.modality!.instrumental!.value, 6);
    }
  });

  it('lists the cumulative modality steps from demographics to echo, first step without a delta', () => {
    const steps = a.targets.CAD!.modality!.steps;
    expect(steps[0]).toMatchObject({ group: 'demographics', delta: null });
    expect(steps.at(-1)?.group).toBe('echo');
    expect(steps.slice(1).every((s) => s.delta !== null)).toBe(true);
  });

  it('rejects a file that is not a summary', () => {
    expect(() => factsFromSummary({ targets: {} })).toThrow();
    expect(() => factsFromSummary(null)).toThrow();
  });

  it('survives a minimal CONTRACTS §4 report without the v1.1 keys', () => {
    const minimal = {
      version: '1.0.0',
      dataset: { name: 'x', n: 10, n_dev: 8, n_test: 2, prevalence: {} },
      protocol: {},
      targets: { CAD: { threshold: 0.5, test: { roc_auc: { value: 0.8, ci: [0.7, 0.9] } }, cv: {} } },
    } as unknown as MetricsReport;
    const f = factsFromMetrics(minimal).targets.CAD!;
    expect(f.test.auc).toEqual({ value: 0.8, ci: [0.7, 0.9] });
    expect(f.robustness).toBeNull();
    expect(f.modality).toBeNull();
    expect(f.thresholdRule).toBeNull();
  });
});
