/**
 * Latency budget (task brief: < 5 ms per prediction, no GPU). Measured on the synchronous model, i.e.
 * the work the worker does per request; the worker round trip adds ≈ 0.1–0.5 ms in browsers.
 * Also sizes the ICE workload (DESIGN_SYSTEM §6: 54 features × 32 samples for one target).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeatureVector } from '@/types/contracts';
import { EdgeModel } from './model';
import { loadCohort, loadModelSpec } from './testing/artifacts';

let model: EdgeModel;
let rows: FeatureVector[];

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
  rows = loadCohort().patients.map((p) => p.features);
  for (let i = 0; i < 200; i++) model.predict(rows[i % rows.length]!); // JIT warm-up
});

describe('edge engine latency', () => {
  it('full prediction with exact SHAP: p95 < 5 ms', () => {
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const row of rows) {
        const t0 = performance.now();
        model.predict(row);
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    console.info(`[perf] predict (4 targets, SHAP): p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms over ${times.length} calls`);
    expect(p95).toBeLessThan(5);
  });

  it('model compile (parse excluded) stays well under a frame budget', () => {
    const spec = loadModelSpec();
    const t0 = performance.now();
    new EdgeModel(spec);
    const ms = performance.now() - t0;
    console.info(`[perf] compile: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(100);
  });

  it('an ICE sweep (53 features × 32 samples, scores only) runs in < 250 ms', () => {
    const base = rows[0]!;
    const numeric = model.spec.features.filter((f) => f.type === 'numeric');
    const sweep: FeatureVector[] = [];
    for (const f of model.spec.features) {
      for (let k = 0; k < 32; k++) {
        const value = f.type === 'numeric' ? Number(base[f.key] ?? f.default) * (0.5 + k / 31) : k % 2;
        sweep.push({ ...base, [f.key]: f.type === 'categorical' ? base[f.key]! : value });
      }
    }
    expect(numeric.length).toBeGreaterThan(10);
    const t0 = performance.now();
    for (const row of sweep) model.score(row);
    const ms = performance.now() - t0;
    console.info(`[perf] ICE sweep: ${sweep.length} scores in ${ms.toFixed(1)} ms (${((1000 * ms) / sweep.length).toFixed(1)} µs each)`);
    expect(ms).toBeLessThan(250);
  });
});
