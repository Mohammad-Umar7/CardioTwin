import { describe, expect, it } from 'vitest';
import type { MetricsReport } from '@/types/contracts';
import {
  readAnalysisNote,
  readBaseline,
  readCalibrationSummary,
  readComponents,
  readModalityAblation,
  readRobustness,
  readSubgroups,
} from './extras';
import { cadMetrics, sampleReport } from './fixtures.test-data';

const bare = { ...sampleReport, robustness: undefined, modality_ablation: undefined, subgroups: undefined, analysis: undefined } as unknown as MetricsReport;

describe('additive metrics readers', () => {
  it('return null when the ML pipeline has not published the analysis yet', () => {
    expect(readRobustness(bare, 'CAD')).toBeNull();
    expect(readModalityAblation(bare, 'CAD')).toBeNull();
    expect(readSubgroups(bare, 'CAD')).toBeNull();
    expect(readAnalysisNote(bare, 'robustness')).toBeNull();
    expect(readRobustness(undefined, 'CAD')).toBeNull();
    expect(readRobustness(sampleReport, 'LAD')).toBeNull();
  });

  it('ignore malformed blocks instead of throwing', () => {
    const broken = { ...sampleReport, robustness: { CAD: { roc_auc: { mean: 'x' } } }, subgroups: { CAD: { factors: 3 } } } as unknown as MetricsReport;
    expect(readRobustness(broken, 'CAD')).toBeNull();
    expect(readSubgroups(broken, 'CAD')).toBeNull();
  });

  it('read the Monte-Carlo distribution and the fixed split', () => {
    const r = readRobustness(sampleReport, 'CAD')!;
    expect(r.nSplits).toBe(200);
    expect(r.rocAuc).toMatchObject({ p50: 0.91, fixed: 0.858, fixedPercentile: 12.5 });
    expect(r.samples).toHaveLength(200);
    expect(r.deltaVsBaseline?.sharePositive).toBe(0.81);
    expect(r.cvEstimate).toEqual({ rocAuc: 0.9367, percentile: 71 });
  });

  it('read cumulative, leave-one-out and instrumental modality blocks with Holm p-values', () => {
    const a = readModalityAblation(sampleReport, 'CAD')!;
    expect(a.cumulative.map((r) => r.group)).toEqual(['demographics', 'symptoms', 'echo']);
    expect(a.cumulative[0]!.delta).toBeNull();
    expect(a.cumulative[1]!.delta).toMatchObject({ mean: 0.18, p: 0.0002 });
    expect(a.leaveOneOut[0]!.delta!.ci).toEqual([-0.13, -0.05]);
    expect(a.instrumental?.addedGroups).toEqual(['ecg', 'labs', 'echo']);
    expect(a.full?.mean).toBe(0.94);
  });

  it('read subgroup factors for both prediction sources', () => {
    const s = readSubgroups(sampleReport, 'CAD')!;
    expect(s.factors[0]).toMatchObject({ id: 'sex', reference: 'male' });
    const female = s.factors[0]!.levels[0]!;
    expect(female.test?.smallN).toBe(true);
    expect(female.oof?.deltaVsReference).toEqual({ value: -0.02, ci: [-0.08, 0.04] });
    expect(s.overall.test?.n).toBe(61);
  });

  it('read the per-target v1.1 extras', () => {
    expect(readCalibrationSummary(cadMetrics)).toEqual({ ece: 0.079, inTheLarge: -0.016, slope: 0.62 });
    expect(readComponents(cadMetrics)).toMatchObject({ logisticId: 'lr_elasticnet', logisticWeight: 0.4, nTrees: 108 });
    expect(readBaseline(cadMetrics)).toMatchObject({ features: ['Age', 'Sex', 'Typical Chest Pain', 'DM', 'HTN'], testAuc: { value: 0.8215 } });
    expect(readAnalysisNote(sampleReport, 'robustness')).toBe('Monte-Carlo repeated hold-out');
  });
});
