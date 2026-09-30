/**
 * Property tests on seeded random inputs (in range, out of range, partial):
 *   1. SHAP additivity  base_value + Σ shap = output_value = logit, per target (log-odds space);
 *   2. calibrated additivity  calibrated_base_value + Σ shap_calibrated = calibrated_output_value,
 *      σ(calibrated_output_value) = probability (CONTRACTS §7.3);
 *   3. TreeSHAP = exact Shapley values of the path-dependent game, checked tree by tree against a
 *      brute-force enumeration written independently from the JSON trees (including NaN routing);
 *   4. decision invariants (label, band, summary), score() ≡ predict(), input-order independence,
 *      explicit defaults ≡ imputation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeatureSchema, FeatureVector } from '@/types/contracts';
import schemaRaw from '../../public/model/schema.json?raw';
import { EdgeModel, riskBand } from './model';
import { sigmoid } from './numeric';
import { loadModelSpec } from './testing/artifacts';
import type { PortableModelSpec, XGBoostComponentSpec, XGBoostNodeSpec } from './types';
import { compileXGBoost, toFloat32Row, xgboostMargin, xgboostShap } from './xgboost';

/** mulberry32 — deterministic, so a failure is reproducible from the seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const schema = JSON.parse(schemaRaw) as FeatureSchema;
let spec: PortableModelSpec;
let model: EdgeModel;

beforeAll(() => {
  spec = loadModelSpec();
  model = new EdgeModel(spec);
});

/** Random request: every feature present with prob. 0.85, numerics up to 25 % beyond the schema range. */
function randomRequest(rand: () => number): FeatureVector {
  const out: FeatureVector = {};
  for (const f of schema.features) {
    if (rand() > 0.85) continue;
    if (f.type === 'binary') out[f.key] = rand() < 0.5 ? 0 : 1;
    else if (f.type === 'categorical') out[f.key] = String(f.options![Math.floor(rand() * f.options!.length)]!.value);
    else {
      const lo = f.min ?? 0;
      const hi = f.max ?? 1;
      const span = hi - lo;
      out[f.key] = lo - 0.25 * span + rand() * 1.5 * span;
    }
  }
  return out;
}

const N_RANDOM = 400;

