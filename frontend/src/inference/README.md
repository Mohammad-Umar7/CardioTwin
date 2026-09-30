# `src/inference` — the model, in the browser

The full CardioTwin predictor (CAD + LAD/LCX/RCA, exact SHAP) evaluated client-side from
`public/model/model.json`, so a static deployment with **no backend** is fully functional and the server's
answers can be cross-checked live. A line-by-line TypeScript port of the reference evaluator
[`ml/src/cardiotwin_ml/portable.py`](../../../ml/src/cardiotwin_ml/portable.py); format spec in
[`ml/README.md` → Portable model format](../../../ml/README.md#portable-model-format).

```
features ─► normalise.ts (binary/categorical/numeric rules, imputation) ─► encode.ts (one-hot, ordinal, derived)
         ─► logistic.ts (m = b + Σ β(x−μ)/σ, linear SHAP)  ┐
         ─► xgboost.ts  (float32 splits, flat typed arrays, ├─► model.ts: Σ w·m → Platt σ(a·m+b) → label, band,
                         exact path-dependent TreeSHAP)    ┘   SHAP per raw feature, calibrated-space SHAP, summary
```

| File | Role |
| --- | --- |
| `model.ts` | `EdgeModel`: `predict()` → CONTRACTS §3.2 response (`engine: "edge"`), `score()` → predictions without SHAP |
| `client.ts`, `handler.ts`, `protocol.ts`, `../workers/inference.worker.ts` | Web Worker + promise client (`predict`, `predictBatch`, abort, in-process fallback, crash replay) |
| `shared.ts` | one app-wide worker (`getSharedInferenceClient`) |
| `ice.ts` | ICE strips in a single worker message (`computeIce`, `linspace`) |
| `parity.ts` | field-by-field response comparison at the contract tolerances |
| `verification.ts`, `enginePill.ts` | background server ⇄ edge cross-check driving the EnginePill |
| `index.ts` | public API with usage documentation |

Engine integration (server/edge resolution, `?engine=edge|server`, server→edge failover) is in
[`services/engine.ts`](../services/engine.ts).

## Numerical rules mirrored exactly

* float64 everywhere, sums in the reference order (so results agree to the last ulps, not just the tolerance);
* XGBoost routing `fround(x) < fround(split_condition)` → yes, NaN → `missing` child; margin
  `logit(base_score) + Σ leaves` in tree order;
* TreeSHAP = Lundberg et al. 2018 Algorithm 2 with node covers, same operation order as the reference;
* contributions sorted by |shap| desc, ties by name (code-point order); integral values emitted as integers.

## Evidence (`npx vitest run src/inference`)

| Check | Result |
| --- | --- |
| `fixtures.json`, all 39 cases (native predictor) | max \|Δp\| 2.2e-16, \|Δlogit\| 1.8e-15, \|Δshap\| **0**; identical labels, bands, imputed lists, values, row order |
| FastAPI server: 81 cohort patients + 81 seeded in-range what-if variants (`testing/server-expectations.json`) | max \|Δp\| 2.2e-16; SHAP equal to the 10 stored digits |
| SHAP additivity, 400 random requests (in/out of range, partial) | \|base + Σφ − logit\| < 1e-12; calibrated space and σ(calibrated output) = p exactly |
| TreeSHAP vs brute-force Shapley enumeration, every tree of every target, incl. NaN routing | < 1e-12 |
| Latency (Node) | full prediction with SHAP p95 < 1 ms; score ≈ 50 µs; 1 696-row ICE sweep ≈ 90 ms |
| Latency (Chromium, worker round trip) | p50 1.2 ms, p95 1.6 ms; model load + compile 10 ms |
| Live app (server mode) | background cross-check: 81 / 81 cohort patients agree, max \|Δp\| 2.2e-16 |

Regenerate the server expectations against a running backend:
`node frontend/src/inference/testing/generate-server-expectations.mjs --api http://127.0.0.1:8000`.

The edge engine accepts values outside the schema range (like `portable.py`; trees extrapolate flat), whereas
the server rejects them with 422 by default — the UI's controls never produce such values.
