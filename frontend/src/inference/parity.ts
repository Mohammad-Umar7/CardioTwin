/**
 * Cross-engine parity: compare two §3.2 responses (edge vs server, edge vs fixture) field by field.
 * Used by the fixture/cohort test-suites and at runtime by the engine verifier behind the EnginePill.
 */
import type { Explanation, PredictResponse, TargetId, TargetPrediction } from '@/types/contracts';

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
  /**
   * Discrete outcomes (label, risk band, highest-risk vessel) that differ only because the two
   * probabilities straddle the decision boundary within tolerance — not counted as disagreements.
   */
  boundaryTies: string[];
}

/** Risk bands from lowest to highest (CONTRACTS §2 `risk_bands`). */
const BAND_ORDER: readonly string[] = ['low', 'moderate', 'high', 'critical'];

/**
 * Two engines that agree to a few ulps can still land on opposite sides of a decision boundary: found
 * against the live server, e.g. CAD with Age = 47.27671142066387 gives p = threshold − 1 ulp on the edge
 * (label 0) and p = threshold on the server (label 1). No two float64 pipelines with different summation
 * orders can rule this out, so such a flip is a *boundary tie*, accepted only when it is explained:
 * |Δp| is within tolerance and each side's outcome is the one its own probability implies.
 */
function labelTie(pa: TargetPrediction, pe: TargetPrediction, tol: number): boolean {
  const consistent = (p: TargetPrediction) => p.label === (p.probability >= p.threshold ? 1 : 0);
  return Math.abs(pa.probability - pe.probability) <= tol && pa.threshold === pe.threshold && consistent(pa) && consistent(pe);
}

function bandTie(pa: TargetPrediction, pe: TargetPrediction, tol: number): boolean {
  const ia = BAND_ORDER.indexOf(pa.risk_band);
  const ie = BAND_ORDER.indexOf(pe.risk_band);
  if (ia < 0 || ie < 0 || Math.abs(ia - ie) !== 1) return false;
  if (!(Math.abs(pa.probability - pe.probability) <= tol)) return false;
  // The higher band must come with the strictly higher probability (a boundary lies between them).
  return ia > ie ? pa.probability > pe.probability : pe.probability > pa.probability;
}

const MAX_MESSAGES = 25;

type Calibrated = Explanation & { calibrated_base_value?: number; calibrated_output_value?: number };
type CalibratedContribution = { shap_calibrated?: number };

const fmt = (x: number) => x.toExponential(2);

/**
 * Compare `actual` against `expected`. Numeric fields use `tolerance`; the imputed list, the set of
 * contribution features and their values must match exactly (numbers within 1e-9); labels, bands and the
 * highest-risk vessel must match unless the difference is a boundary tie (see `labelTie`), which is
 * reported in `boundaryTies` instead. The `engine` field is ignored — it is supposed to differ.
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
    boundaryTies: [],
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
    if (pa.label !== pe.label) {
      const message = `${t}.label ${pa.label} ≠ ${pe.label} (p ${pa.probability} vs ${pe.probability}, threshold ${pe.threshold})`;
      if (labelTie(pa, pe, tolerance.probability)) report.boundaryTies.push(message);
      else fail(message);
    }
    if (pa.risk_band !== pe.risk_band) {
      const message = `${t}.risk_band ${pa.risk_band} ≠ ${pe.risk_band} (p ${pa.probability} vs ${pe.probability})`;
      if (bandTie(pa, pe, tolerance.probability)) report.boundaryTies.push(message);
      else fail(message);
    }

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
    const va = sa.highest_risk_vessel;
    const ve = se.highest_risk_vessel;
    if (va !== ve) {
      const message = `summary.highest_risk_vessel ${String(va)} ≠ ${String(ve)}`;
      // A near-tie between two vessels: each engine picked its own maximum, and both pairs are within tolerance.
      const p = (r: PredictResponse, v: TargetId | null) => (v ? r.predictions[v]?.probability : undefined);
      const [aa, ab, ea, eb] = [p(actual, va), p(actual, ve), p(expected, va), p(expected, ve)];
      const tie =
        aa !== undefined && ab !== undefined && ea !== undefined && eb !== undefined &&
        aa >= ab && eb >= ea && aa - ab <= 2 * tolerance.probability && eb - ea <= 2 * tolerance.probability;
      if (tie) report.boundaryTies.push(message);
      else fail(message);
    }
  } else if (sa || se) {
    fail('summary missing on one side');
  }

  report.agree = mismatches.length === 0;
  return report;
}
