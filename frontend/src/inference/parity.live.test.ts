/**
 * Adversarial parity against a RUNNING FastAPI server (native scikit-learn / XGBoost predictor).
 *
 * Opt-in, because it needs the backend and sends ~4 000 uncached predictions (≈ 3 min):
 *
 *   CARDIOTWIN_LIVE_API=http://127.0.0.1:8000 npx vitest run src/inference/parity.live
 *
 * Unlike `parity.cohort.test.ts` (captured answers, SHAP stored to 10 digits) this compares every field
 * of every response at full float64 precision, and aims at the places a port breaks:
 *   • every distinct XGBoost split threshold, on an input that reaches a split on it, probed at the float32
 *     threshold, the float32 below it, the float32 rounding midpoint (a tie) and its float64 neighbours, and
 *     the shortest decimal spelling of the threshold (CR 0.8, HB 11.9 … sit exactly on a split);
 *   • missing inputs (none sent, one dropped at a time, random subsets, explicit nulls);
 *   • categorical and binary spellings (aliases, case, labels, words) and numeric strings;
 *   • random in-range what-ifs, on-grid and off-grid;
 *   • all cohort patients;
 *   • calibrated SHAP additivity on both engines.
 * Accepted-by-one-engine-only inputs are listed explicitly (`KNOWN_ACCEPTANCE_GAPS`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeatureSchema, FeatureVector, PredictResponse, TargetId } from '@/types/contracts';
import schemaRaw from '../../public/model/schema.json?raw';
import { EdgeModel } from './model';
import { sigmoid } from './numeric';
import { compareResponses } from './parity';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import { SplitProbeBuilder, collectSplitSites, type ProbeKind } from './testing/splitProbes';
import type { EdgeContribution, EdgeExplanation, EdgeFeatureInput, EdgePredictResponse } from './types';

const API = (process.env.CARDIOTWIN_LIVE_API ?? '').replace(/\/+$/, '');
const BATCH = 256;

// ------------------------------------------------------------------------------ comparison

interface Worst {
  probability: number;
  logit: number;
  base: number;
  calibrated: number;
  shap: number;
  shapCalibrated: number;
  expected: number;
  additivityServer: number;
  additivityEdge: number;
  compared: number;
  orderDifferences: number;
  boundaryTies: number;
}

const worst: Worst = {
  probability: 0,
  logit: 0,
  base: 0,
  calibrated: 0,
  shap: 0,
  shapCalibrated: 0,
  expected: 0,
  additivityServer: 0,
  additivityEdge: 0,
  compared: 0,
  orderDifferences: 0,
  boundaryTies: 0,
};

type ServerExplanation = EdgeExplanation;

/** σ(calibrated_base_value + Σ shap_calibrated) vs the probability, in probability space. */
function calibratedAdditivity(ex: ServerExplanation, p: number): number {
  let total = ex.calibrated_base_value;
  for (const c of ex.contributions) total += c.shap_calibrated;
  return Math.abs(sigmoid(total) - p);
}

const TIGHT = { probability: 1e-12, logit: 1e-12, base_value: 1e-12, shap: 1e-12 };

/**
 * Strict comparison: everything the UI renders must be identical (labels, bands, imputed list, values,
 * highest vessel) — except explained boundary ties (`parity.compareResponses`) — and every float within
 * `tol` (absolute). Returns the list of differences.
 */
