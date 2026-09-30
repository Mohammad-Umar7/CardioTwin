#!/usr/bin/env node
/**
 * Regenerate `server-expectations.json`: the FastAPI server's answers (native scikit-learn / XGBoost
 * predictor) for every cohort patient plus seeded what-if variants, stored compactly so the edge
 * engine can be checked against them offline (`parity.cohort.test.ts`).
 *
 *   node frontend/src/inference/testing/generate-server-expectations.mjs [--api http://127.0.0.1:8000]
 *
 * Needs a running backend with the real predictor (`GET /api/health → predictor: "real"`).
 * Variants stay inside the schema ranges (the server rejects out-of-range values by default);
 * the out-of-range and malformed-input behaviour is covered by fixtures.json instead.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modelDir = resolve(here, '../../../public/model');
const outFile = resolve(here, 'server-expectations.json');
const apiArg = process.argv.indexOf('--api');
const API = (apiArg > 0 ? process.argv[apiArg + 1] : process.env.CARDIOTWIN_API) ?? 'http://127.0.0.1:8000';

const SEED = 20260930;
const VARIANTS_PER_PATIENT = 1;
const EDITS_PER_VARIANT = 8;
const DROPS_PER_VARIANT = 4;

/** mulberry32: tiny deterministic PRNG so the variants are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x, decimals) => Number(x.toFixed(decimals));
const SIG = (x) => Number(x.toPrecision(10));

function randomValue(feature, rand) {
  if (feature.type === 'binary') return rand() < 0.5 ? 0 : 1;
  if (feature.type === 'categorical') {
    const options = feature.options.map((o) => o.value);
    return options[Math.floor(rand() * options.length)];
  }
  const { min, max } = feature;
  const raw = min + rand() * (max - min);
  // Half snapped to the slider step, half continuous (exercises float32 split boundaries).
  if (rand() < 0.5 && feature.step) {
    const snapped = Math.min(max, Math.max(min, Math.round(raw / feature.step) * feature.step));
    return round(snapped, 6);
  }
  return Math.min(max, Math.max(min, round(raw, 4)));
}

async function main() {
  const health = await (await fetch(`${API}/api/health`)).json();
  if (health.predictor !== 'real') throw new Error(`backend at ${API} is not serving the real predictor`);
  const schema = JSON.parse(await readFile(resolve(modelDir, 'schema.json'), 'utf8'));
  const cohort = JSON.parse(await readFile(resolve(modelDir, 'cohort.json'), 'utf8'));
  const model = JSON.parse(await readFile(resolve(modelDir, 'model.json'), 'utf8'));
  if (health.model_version !== model.model_version) {
    throw new Error(`backend model ${health.model_version} ≠ public/model/model.json ${model.model_version}`);
  }

  const rand = rng(SEED);
  const rows = [];
  cohort.patients.forEach((patient, index) => {
    rows.push({ id: patient.id, kind: 'cohort', patient: patient.id, features: patient.features });
    for (let v = 0; v < VARIANTS_PER_PATIENT; v++) {
      const edits = {};
      for (let e = 0; e < EDITS_PER_VARIANT; e++) {
        const spec = schema.features[Math.floor(rand() * schema.features.length)];
        edits[spec.key] = randomValue(spec, rand);
      }
      // Every second patient's variant omits a few inputs so imputation is compared too.
      const dropped = [];
      if (index % 2 === 0) {
        const keys = Object.keys(patient.features);
        for (let d = 0; d < DROPS_PER_VARIANT; d++) {
          const key = keys[Math.floor(rand() * keys.length)];
          if (!dropped.includes(key)) dropped.push(key);
        }
      }
      const features = { ...patient.features, ...edits };
      for (const key of dropped) delete features[key];
      rows.push({ id: `${patient.id}~${v + 1}`, kind: 'what-if', patient: patient.id, edits, dropped, features });
    }
  });

  const features = model.attribution.map((a) => a.feature);
  const cases = [];
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200);
    const res = await fetch(`${API}/api/predict/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: chunk.map((r) => ({ id: r.id, features: r.features })) }),
    });
    if (!res.ok) throw new Error(`batch failed: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    for (const result of body.results) {
      const row = chunk[result.index];
      const p = result.prediction;
      if (p.engine !== 'server') throw new Error(`unexpected engine ${p.engine}`);
      const targets = {};
      for (const t of model.targets) {
        const pred = p.predictions[t];
        const ex = p.explanations[t];
        const shap = Object.fromEntries(ex.contributions.map((c) => [c.feature, c.shap]));
        targets[t] = {
          probability: pred.probability,
          logit: pred.logit,
          label: pred.label,
          risk_band: pred.risk_band,
          base_value: ex.base_value,
          calibrated_base_value: ex.calibrated_base_value,
          // SHAP in `features` (attribution) order, rounded to 10 significant digits to keep the file
          // small: |error| ≤ 5e-10 · |shap|, far below the 1e-5 contract tolerance.
          shap: features.map((f) => SIG(shap[f])),
        };
      }
      cases.push({
        id: row.id,
        kind: row.kind,
        // Inputs = cohort.json features of `patient`, overridden by `edits`, minus `dropped`.
        patient: row.patient,
        ...(row.kind === 'cohort' ? {} : { edits: row.edits, dropped: row.dropped }),
        imputed: p.imputed,
        targets,
        summary: p.summary,
      });
    }
  }

  const out = {
    description:
      'FastAPI server responses (native predictor) for every cohort patient and seeded what-if variants; ' +
      'regenerate with generate-server-expectations.mjs',
    source: `${API}/api/predict/batch`,
    model_version: health.model_version,
    seed: SEED,
    features,
    n_cases: cases.length,
    cases,
  };
  await writeFile(outFile, `${JSON.stringify(out)}\n`);
  console.info(`wrote ${cases.length} cases to ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
