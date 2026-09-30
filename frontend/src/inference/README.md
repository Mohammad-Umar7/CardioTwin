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

## Adversarial verification

| Attack (test file) | Result |
| --- | --- |
| Every distinct XGBoost split threshold (444 / 444), on an input solved to *reach* a split on it, probed at the float32 threshold, its float32 neighbours, the float32 rounding tie and its float64 neighbours, and the decimal a user types (CR 0.8 is 0.800000011920929 in float32) — 4 130 probes, 428 ties; the expected branch comes from a bit-level oracle, not `Math.fround` (`splitRouting.test.ts`) | every probe routed as the oracle says; a float64 compare, `<=` or float32 truncation would each misroute > 100 of them |
| Live server, full float64 precision, every field (`parity.live.test.ts`, opt-in): the split probes above (2 686 rows), imputation (none sent, each key dropped, random subsets, `null`), 400 random what-ifs on and off the input grid, 56 spellings, all 81 cohort patients | 3 800+ responses: max \|Δp\| 2.2e-16, \|Δlogit\| 1.8e-15, \|Δshap\| and \|Δshap_calibrated\| **exactly 0**, identical contribution order; σ(calibrated base + Σ shap_calibrated) = p to 4.4e-16 on both engines |
| Label flips at the decision threshold: 39 smooth crossings bisected to adjacent doubles, server probed around each | 12 inputs where the edge is 1 ulp below the threshold and the server exactly on it (e.g. CAD, P-014, Age = 47.27671142066387): `compareResponses` reports them as *boundary ties*, not disagreements (`parity.test.ts`) |
| Input acceptance | identical accept/reject and encoding for aliases (`Fmale`), case, `Y`/`no`/`true`, numeric strings (`' 63 '`, `6.3e1`, `6_3`); out-of-range values → the same 422 message from both engines (EdgeEngine enforces the schema range like the server's default policy). Known gap: the server also accepts option *labels* (`BBB = "None"`) |
| Worker faults (`client.lifecycle.test.ts`, `client.lazy.test.ts`): crash mid-batch, `messageerror`, uncloneable input, abort racing a crash, abort while `model.json` is still loading, stale responses, evaluator chunk failing to load | every request settles once, correctly or with a clear error; nothing stays pending |
| Failover over real sockets (`failover.network.test.ts`): API on a dead port, server crash → restart, HTTP 500, 422, a server that never answers | edge takes over with identical numbers (Δp = 0) and hands back to the server; 422s are surfaced; a hung server fails over after 6 s (`FAILOVER_TIMEOUT_MS`) |

Run the live suite against a running backend (≈ 3 min, ~4 000 uncached predictions):
`CARDIOTWIN_LIVE_API=http://127.0.0.1:8000 npx vitest run src/inference/parity.live`.

**Bundle.** The worker chunk is 15.2 kB (6.0 kB gzip); the main-thread fallback evaluator is a separate
15.1 kB chunk loaded only if the worker cannot run, so the entry chunk carries none of the model code.
`model.json` is 493 kB (99 kB gzip), fetched once by the worker.

**Range policy.** `EdgeModel` accepts any finite value (like `portable.py`; trees extrapolate flat).
`EdgeEngine` — what the app uses — rejects numeric values outside the schema `min`/`max` with the
server's 422 wording, so both engines refuse to extrapolate beyond the training cohort.