function diff(edge: EdgePredictResponse, server: PredictResponse, tol = 1e-12): string[] {
  const out: string[] = [];
  const ties = compareResponses(edge, server, TIGHT).boundaryTies;
  worst.boundaryTies += ties.length;
  const tied = (prefix: string) => ties.some((m) => m.startsWith(prefix));
  const num = (field: string, a: number, e: number, bucket: keyof Worst) => {
    const d = Math.abs(a - e);
    if (!(d <= tol)) out.push(`${field}: edge ${a} server ${e} (|Δ| ${d.toExponential(2)})`);
    if (Number.isFinite(d)) worst[bucket] = Math.max(worst[bucket], d);
  };
  if (edge.model_version !== server.model_version) out.push(`model_version ${edge.model_version} ≠ ${server.model_version}`);
  if (server.engine !== 'server') out.push(`server answered as '${server.engine}'`);
  if (JSON.stringify(edge.imputed) !== JSON.stringify(server.imputed)) {
    out.push(`imputed [${edge.imputed.join(', ')}] ≠ [${server.imputed.join(', ')}]`);
  }
  for (const t of Object.keys(server.predictions) as TargetId[]) {
    const pe = edge.predictions[t];
    const ps = server.predictions[t];
    if (!pe) {
      out.push(`${t}: missing on the edge`);
      continue;
    }
    num(`${t}.probability`, pe.probability, ps.probability, 'probability');
    num(`${t}.logit`, pe.logit, ps.logit, 'logit');
    if (pe.threshold !== ps.threshold) out.push(`${t}.threshold ${pe.threshold} ≠ ${ps.threshold}`);
    if (pe.label !== ps.label && !tied(`${t}.label`)) out.push(`${t}.label ${pe.label} ≠ ${ps.label} (p = ${ps.probability})`);
    if (pe.risk_band !== ps.risk_band && !tied(`${t}.risk_band`)) out.push(`${t}.risk_band ${pe.risk_band} ≠ ${ps.risk_band}`);
    const ee = edge.explanations[t];
    const es = server.explanations[t] as ServerExplanation;
    num(`${t}.base_value`, ee.base_value, es.base_value, 'base');
    num(`${t}.output_value`, ee.output_value, es.output_value, 'logit');
    num(`${t}.calibrated_base_value`, ee.calibrated_base_value, es.calibrated_base_value, 'calibrated');
    num(`${t}.calibrated_output_value`, ee.calibrated_output_value, es.calibrated_output_value, 'calibrated');
    worst.additivityServer = Math.max(worst.additivityServer, calibratedAdditivity(es, ps.probability));
    worst.additivityEdge = Math.max(worst.additivityEdge, calibratedAdditivity(ee, pe.probability));
    if (ee.contributions.length !== es.contributions.length) {
      out.push(`${t}: ${ee.contributions.length} contributions ≠ ${es.contributions.length}`);
    }
    const byFeature = new Map<string, EdgeContribution>(ee.contributions.map((c) => [c.feature, c]));
    es.contributions.forEach((cs, i) => {
      const ce = byFeature.get(cs.feature);
      if (!ce) {
        out.push(`${t}.${cs.feature}: missing on the edge`);
        return;
      }
      if (ee.contributions[i]?.feature !== cs.feature) worst.orderDifferences += 1;
      num(`${t}.${cs.feature}.shap`, ce.shap, cs.shap, 'shap');
      num(`${t}.${cs.feature}.shap_calibrated`, ce.shap_calibrated, cs.shap_calibrated, 'shapCalibrated');
      const same = typeof ce.value === 'number' && typeof cs.value === 'number' ? ce.value === cs.value : ce.value === cs.value;
      if (!same) out.push(`${t}.${cs.feature}.value ${String(ce.value)} ≠ ${String(cs.value)}`);
    });
  }
  num('summary.expected_diseased_vessels', edge.summary.expected_diseased_vessels, server.summary.expected_diseased_vessels, 'expected');
  if (edge.summary.highest_risk_vessel !== server.summary.highest_risk_vessel && !tied('summary.highest_risk_vessel')) {
    out.push(`summary.highest_risk_vessel ${edge.summary.highest_risk_vessel} ≠ ${server.summary.highest_risk_vessel}`);
  }
  worst.compared += 1;
  return out;
}

// ------------------------------------------------------------------------------ server access

async function postJson(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function serverBatch(rows: FeatureVector[]): Promise<PredictResponse[]> {
  const out: PredictResponse[] = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const { status, json } = await postJson('/api/predict/batch', { rows: chunk.map((features, i) => ({ id: String(start + i), features })) });
    if (status !== 200) throw new Error(`batch ${start}: HTTP ${status} ${JSON.stringify(json).slice(0, 400)}`);
    for (const r of (json as { results: { prediction: PredictResponse }[] }).results) out.push(r.prediction);
  }
  return out;
}

