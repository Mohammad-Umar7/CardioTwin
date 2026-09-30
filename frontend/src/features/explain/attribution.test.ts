import { describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { EdgeModel } from '@/inference/model';
import type { PortableModelSpec } from '@/inference/types';
import { sigmoid } from '@/lib/explain';
import type { CohortResponse, FeatureSchema } from '@/types/contracts';
import cohortRaw from '../../../public/model/cohort.json?raw';
import modelRaw from '../../../public/model/model.json?raw';
import schemaRaw from '../../../public/model/schema.json?raw';
import { modalityAttribution, pointsScale, shapScale, splitDrivers, toPoints, typicalProbability } from './attribution';

const spec = JSON.parse(modelRaw) as PortableModelSpec;
const model = new EdgeModel(spec);
const cohort = JSON.parse(cohortRaw) as CohortResponse;
const index = indexSchema(JSON.parse(schemaRaw) as FeatureSchema);
const groupOf = (k: string) => index.byKey.get(k)?.group;

describe('percentage points (CONTRACTS §7.3)', () => {
  const r = model.predict(cohort.patients.find((p) => p.id === 'P-011')!.features);

  it('takes the typical probability from the calibrated base value', () => {
    const e = r.explanations.CAD!;
    expect(typicalProbability(e)).toBeCloseTo(sigmoid(e.calibrated_base_value), 15);
    // Without the v1.1 fields it falls back to model.json's Platt calibration, with the same result.
    const legacy = { ...e, calibrated_base_value: undefined };
    expect(typicalProbability(legacy, spec.models.CAD!.calibration)).toBeCloseTo(sigmoid(e.calibrated_base_value), 12);
  });

  it.each(cohort.patients.slice(0, 40).map((p) => [p.id, p] as const))(
    '%s: points add up from the typical patient to this patient, with every sign kept',
    (_id, patient) => {
      const res = model.predict(patient.features);
      for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
        const e = res.explanations[t]!;
        const p = res.predictions[t]!.probability;
        const scale = pointsScale(e, p)!;
        const pts = e.contributions.map((c) => toPoints(c.shap, scale)!);
        const sum = pts.reduce((a, b) => a + b, 0);
        expect(scale.typical * 100 + sum).toBeCloseTo(p * 100, 8);
        e.contributions.forEach((c, i) => {
          if (Math.abs(c.shap) > 1e-12) expect(Math.sign(pts[i]!)).toBe(Math.sign(c.shap));
        });
      }
    },
  );

  it('uses the local slope when the estimate equals the typical patient', () => {
    const e = { space: 'log-odds', base_value: 0.4, output_value: 0.4, contributions: [{ feature: 'A', value: 1, shap: 0.3 }, { feature: 'B', value: 0, shap: -0.3 }] };
    const scale = pointsScale(e, sigmoid(0.4), { a: 1, b: 0 })!;
    expect(scale.perLogOdds).toBeCloseTo(sigmoid(0.4) * (1 - sigmoid(0.4)), 12);
    expect(toPoints(0.3, scale)! + toPoints(-0.3, scale)!).toBeCloseTo(0, 12);
  });

  it('returns null when the typical probability cannot be known', () => {
    const e = { space: 'log-odds', base_value: 0, output_value: 1, contributions: [] };
    expect(pointsScale(e, 0.7)).toBeNull();
    expect(toPoints(0.5, null)).toBeNull();
  });
});

describe('modalities and drivers', () => {
  const e = model.predict(cohort.patients[0]!.features).explanations.CAD!;

  it('sums SHAP per data modality in acquisition order, conserving the total', () => {
    const rows = modalityAttribution(e, groupOf);
    expect(rows.map((r) => r.group)).toEqual(['demographics', 'risk_factors', 'symptoms', 'exam', 'ecg', 'labs', 'echo']);
    const total = rows.reduce((a, r) => a + r.sum, 0);
    expect(total).toBeCloseTo(e.output_value - e.base_value, 9);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 9);
    expect(rows.find((r) => r.group === 'ecg')?.label).toBe('Resting ECG');
    expect(rows.find((r) => r.group === 'ecg')?.contributions.every((c) => groupOf(c.feature) === 'ecg')).toBe(true);
  });

  it('splits the top raising and lowering contributions and counts the rest', () => {
    const split = splitDrivers(e, 5);
    expect(split.raising.every((c) => c.shap > 0)).toBe(true);
    expect(split.lowering.every((c) => c.shap < 0)).toBe(true);
    expect(split.raising.length + split.lowering.length + split.hidden).toBe(e.contributions.length);
    expect(Math.abs(split.raising[0]!.shap)).toBeGreaterThanOrEqual(Math.abs(split.raising.at(-1)!.shap));
    expect(shapScale(e)).toBe(Math.max(...e.contributions.map((c) => Math.abs(c.shap))));
  });
});
