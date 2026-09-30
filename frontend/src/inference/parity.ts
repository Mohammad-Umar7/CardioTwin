/**
 * Cross-engine parity: compare two §3.2 responses (edge vs server, edge vs fixture) field by field.
 * Used by the fixture/cohort test-suites and at runtime by the engine verifier behind the EnginePill.
 */
import type { Explanation, PredictResponse, TargetId } from '@/types/contracts';

export interface ParityTolerance {
  probability: number;
  logit: number;
  base_value: number;
  shap: number;
}

/** The contract tolerances (`fixtures.json → tolerance`, CONTRACTS §5). */
export const CONTRACT_TOLERANCE: Readonly<ParityTolerance> = Object.freeze({
  probability: 1e-6,
  logit: 1e-6,
  base_value: 1e-6,
  shap: 1e-5,
});

export interface ParityReport {
  /** True when every check passed. */
  agree: boolean;
  /** Largest |Δ| over all targets (0 when a field is absent from either side). */
  maxDeltaProbability: number;
  maxDeltaLogit: number;
  maxDeltaBase: number;
  maxDeltaShap: number;
  /** Targets compared. */
  targets: TargetId[];
  /** Number of individual contributions compared. */
  contributions: number;
  /** Human-readable failures (capped), e.g. "LAD.probability |Δ| 3.1e-4 > 1e-6". */
  mismatches: string[];
}

const MAX_MESSAGES = 25;

type Calibrated = Explanation & { calibrated_base_value?: number; calibrated_output_value?: number };
type CalibratedContribution = { shap_calibrated?: number };

const fmt = (x: number) => x.toExponential(2);

/**
 * Compare `actual` against `expected`. Numeric fields use `tolerance`; labels, bands, the imputed list,
 * the set of contribution features and their values must match exactly (numbers within 1e-9).
 * The `engine` field is ignored — that is the one field that is supposed to differ.
 */
export function compareResponses(
  actual: PredictResponse,
  expected: PredictResponse,
  tolerance: ParityTolerance = CONTRACT_TOLERANCE,
): ParityReport {
  const mismatches: string[] = [];
  const fail = (message: string) => {
    if (mismatches.length < MAX_MESSAGES) mismatches.push(message);
    else if (mismatches.length === MAX_MESSAGES) mismatches.push('…');
  };
  const report: ParityReport = {
    agree: false,
    maxDeltaProbability: 0,
    maxDeltaLogit: 0,
    maxDeltaBase: 0,
    maxDeltaShap: 0,
    targets: [],
    contributions: 0,
    mismatches,
  };
  const check = (field: string, a: number, e: number, tol: number): number => {
    const delta = Math.abs(a - e);
    if (!(delta <= tol)) fail(`${field} |Δ| ${Number.isFinite(delta) ? fmt(delta) : String(delta)} > ${fmt(tol)}`);
    return Number.isFinite(delta) ? delta : Number.POSITIVE_INFINITY;
  };

  if (actual.model_version !== expected.model_version) {
    fail(`model_version ${actual.model_version} ≠ ${expected.model_version}`);
  }
  if (JSON.stringify(actual.imputed ?? []) !== JSON.stringify(expected.imputed ?? [])) {
    fail(`imputed [${(actual.imputed ?? []).join(', ')}] ≠ [${(expected.imputed ?? []).join(', ')}]`);
  }

  const targets = Object.keys(expected.predictions ?? {});
  const actualTargets = Object.keys(actual.predictions ?? {});
  if (targets.length !== actualTargets.length || targets.some((t) => !actualTargets.includes(t))) {
    fail(`targets [${actualTargets.join(', ')}] ≠ [${targets.join(', ')}]`);
  }
  report.targets = targets.filter((t) => actualTargets.includes(t));

  for (const t of report.targets) {
    const pa = actual.predictions[t]!;
    const pe = expected.predictions[t]!;
    report.maxDeltaProbability = Math.max(report.maxDeltaProbability, check(`${t}.probability`, pa.probability, pe.probability, tolerance.probability));
    report.maxDeltaLogit = Math.max(report.maxDeltaLogit, check(`${t}.logit`, pa.logit, pe.logit, tolerance.logit));
    check(`${t}.threshold`, pa.threshold, pe.threshold, 1e-12);
    if (pa.label !== pe.label) fail(`${t}.label ${pa.label} ≠ ${pe.label}`);
    if (pa.risk_band !== pe.risk_band) fail(`${t}.risk_band ${pa.risk_band} ≠ ${pe.risk_band}`);

    const ea = actual.explanations?.[t] as Calibrated | undefined;
    const ee = expected.explanations?.[t] as Calibrated | undefined;
    if (!ea || !ee) {
      if (ea || ee) fail(`${t}.explanations missing on one side`);
      continue;
    }
    report.maxDeltaBase = Math.max(report.maxDeltaBase, check(`${t}.base_value`, ea.base_value, ee.base_value, tolerance.base_value));
    report.maxDeltaLogit = Math.max(report.maxDeltaLogit, check(`${t}.output_value`, ea.output_value, ee.output_value, tolerance.logit));
    if (typeof ea.calibrated_base_value === 'number' && typeof ee.calibrated_base_value === 'number') {
      check(`${t}.calibrated_base_value`, ea.calibrated_base_value, ee.calibrated_base_value, tolerance.base_value);
    }
    if (typeof ea.calibrated_output_value === 'number' && typeof ee.calibrated_output_value === 'number') {
      check(`${t}.calibrated_output_value`, ea.calibrated_output_value, ee.calibrated_output_value, tolerance.logit);
    }

    const byFeature = new Map(ea.contributions.map((c) => [c.feature, c]));
    if (byFeature.size !== ee.contributions.length) {
      fail(`${t}: ${byFeature.size} contributions ≠ ${ee.contributions.length}`);
    }
    for (const ce of ee.contributions) {
      const ca = byFeature.get(ce.feature);
      if (!ca) {
        fail(`${t}: contribution '${ce.feature}' missing`);
        continue;
      }
      report.contributions += 1;
      const field = `${t}.${ce.feature}`;
      report.maxDeltaShap = Math.max(report.maxDeltaShap, check(`${field}.shap`, ca.shap, ce.shap, tolerance.shap));
      const sa = (ca as CalibratedContribution).shap_calibrated;
      const se = (ce as CalibratedContribution).shap_calibrated;
      if (typeof sa === 'number' && typeof se === 'number') check(`${field}.shap_calibrated`, sa, se, tolerance.shap);
      const sameValue =
        typeof ca.value === 'number' && typeof ce.value === 'number'
          ? Math.abs(ca.value - ce.value) <= 1e-9
          : ca.value === ce.value;
      if (!sameValue) fail(`${field}.value ${String(ca.value)} ≠ ${String(ce.value)}`);
    }
  }

  const sa = actual.summary;
  const se = expected.summary;
  if (sa && se) {
    check('summary.expected_diseased_vessels', sa.expected_diseased_vessels, se.expected_diseased_vessels, 3 * tolerance.probability);
    if (sa.highest_risk_vessel !== se.highest_risk_vessel) {
      fail(`summary.highest_risk_vessel ${String(sa.highest_risk_vessel)} ≠ ${String(se.highest_risk_vessel)}`);
    }
  } else if (sa || se) {
    fail('summary missing on one side');
  }

  report.agree = mismatches.length === 0;
  return report;
}