/** Compare a set of inputs; returns the failures (capped) and asserts nothing itself. */
async function compareAll(rows: FeatureVector[], label: (i: number) => string): Promise<string[]> {
  const server = await serverBatch(rows);
  const failures: string[] = [];
  rows.forEach((row, i) => {
    const problems = diff(model.predict(row), server[i]!);
    if (problems.length > 0 && failures.length < 20) failures.push(`${label(i)}: ${problems.slice(0, 3).join('; ')}`);
  });
  return failures;
}

// ------------------------------------------------------------------------------ fixtures

const schema = JSON.parse(schemaRaw) as FeatureSchema;
let model: EdgeModel;
let cohort: ReturnType<typeof loadCohort>['patients'];

/** Deterministic PRNG (mulberry32) so a failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPatient(next: () => number, onGrid: boolean): FeatureVector {
  const out: FeatureVector = {};
  for (const f of schema.features) {
    if (f.type === 'binary') out[f.key] = next() < 0.5 ? 0 : 1;
    else if (f.type === 'categorical') {
      const options = f.options ?? [];
      out[f.key] = String(options[Math.floor(next() * options.length)]!.value);
    } else {
      const lo = f.min!;
      const hi = f.max!;
      let v = lo + next() * (hi - lo);
      if (onGrid && f.step) v = Math.min(hi, Math.max(lo, lo + Math.round((v - lo) / f.step) * f.step));
      out[f.key] = v;
    }
  }
  return out;
}

const live = API.length > 0;

describe.skipIf(!live)(`edge engine vs live server (${API || 'set CARDIOTWIN_LIVE_API'})`, () => {
  beforeAll(async () => {
    model = new EdgeModel(loadModelSpec());
    cohort = loadCohort().patients;
    const health = (await (await fetch(`${API}/api/health`)).json()) as { status: string; model_version: string; predictor: string };
    expect(health.status).toBe('ok');
    expect(health.predictor).toBe('real');
    expect(health.model_version).toBe(model.modelVersion);
  });

  afterAll(() => {
    const e = (x: number) => x.toExponential(2);
    console.info(
      `[live parity] ${worst.compared} responses · max |Δp| ${e(worst.probability)} · |Δlogit| ${e(worst.logit)} · ` +
        `|Δbase| ${e(worst.base)} · |Δcalibrated| ${e(worst.calibrated)} · |Δshap| ${e(worst.shap)} · ` +
        `|Δshap_cal| ${e(worst.shapCalibrated)} · |Δexpected| ${e(worst.expected)} · ` +
        `σ-additivity server ${e(worst.additivityServer)} edge ${e(worst.additivityEdge)} · ` +
        `contribution rows ranked differently: ${worst.orderDifferences} · explained boundary ties: ${worst.boundaryTies}`,
    );
  });

  it('routes identically at, around and between the float32 neighbours of every split threshold', async () => {
    // One input per distinct (column, threshold) that REACHES a split on it (`splitProbes.ts`), probed at
    // the values where float32 vs float64 handling diverges. The full ladder of probe kinds runs offline
    // in `splitRouting.test.ts`; the server gets the subset that separates the rounding rules (~3 000 rows).
    const kinds = new Set<ProbeKind>(['threshold', 'float32-below', 'tie-below', 'tie-below−ulp', 'tie-below+ulp', 'decimal', 'decimal−ulp', 'category']);
    const spec = loadModelSpec();
    const builder = new SplitProbeBuilder(spec, schema);
    const sites = collectSplitSites(spec);
    const cases = builder.distinctThresholdCases(sites, kinds);
    expect(cases.length).toBe(SplitProbeBuilder.distinctThresholds(sites));
    const rows: FeatureVector[] = [];
    const labels: string[] = [];
    for (const { site, feature, base, probes } of cases) {
      for (const probe of probes) {
        rows.push({ ...base, [feature]: probe.value });
        labels.push(`${site.target} tree ${site.tree} node ${site.nodeid}: ${feature}=${String(probe.value)} (${probe.kind}, split < ${site.threshold})`);
      }
    }
    console.info(`[live parity] split probes: ${cases.length} thresholds, ${rows.length} rows`);
    const failures = await compareAll(rows, (i) => labels[i]!);
    expect(failures).toEqual([]);
  }, 600_000);

  it('imputes identically: nothing sent, each feature dropped in turn, random subsets, explicit nulls', async () => {
    const next = rng(7);
    const rows: FeatureVector[] = [{}];
    const labels = ['{}'];
    const base = cohort[1]!.features;
    for (const key of Object.keys(base)) {
      const { [key]: _dropped, ...rest } = base;
      rows.push(rest);
      labels.push(`without ${key}`);
    }
    for (let i = 0; i < 60; i++) {
      const p = cohort[Math.floor(next() * cohort.length)]!.features;
      const kept: FeatureVector = {};
      for (const [k, v] of Object.entries(p)) if (next() < 0.5) kept[k] = v;
      rows.push(kept);
      labels.push(`random subset ${i}`);
    }
    expect(await compareAll(rows, (i) => labels[i]!)).toEqual([]);

    // null = "impute": the server drops it in validation, the edge in normalisation.
    const withNulls = { ...base, Age: null, BBB: null, HTN: null } as unknown as FeatureVector;
    const { json } = await postJson('/api/predict', { features: withNulls });
    const problems = diff(model.predict(withNulls as EdgeFeatureInput), json as PredictResponse);
    expect(problems).toEqual([]);
    expect((json as PredictResponse).imputed).toEqual(expect.arrayContaining(['Age', 'HTN', 'BBB']));
  }, 120_000);

  it('agrees on random in-range what-ifs, on the input grid and off it', async () => {
    const next = rng(20260930);
    const rows: FeatureVector[] = [];
    for (let i = 0; i < 400; i++) rows.push(randomPatient(next, i % 2 === 0));
    expect(await compareAll(rows, (i) => `random ${i}`)).toEqual([]);
  }, 300_000);

  /**
   * Spellings a client might send. Each must be accepted by both engines with identical results, or
   * rejected by both — except the entries of KNOWN_ACCEPTANCE_GAPS.
   */
  const SPELLINGS: [string, unknown][] = [
    ['Sex', 'Male'],
    ['Sex', 'Female'],
    ['Sex', 'female'],
    ['Sex', ' FEMALE '],
    ['Sex', 'Fmale'],
    ['Sex', 'fmale'],
    ['Sex', 'F'],
    ['Sex', 1],
    ['Sex', ''],
    ['BBB', 'N'],
    ['BBB', 'LBBB'],
    ['BBB', 'rbbb'],
    ['BBB', 'None'],
    ['BBB', 'Left bundle branch block'],
    ['BBB', 'X'],
    ['VHD', 'N'],
    ['VHD', 'mild'],
    ['VHD', 'Mild'],
    ['VHD', 'MODERATE'],
    ['VHD', 'Severe'],
    ['VHD', 'None'],
    ['VHD', 2],
    ['DM', 1],
    ['DM', 0],
    ['DM', 1.0],
    ['DM', true],
    ['DM', false],
    ['DM', '1'],
    ['DM', 'Y'],
    ['DM', 'n'],
    ['DM', ' Yes '],
    ['DM', 'false'],
    ['DM', 'T'],
    ['DM', 2],
    ['DM', 0.5],
    ['DM', -1],
    ['DM', ''],
    ['Age', 63],
    ['Age', 63.5],
    ['Age', '63'],
    ['Age', ' 63 '],
    ['Age', '6.3e1'],
    ['Age', '+63'],
    ['Age', '063'],
    ['Age', '6_3'],
    ['Age', '63.'],
    ['Age', '0x3F'],
    ['Age', 'abc'],
    ['Age', ''],
    ['Age', 'nan'],
    ['Age', 'inf'],
    ['Age', true],
    ['CR', 0.8],
    ['CR', '0.8'],
    ['HB', 11.9],
    ['K', '4.1'],
  ];

  /** Inputs one engine accepts and the other rejects, by design. Keep this list short and explained. */
  const KNOWN_ACCEPTANCE_GAPS = new Set<string>([
    // The server also matches schema option *labels*; model.json only carries option values + aliases.
    'BBB=None',
    'BBB=Left bundle branch block',
    'VHD=None',
  ]);

  it('accepts and rejects the same spellings and encodes them identically', async () => {
    const base = cohort[2]!.features;
    const gaps: string[] = [];
    const failures: string[] = [];
    for (const [key, value] of SPELLINGS) {
      const features = { ...base, [key]: value } as FeatureVector;
      const name = `${key}=${String(value)}`;
      const { status, json } = await postJson('/api/predict', { features });
      let edge: EdgePredictResponse | null = null;
      let edgeError: string | null = null;
      try {
        edge = model.predict(features as EdgeFeatureInput);
      } catch (error) {
        edgeError = (error as Error).message;
      }
      const serverOk = status === 200;
      if (serverOk !== (edge !== null)) {
        gaps.push(name);
        if (!KNOWN_ACCEPTANCE_GAPS.has(name)) {
          failures.push(`${name}: server ${status}, edge ${edgeError ?? 'accepted'}`);
        }
        continue;
      }
      if (serverOk && edge) {
        const problems = diff(edge, json as PredictResponse);
        if (problems.length > 0) failures.push(`${name}: ${problems.slice(0, 3).join('; ')}`);
      } else if (status !== 422) {
        failures.push(`${name}: server answered ${status}`);
      }
    }
    expect(failures).toEqual([]);
    expect(new Set(gaps)).toEqual(KNOWN_ACCEPTANCE_GAPS);
  }, 120_000);

  it('turns label flips at the decision threshold into explained boundary ties, never disagreements', async () => {
    // Bisect each smooth threshold crossing (logistic part only, trees constant) to adjacent doubles on the
    // edge, then ask the server just around it. Edge and server differ by an ulp or two in p, so their
    // labels can differ there (e.g. CAD, P-014, Age = 47.27671142066387); compareResponses must explain it.
    const f64 = new Float64Array(1);
    const u64 = new BigUint64Array(f64.buffer);
    const ulps = (x: number, n: number) => ((f64[0] = x), (u64[0] = u64[0]! + BigInt(n)), f64[0]!);
    const ranges = Object.fromEntries(schema.features.filter((f) => f.type === 'numeric').map((f) => [f.key, [f.min!, f.max!] as const]));
    const rows: FeatureVector[] = [];
    let crossings = 0;
    for (const target of model.targets) {
      for (const patient of cohort.slice(0, 20)) {
        for (const key of ['Age', 'BP', 'TG', 'FBS']) {
          const at = (v: number) => model.score({ ...patient.features, [key]: v }).predictions[target]!;
          let [lo, hi] = ranges[key]!;
          const start = at(lo).label;
          if (at(hi).label === start) continue;
          for (let i = 0; i < 200; i++) {
            const mid = (lo + hi) / 2;
            if (mid === lo || mid === hi) break;
            if (at(mid).label === start) lo = mid;
            else hi = mid;
          }
          if (Math.abs(at(hi).probability - at(lo).probability) > 1e-12) continue; // a tree step, not a tie
          crossings += 1;
          for (let d = -48; d <= 48; d += 8) rows.push({ ...patient.features, [key]: ulps(lo, d) });
        }
      }
    }
    const tiesBefore = worst.boundaryTies;
    expect(await compareAll(rows, (i) => `crossing row ${i}`)).toEqual([]);
    console.info(`[live parity] ${crossings} smooth threshold crossings, ${rows.length} rows, ${worst.boundaryTies - tiesBefore} explained label ties`);
    expect(crossings).toBeGreaterThan(10);
  }, 300_000);

  it('matches every cohort patient field by field at full precision', async () => {
    const rows = cohort.map((p) => p.features);
    expect(await compareAll(rows, (i) => cohort[i]!.id)).toEqual([]);
  }, 120_000);

  it('satisfies σ(calibrated_base_value + Σ shap_calibrated) = probability on both engines', () => {
    // Accumulated by every comparison above.
    expect(worst.compared).toBeGreaterThan(3000);
    expect(worst.additivityServer).toBeLessThan(1e-12);
    expect(worst.additivityEdge).toBeLessThan(1e-12);
  });

  it('agrees to machine precision', () => {
    expect(worst.probability).toBeLessThan(1e-14);
    expect(worst.logit).toBeLessThan(1e-12);
    expect(worst.shap).toBeLessThan(1e-12);
    expect(worst.shapCalibrated).toBeLessThan(1e-12);
  });
});
