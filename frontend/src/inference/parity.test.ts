/**
 * `compareResponses` at decision boundaries: a label, band or highest-vessel flip between two engines
 * that agree to a few ulps is a boundary tie (reported, not a disagreement) — but only when the
 * probabilities explain it. Anything else must still fail.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PredictResponse, RiskBandId, TargetId } from '@/types/contracts';
import { EdgeModel } from './model';
import { compareResponses } from './parity';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import type { EdgePredictResponse } from './types';

let model: EdgeModel;

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
});

const clone = <T>(x: T): T => structuredClone(x);

function withPrediction(r: PredictResponse, t: TargetId, patch: Partial<PredictResponse['predictions'][TargetId]>): PredictResponse {
  const out = clone(r);
  out.predictions[t] = { ...out.predictions[t]!, ...patch };
  return out;
}

describe('boundary ties captured from the live server', () => {
  /**
   * `POST /api/predict` (model 1.1.0) for cohort patient P-014 with Age = 47.27671142066387 answered
   * CAD p = 0.747430873962682 = threshold → label 1; the edge computes 1 ulp less → label 0.
   * Found by bisecting the label flip on the edge and probing the server around it (12 such inputs in
   * 39 smooth crossings over CAD/LCX/RCA). Both are correct to 1.1e-16.
   */
  const input = () => ({ ...loadCohort().patients.find((p) => p.id === 'P-014')!.features, Age: 47.27671142066387 });
  const SERVER_CAD_P = 0.747430873962682;

  it('reproduces the edge side of the case', () => {
    const edge = model.predict(input());
    const cad = edge.predictions.CAD;
    expect(cad.threshold).toBe(SERVER_CAD_P);
    expect(cad.probability).toBeLessThan(cad.threshold);
    expect(cad.threshold - cad.probability).toBeLessThanOrEqual(2 ** -53); // one ulp below
    expect(cad.label).toBe(0);
  });

  it('is an explained boundary tie, not an engine disagreement', () => {
    const edge = model.predict(input());
    const server = withPrediction(edge, 'CAD', { probability: SERVER_CAD_P, label: 1 });
    const report = compareResponses(edge, server);
    expect(report.mismatches).toEqual([]);
    expect(report.agree).toBe(true);
    expect(report.boundaryTies).toHaveLength(1);
    expect(report.boundaryTies[0]).toMatch(/^CAD\.label 0 ≠ 1/);
  });
});

describe('what is still a disagreement', () => {
  let edge: EdgePredictResponse;
  beforeAll(() => {
    edge = model.predict(loadCohort().patients[0]!.features);
  });

  it('a label flip with identical probabilities (a label bug, not rounding)', () => {
    const cad = edge.predictions.CAD;
    const server = withPrediction(edge, 'CAD', { label: cad.label === 1 ? 0 : 1 });
    const report = compareResponses(edge, server);
    expect(report.agree).toBe(false);
    expect(report.mismatches[0]).toMatch(/CAD\.label/);
  });

  it('a label inconsistent with its own probability, even near the threshold', () => {
    const thr = edge.predictions.LAD.threshold;
    const a = withPrediction(edge, 'LAD', { probability: thr + 1e-12, label: 0 });
    const e = withPrediction(edge, 'LAD', { probability: thr, label: 1 });
    expect(compareResponses(a, e).agree).toBe(false);
  });

  it('a label flip farther from the threshold than the tolerance', () => {
    const thr = edge.predictions.LAD.threshold;
    const a = withPrediction(edge, 'LAD', { probability: thr - 1e-3, label: 0 });
    const e = withPrediction(edge, 'LAD', { probability: thr + 1e-3, label: 1 });
    const report = compareResponses(a, e);
    expect(report.agree).toBe(false);
    expect(report.boundaryTies).toEqual([]);
  });

  it('a band difference at identical probabilities (different band tables)', () => {
    const band = edge.predictions.RCA.risk_band;
    const other: RiskBandId = band === 'low' ? 'moderate' : 'low';
    const report = compareResponses(edge, withPrediction(edge, 'RCA', { risk_band: other }));
    expect(report.agree).toBe(false);
  });

  it('accepts a band tie only between adjacent bands, ordered like the probabilities', () => {
    const below = 0.5 - 2 ** -54;
    const a = withPrediction(edge, 'LCX', { probability: below, risk_band: 'moderate', label: below >= edge.predictions.LCX.threshold ? 1 : 0 });
    const e = withPrediction(edge, 'LCX', { probability: 0.5, risk_band: 'high', label: 0.5 >= edge.predictions.LCX.threshold ? 1 : 0 });
    const tie = compareResponses(a, e);
    expect(tie.mismatches).toEqual([]);
    expect(tie.boundaryTies).toEqual([expect.stringMatching(/^LCX\.risk_band moderate ≠ high/)]);
    // Reversed order (higher band with the lower probability) or a two-band jump is a real difference.
    expect(compareResponses(withPrediction(a, 'LCX', { risk_band: 'high' }), withPrediction(e, 'LCX', { risk_band: 'moderate' })).agree).toBe(false);
    expect(compareResponses(withPrediction(a, 'LCX', { risk_band: 'low' }), e).agree).toBe(false);
  });

  it('accepts a highest-vessel flip only for a near tie that each side resolved to its own maximum', () => {
    const p = 0.61;
    const tieA = withPrediction(withPrediction(edge, 'LAD', { probability: p + 2 ** -53 }), 'LCX', { probability: p });
    const tieE = withPrediction(withPrediction(edge, 'LAD', { probability: p }), 'LCX', { probability: p + 2 ** -53 });
    for (const t of ['RCA'] as const) {
      tieA.predictions[t] = { ...tieA.predictions[t]!, probability: 0.1 };
      tieE.predictions[t] = { ...tieE.predictions[t]!, probability: 0.1 };
    }
    tieA.summary = { ...tieA.summary, highest_risk_vessel: 'LAD' };
    tieE.summary = { ...tieE.summary, highest_risk_vessel: 'LCX' };
    // Labels and bands follow the patched probabilities on both sides.
    for (const r of [tieA, tieE]) {
      for (const t of ['LAD', 'LCX', 'RCA'] as const) {
        const q = r.predictions[t]!;
        r.predictions[t] = { ...q, label: q.probability >= q.threshold ? 1 : 0, risk_band: riskBandOf(q.probability) };
      }
    }
    const report = compareResponses(tieA, tieE);
    expect(report.mismatches.filter((m) => m.startsWith('summary.highest'))).toEqual([]);
    expect(report.boundaryTies).toContainEqual(expect.stringMatching(/highest_risk_vessel LAD ≠ LCX/));

    const far = clone(tieE);
    far.predictions.LCX = { ...far.predictions.LCX, probability: p + 0.05 };
    expect(compareResponses(tieA, far).mismatches.some((m) => m.startsWith('summary.highest'))).toBe(true);
  });
});

function riskBandOf(p: number): RiskBandId {
  return p < 0.25 ? 'low' : p < 0.5 ? 'moderate' : p < 0.75 ? 'high' : 'critical';
}
