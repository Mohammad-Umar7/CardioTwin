/**
 * Edge vs server on the whole demo cohort: every patient in `cohort.json` (61 held-out TEST + 20 dev)
 * plus one seeded what-if variant each (8 random in-range edits; every second one also drops inputs),
 * compared with the answers of the running FastAPI server (native scikit-learn / XGBoost predictor),
 * captured in `testing/server-expectations.json` by `testing/generate-server-expectations.mjs`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CohortPatient, FeatureVector, RiskBandId, TargetId } from '@/types/contracts';
import { EdgeModel } from './model';
import { CONTRACT_TOLERANCE } from './parity';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import expectationsRaw from './testing/server-expectations.json?raw';

interface ServerTarget {
  probability: number;
  logit: number;
  label: 0 | 1;
  risk_band: RiskBandId;
  base_value: number;
  calibrated_base_value: number;
  shap: number[];
}

interface ServerCase {
  id: string;
  kind: 'cohort' | 'what-if';
  patient: string;
  edits?: FeatureVector;
  dropped?: string[];
  imputed: string[];
  targets: Record<TargetId, ServerTarget>;
  summary: { expected_diseased_vessels: number; highest_risk_vessel: TargetId };
}

interface ServerExpectations {
  model_version: string;
  features: string[];
  n_cases: number;
  cases: ServerCase[];
}

const expectations = JSON.parse(expectationsRaw) as ServerExpectations;
let model: EdgeModel;
let patients: Map<string, CohortPatient>;
const worst = { probability: 0, logit: 0, shap: 0, shapRelative: 0 };

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
  patients = new Map(loadCohort().patients.map((p) => [p.id, p]));
});

function inputsOf(c: ServerCase): FeatureVector {
  const base = patients.get(c.patient);
  if (!base) throw new Error(`cohort.json has no patient ${c.patient}`);
  const features: FeatureVector = { ...base.features, ...(c.edits ?? {}) };
  for (const key of c.dropped ?? []) delete features[key];
  return features;
}

describe('edge engine vs FastAPI server — full cohort', () => {
  it('was captured from the same model release and covers every cohort patient', () => {
    expect(expectations.model_version).toBe(model.modelVersion);
    expect(expectations.features).toEqual(model.spec.attribution.map((a) => a.feature));
    const cohortIds = expectations.cases.filter((c) => c.kind === 'cohort').map((c) => c.id);
    expect(new Set(cohortIds)).toEqual(new Set(patients.keys()));
    expect(expectations.cases.length).toBe(expectations.n_cases);
  });

  it.each(expectations.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const edge = model.predict(inputsOf(c));
    expect(edge.imputed).toEqual(c.imputed);
    for (const t of model.targets) {
      const server = c.targets[t]!;
      const p = edge.predictions[t]!;
      const ex = edge.explanations[t]!;
      const dp = Math.abs(p.probability - server.probability);
      const dl = Math.abs(p.logit - server.logit);
      expect(dp).toBeLessThan(CONTRACT_TOLERANCE.probability);
      expect(dl).toBeLessThan(CONTRACT_TOLERANCE.logit);
      expect(p.label).toBe(server.label);
      expect(p.risk_band).toBe(server.risk_band);
      expect(Math.abs(ex.base_value - server.base_value)).toBeLessThan(CONTRACT_TOLERANCE.base_value);
      expect(Math.abs(ex.calibrated_base_value - server.calibrated_base_value)).toBeLessThan(CONTRACT_TOLERANCE.base_value);
      const shap = new Map(ex.contributions.map((row) => [row.feature, row.shap]));
      expectations.features.forEach((feature, i) => {
        const ds = Math.abs(shap.get(feature)! - server.shap[i]!);
        expect(ds, `${t}.${feature}`).toBeLessThan(CONTRACT_TOLERANCE.shap);
        worst.shap = Math.max(worst.shap, ds);
        worst.shapRelative = Math.max(worst.shapRelative, ds / Math.max(1, Math.abs(server.shap[i]!)));
      });
      worst.probability = Math.max(worst.probability, dp);
      worst.logit = Math.max(worst.logit, dl);
    }
    expect(Math.abs(edge.summary.expected_diseased_vessels - c.summary.expected_diseased_vessels)).toBeLessThan(3e-6);
    expect(edge.summary.highest_risk_vessel).toBe(c.summary.highest_risk_vessel);
  });

  it('agrees to machine precision (SHAP limited by the stored 10 significant digits)', () => {
    console.info(
      `[parity] ${expectations.cases.length} server cases: max |Δp| ${worst.probability.toExponential(2)}, ` +
        `|Δlogit| ${worst.logit.toExponential(2)}, |Δshap| ${worst.shap.toExponential(2)}`,
    );
    expect(worst.probability).toBeLessThan(1e-12);
    expect(worst.logit).toBeLessThan(1e-12);
    // Stored with 10 significant digits ⇒ rounding error ≤ 5e-10 relative; nothing else differs.
    expect(worst.shapRelative).toBeLessThan(1e-9);
  });
});
