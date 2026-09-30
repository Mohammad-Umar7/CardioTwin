/**
 * Parity gate (CONTRACTS §5): the edge engine must reproduce EVERY case of `public/model/fixtures.json`
 * (responses of the native Python predictor) to |Δp| < 1e-6 and |Δshap| < 1e-5, with identical labels,
 * risk bands, imputed lists, contribution values and ordering.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FixturesFile } from '@/types/contracts';
import { EdgeModel } from './model';
import { compareResponses } from './parity';
import { loadFixtures, loadModelSpec } from './testing/artifacts';

let model: EdgeModel;
let fixtures: FixturesFile;
/** Worst deltas across all cases, reported at the end so regressions show their size. */
const worst = { probability: 0, logit: 0, base: 0, shap: 0 };

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
  fixtures = loadFixtures();
});

describe('fixtures.json parity', () => {
  it('covers the model version and column order of this model', () => {
    expect(fixtures.model_version).toBe(model.modelVersion);
    expect(fixtures.columns).toEqual(model.spec.columns);
    expect(fixtures.cases.length).toBe(fixtures.n_cases);
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(30);
  });

  it('uses tolerances no looser than the contract', () => {
    expect(fixtures.tolerance.probability).toBeLessThanOrEqual(1e-6);
    expect(fixtures.tolerance.shap).toBeLessThanOrEqual(1e-5);
  });

  const cases = loadFixtures().cases;
  it.each(cases.map((c, i) => [c.id ?? `case-${i}`, i] as const))('%s', (_id, index) => {
    const fixture = fixtures.cases[index]!;
    const actual = model.predict(fixture.features);

    // Encoded vector (exact: same float64 operations).
    if (fixture.encoded) {
      const { x } = model.encode(fixture.features);
      expect(Array.from(x)).toEqual(fixture.encoded);
    }

    const report = compareResponses(actual, fixture.expected, fixtures.tolerance);
    expect(report.mismatches).toEqual([]);
    expect(report.agree).toBe(true);
    expect(actual.engine).toBe('edge');
    expect(report.contributions).toBe(model.spec.attribution.length * model.targets.length);

    // Identical ordering of the contribution rows (sorted by |shap| desc, ties by name).
    for (const t of model.targets) {
      expect(actual.explanations[t]!.contributions.map((c) => c.feature)).toEqual(
        fixture.expected.explanations[t]!.contributions.map((c) => c.feature),
      );
    }

    worst.probability = Math.max(worst.probability, report.maxDeltaProbability);
    worst.logit = Math.max(worst.logit, report.maxDeltaLogit);
    worst.base = Math.max(worst.base, report.maxDeltaBase);
    worst.shap = Math.max(worst.shap, report.maxDeltaShap);
  });

  it('stays far inside the tolerance (worst case over all fixtures)', () => {
    console.info(
      `[parity] fixtures: max |Δp| ${worst.probability.toExponential(2)}, |Δlogit| ${worst.logit.toExponential(2)}, ` +
        `|Δbase| ${worst.base.toExponential(2)}, |Δshap| ${worst.shap.toExponential(2)}`,
    );
    // The reference evaluator agrees with the native predictor to < 1e-9; the port must too.
    expect(worst.probability).toBeLessThan(1e-9);
    expect(worst.shap).toBeLessThan(1e-9);
  });
});