describe('ensemble properties on random inputs', () => {
  it(`SHAP is additive in log-odds and calibrated space (${N_RANDOM} requests × 4 targets)`, () => {
    const rand = rng(7);
    let worst = 0;
    for (let n = 0; n < N_RANDOM; n++) {
      const r = model.predict(randomRequest(rand));
      for (const t of model.targets) {
        const ex = r.explanations[t]!;
        const p = r.predictions[t]!;
        const sum = ex.contributions.reduce((s, c) => s + c.shap, 0);
        const sumCal = ex.contributions.reduce((s, c) => s + c.shap_calibrated, 0);
        const err = Math.abs(ex.base_value + sum - ex.output_value);
        worst = Math.max(worst, err);
        expect(err).toBeLessThan(1e-9);
        expect(ex.output_value).toBe(p.logit);
        expect(Math.abs(ex.calibrated_base_value + sumCal - ex.calibrated_output_value)).toBeLessThan(1e-9);
        expect(sigmoid(ex.calibrated_output_value)).toBe(p.probability);
        expect(ex.contributions).toHaveLength(spec.attribution.length);
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('labels, bands and summary follow the probabilities', () => {
    const rand = rng(11);
    for (let n = 0; n < 200; n++) {
      const r = model.predict(randomRequest(rand));
      let expected = 0;
      let best = -1;
      for (const t of model.targets) {
        const p = r.predictions[t]!;
        expect(p.probability).toBeGreaterThanOrEqual(0);
        expect(p.probability).toBeLessThanOrEqual(1);
        expect(p.label).toBe(p.probability >= spec.models[t]!.threshold ? 1 : 0);
        expect(p.risk_band).toBe(riskBand(spec.risk_bands, p.probability));
        const contributions = r.explanations[t]!.contributions;
        for (let i = 1; i < contributions.length; i++) {
          expect(Math.abs(contributions[i - 1]!.shap)).toBeGreaterThanOrEqual(Math.abs(contributions[i]!.shap));
        }
      }
      for (const v of spec.vessel_targets) {
        expected += r.predictions[v]!.probability;
        best = Math.max(best, r.predictions[v]!.probability);
      }
      expect(r.summary.expected_diseased_vessels).toBe(expected);
      expect(r.predictions[r.summary.highest_risk_vessel]!.probability).toBe(best);
    }
  });

  it('score() returns exactly the predictions of predict()', () => {
    const rand = rng(13);
    for (let n = 0; n < 100; n++) {
      const request = randomRequest(rand);
      const full = model.predict(request);
      const lite = model.score(request);
      expect(lite.predictions).toEqual(full.predictions);
      expect(lite.summary).toEqual(full.summary);
      expect(lite.imputed).toEqual(full.imputed);
    }
  });

  it('does not depend on the order of the request keys', () => {
    const rand = rng(17);
    const request = randomRequest(rand);
    const reversed = Object.fromEntries(Object.entries(request).reverse());
    expect(model.predict(reversed)).toEqual(model.predict(request));
  });

  it('imputing a feature equals sending its default explicitly', () => {
    const defaults = Object.fromEntries(spec.features.map((f) => [f.key, f.default]));
    const imputed = model.predict({});
    const explicit = model.predict(defaults);
    expect(imputed.imputed).toEqual(spec.features.map((f) => f.key));
    expect(explicit.imputed).toEqual([]);
    expect(explicit.predictions).toEqual(imputed.predictions);
    expect(explicit.explanations).toEqual(imputed.explanations);
  });
});

// ------------------------------------------------------------------ brute-force TreeSHAP oracle

/** Independent evaluation straight from the JSON dump. */
function jsonGoesYes(node: XGBoostNodeSpec, x: Float64Array): boolean {
  const v = x[node.split_index!]!;
  if (Number.isNaN(v)) return node.missing === node.yes;
  return Math.fround(v) < Math.fround(node.split_condition!);
}

function child(node: XGBoostNodeSpec, id: number): XGBoostNodeSpec {
  return node.children!.find((c) => c.nodeid === id)!;
}

/** Path-dependent game value v(S): known features follow x, unknown ones average children by cover. */
function expValue(node: XGBoostNodeSpec, x: Float64Array, known: ReadonlySet<number>): number {
  if (node.leaf !== undefined) return node.leaf;
  const yes = child(node, node.yes!);
  const no = child(node, node.no!);
  if (known.has(node.split_index!)) return expValue(jsonGoesYes(node, x) ? yes : no, x, known);
  return (expValue(yes, x, known) * yes.cover) / node.cover + (expValue(no, x, known) * no.cover) / node.cover;
}

function usedFeatures(node: XGBoostNodeSpec, out = new Set<number>()): Set<number> {
  if (node.leaf === undefined) {
    out.add(node.split_index!);
    for (const c of node.children ?? []) usedFeatures(c, out);
  }
  return out;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Exact Shapley values by enumerating every coalition of the tree's own features. */
function bruteForceShap(tree: XGBoostNodeSpec, x: Float64Array): Map<number, number> {
  const features = [...usedFeatures(tree)];
  const m = features.length;
  const phi = new Map<number, number>(features.map((f) => [f, 0]));
  for (let mask = 0; mask < 1 << m; mask++) {
    const known = new Set(features.filter((_, i) => mask & (1 << i)));
    const size = known.size;
    const base = expValue(tree, x, known);
    features.forEach((f, i) => {
      if (mask & (1 << i)) return;
      const weight = (factorial(size) * factorial(m - size - 1)) / factorial(m);
      const withF = expValue(tree, x, new Set([...known, f]));
      phi.set(f, phi.get(f)! + weight * (withF - base));
    });
  }
  return phi;
}

describe('TreeSHAP vs brute-force Shapley enumeration (every tree of every target)', () => {
  const singleTree = (tree: XGBoostNodeSpec): XGBoostComponentSpec => ({
    type: 'xgboost',
    name: 'probe',
    weight: 1,
    objective: 'binary:logistic',
    base_score: 0.5, // logit(0.5) = 0 → the margin is the tree output alone
    n_trees: 1,
    base_value: 0,
    trees: [tree],
  });

  it('matches for random inputs, including missing (NaN) values', () => {
    const rand = rng(23);
    const d = spec.columns.length;
    let trees = 0;
    let worst = 0;
    for (const t of spec.targets) {
      for (const comp of spec.models[t]!.components) {
        if (comp.type !== 'xgboost') continue;
        for (const tree of comp.trees) {
          trees += 1;
          const compiled = compileXGBoost(singleTree(tree), d);
          for (let trial = 0; trial < 3; trial++) {
            // Draw x around the tree's own thresholds so both branches get exercised.
            const x = new Float64Array(d);
            const stack = [tree];
            while (stack.length) {
              const node = stack.pop()!;
              if (node.leaf !== undefined) continue;
              const r = rand();
              x[node.split_index!] = r < 0.1 ? Number.NaN : node.split_condition! + (r - 0.55) * 4;
              stack.push(...(node.children ?? []));
            }
            const x32 = toFloat32Row(x);
            const phi = new Float64Array(d);
            xgboostShap(compiled, x32, phi);
            const oracle = bruteForceShap(tree, x);
            for (let j = 0; j < d; j++) {
              const err = Math.abs(phi[j]! - (oracle.get(j) ?? 0));
              worst = Math.max(worst, err);
            }
            // Efficiency: v(∅) + Σφ = f(x).
            const total = phi.reduce((s, v) => s + v, 0);
            expect(Math.abs(expValue(tree, x, new Set()) + total - xgboostMargin(compiled, x32))).toBeLessThan(1e-12);
          }
        }
      }
    }
    expect(trees).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-12);
  });
});
