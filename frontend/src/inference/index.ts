/**
 * `@/inference` — the CardioTwin model, running in the browser.
 *
 * A line-by-line TypeScript port of `ml/src/cardiotwin_ml/portable.py` (the reference evaluator of the
 * portable model `public/model/model.json`, format documented in `ml/README.md` → "Portable model
 * format"): input normalisation and imputation, encoders, logistic components, XGBoost trees routed in
 * float32 exactly like XGBoost, exact path-dependent TreeSHAP, the margin ensemble, Platt calibration,
 * thresholds, risk bands, raw-feature SHAP aggregation and calibrated-space SHAP (CONTRACTS §7.3).
 * Output: exactly the §3.2 `PredictResponse`, with `engine: "edge"`.
 *
 * Verified (vitest, `src/inference/*.test.ts`):
 *   • every case of `fixtures.json` — max |Δp| 2.2e-16, |Δshap| 0 (contract: 1e-6 / 1e-5);
 *   • all 81 cohort patients + 81 seeded what-if variants vs the FastAPI server — |Δp| ≤ 2.2e-16;
 *   • SHAP additivity (log-odds and calibrated) on 400 random requests, and TreeSHAP = brute-force
 *     Shapley enumeration on every tree of every target (including NaN routing);
 *   • latency: p95 < 1 ms per full prediction with SHAP (budget 5 ms), ≈ 50 µs per score.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────── usage
 *
 * The app shares ONE worker (one download + compile of model.json):
 *
 *   import { getSharedInferenceClient } from '@/inference';
 *   const client = getSharedInferenceClient();
 *   await client.ready();                        // ModelInfo; rejects if model.json is missing/invalid
 *
 *   // One full prediction with SHAP explanations (what EdgeEngine.predict uses):
 *   const r = await client.predict(features, { signal });           // EdgePredictResponse
 *
 *   // Many predictions in ONE message, row order preserved. Default = scores only (probability, label,
 *   // threshold, risk_band, logit per target + summary; no SHAP, ~10× cheaper):
 *   const scores = await client.predictBatch(rows, { signal });     // EdgeScore[]
 *   const full = await client.predictBatch(rows, { explain: true }); // EdgePredictResponse[]
 *
 *   • Abort with an AbortSignal: the promise rejects at once with an AbortError and the worker stops a
 *     running batch between 8 ms slices — abort the previous sweep whenever the inputs change.
 *   • A bad row rejects the whole batch with `BatchRowError` (`.row`, `.features`).
 *   • Keys are raw dataset columns (CONTRACTS §0); missing keys are imputed (listed in `imputed`);
 *     binaries accept 0/1/true/"Y"/"no"…, categoricals are case-insensitive. Leakage keys
 *     (LAD/LCX/RCA/Cath) are unknown to the model — strip them first (`sanitizeFeatures`, `computeIce`
 *     does it for you).
 *
 * ICE strips (DESIGN_SYSTEM §6 "Prediction update" step 8 — 53 features × 32 samples ≈ 100 ms in the worker):
 *
 *   import { computeIce, linspace } from '@/inference';
 *   const strips = await computeIce(client, patientFeatures, [
 *     { key: 'Age', values: linspace(30, 86, 32, 1) },
 *     { key: 'DM', values: [0, 1] },
 *     { key: 'VHD', values: ['N', 'mild', 'Moderate', 'Severe'] },
 *   ], { signal });
 *   strips[0].probabilities.LAD   // number[] aligned with strips[0].values
 *
 * Counterfactual captions ("if DM were 0, LAD 72 % → 58 %"): build the flipped rows and score them in
 * one batch — `client.predictBatch(options.map((v) => ({ ...features, DM: v })))`.
 *
 * Synchronous use (tests, Node scripts): `new EdgeModel(spec).predict(features)` / `.score(features)`.
 * Engine-level integration (server/edge choice, `?engine=` override, failover, cross-check pill) lives
 * in `services/engine.ts` and `inference/verification.ts`.
 */
export { BatchRowError, InferenceClient, createInferenceWorker } from './client';
export type { BatchOptions, InferenceClientOptions, InferenceRuntime, ModelSource, RequestOptions } from './client';
export { FeatureInputError, ModelFormatError } from './errors';
export { computeIce, iceRows, linspace } from './ice';
export type { IceFeatureRequest, IceStrip } from './ice';
export { EdgeModel, compileModel, riskBand } from './model';
export { CONTRACT_TOLERANCE, compareResponses } from './parity';
export type { ParityReport, ParityTolerance } from './parity';
export type { ModelInfo } from './protocol';
export { getSharedInferenceClient, portableModelUrl, resetSharedInferenceClient } from './shared';
export type {
  EdgeContribution,
  EdgeExplanation,
  EdgeFeatureInput,
  EdgePredictResponse,
  EdgeScore,
  PortableModelSpec,
} from './types';
export { engineVerifier, summarizeVerification, useEngineVerification, useVerificationStore } from './verification';
export type { VerificationRecord, VerificationState, VerificationSummary } from './verification';
