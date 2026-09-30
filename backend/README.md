# CardioTwin API

FastAPI service that serves the trained CardioTwin models: overall **CAD** status plus stenosis of the
**LAD**, **LCX** and **RCA**, each with calibrated probabilities, risk bands and per-feature **SHAP**
explanations. It implements the REST contract in [`docs/CONTRACTS.md`](../docs/CONTRACTS.md) §3 and, when
the frontend has been built, also serves the 3D app, so a single process gives one URL for the whole demo.

> **Clinical safety.** Decision-support / educational prototype only. Risk is estimated per vessel (never
> lesion localisation) and is not a substitute for formal diagnostic imaging or clinical judgement.

## Prerequisites

* Python 3.11 with the repository virtual environment (`.venv`)
* The ML package and its trained artifacts in `ml/artifacts/` (see [`ml/README.md`](../ml/README.md))
* Optional: a production build of the frontend in `frontend/dist/` (`npm --prefix frontend run build`)

```bash
./.venv/Scripts/python -m pip install -r backend/requirements-dev.txt
./.venv/Scripts/python -m pip install -e ml          # provides cardiotwin_ml.inference
```

(On macOS/Linux use `.venv/bin/python`.) If `cardiotwin_ml` is not installed, the service falls back to
importing it from the in-repo `ml/src` checkout.

## Run

From the repository root:

```bash
# development (auto-reload)
./.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload

# single-URL demo: build the SPA once, then one process serves everything
npm --prefix frontend run build
./.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000
#   http://localhost:8000        3D app
#   http://localhost:8000/docs   interactive API docs (Swagger UI)

# UI work without trained artifacts: deterministic synthetic predictor (reported as "fake" in /api/health)
CARDIOTWIN_PREDICTOR=fake ./.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload
```

Startup loads the model once. If the artifacts are missing or incompatible the process exits with a
message naming the missing files and the fix, e.g.
`CardioTwin API cannot start: ML artifacts directory ml/artifacts is incomplete; missing: cohort.json …`.

### Docker

```bash
docker compose up --build          # http://localhost:8000
```

`backend/Dockerfile` (build context = repository root) builds the SPA in a Node stage, installs the ML
package and the API on `python:3.11-slim`, runs as a non-root user, honours `$PORT` and has a
`HEALTHCHECK` on `/api/health`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status, model version, targets, predictor kind, cache stats, disclaimer |
| GET | `/api/schema` | Feature schema (§2): groups, types, units, bounds, defaults, reference ranges, options |
| GET | `/api/metrics` | Evaluation report (§4): CV + held-out metrics, curves, leaderboards, global SHAP |
| GET | `/api/model-card` | Markdown model card (`docs/MODEL_CARD.md`, or generated from the metrics) |
| GET | `/api/cohort` | Demo patients with angiography ground truth (§3.3) |
| GET | `/api/cohort/{id}` | One demo patient |
| GET | `/api/cohort/{id}/prediction` | Server prediction for a demo patient + per-target agreement with ground truth |
| POST | `/api/predict` | Predict CAD/LAD/LCX/RCA with SHAP explanations (§3.2) |
| POST | `/api/predict/batch` | Up to 256 rows per call, results in request order |

`GET /docs` (Swagger UI) and `GET /redoc` document every model with examples.

### Predict

```bash
curl -s localhost:8000/api/predict -H 'content-type: application/json' \
  -d '{"features": {"Age": 62, "Sex": "Male", "DM": 1, "Typical Chest Pain": 1, "EF-TTE": 45}}'
```

* Keys are the exact dataset column names from `/api/schema`; missing keys (or `null`) are imputed with the
  schema default and listed in `imputed`.
* Binary features take `0`/`1` (`true`/`false`, `"Y"`/`"N"` also accepted); categorical values match the
  schema options case-insensitively (the dataset's `"Fmale"` spelling maps to `"Female"`).
* `LAD`, `LCX`, `RCA` and `Cath` are outcomes and are rejected as inputs (target leakage).
* Numeric values must lie inside the schema `min`/`max`, the range the model was trained and validated on
  (422 with the allowed range otherwise). With `CARDIOTWIN_OUT_OF_RANGE=warn` they are predicted instead
  (trees extrapolate flat, the logistic component linearly) and reported in an added `warnings` array.
* Identical requests are answered from an LRU cache (`X-Cache: HIT`); demo-cohort patients are
  precomputed at startup, so selecting one in the UI never waits for the model.

### Errors

Every error uses one envelope; 422s keep FastAPI's item format and report **all** problems at once:

```json
{
  "error": "validation_error",
  "message": "features.Age: Age=150 is outside the allowed range 30–86 years (+1 more)",
  "detail": [
    {"type": "out_of_range", "loc": ["body", "features", "Age"], "msg": "Age=150 is outside the allowed range 30–86 years",
     "input": 150, "ctx": {"min": 30, "max": 86, "unit": "years"}},
    {"type": "unknown_feature", "loc": ["body", "features", "age"], "msg": "Unknown feature 'age'; did you mean 'Age'? …",
     "input": 3, "ctx": {"suggestions": ["Age"]}}
  ],
  "request_id": "c827236f5c774dada372d9443792c7f9"
}
```

Error types: `unknown_feature`, `leakage_feature`, `type_error`, `finite_number`, `out_of_range`,
`binary_value`, `invalid_option`, `model_rejected_input`, `too_long`/`too_short` (batch size), plus pydantic's own types for
malformed bodies. Other codes: `not_found` (404), `model_not_ready` (503), `model_contract_error` and
`internal_error` (500).

## Configuration

All settings are optional environment variables (relative paths resolve against the repository root):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CARDIOTWIN_ARTIFACTS` | `ml/artifacts` | Trained artifacts directory |
| `CARDIOTWIN_PREDICTOR` | `real` | `real` (cardiotwin_ml) or `fake` (synthetic, UI development only) |
| `CARDIOTWIN_CORS_ORIGINS` | Vite dev/preview origins | Comma-separated origins, or `*` |
| `CARDIOTWIN_SERVE_FRONTEND` | `1` | `0` disables SPA serving; a path enables it from that directory |
| `CARDIOTWIN_FRONTEND_DIST` | `frontend/dist` | Built SPA location |
| `CARDIOTWIN_MODEL_CARD` | `docs/MODEL_CARD.md` | Markdown served by `/api/model-card` |
| `CARDIOTWIN_CACHE_SIZE` | `2048` | LRU capacity for identical predictions (`0` disables) |
| `CARDIOTWIN_WARM_CACHE` | `1` | Precompute every demo-cohort prediction in the background after startup |
| `CARDIOTWIN_OUT_OF_RANGE` | `reject` | Numeric values outside the schema `min`/`max` (the training-cohort range): `reject` → 422 with the range; `warn` → predict and list them in `warnings` |
| `CARDIOTWIN_BATCH_MAX_ROWS` | `256` | Batch limit (1–256) |
| `CARDIOTWIN_LOG_LEVEL` | `INFO` | Python log level |
| `CARDIOTWIN_LOG_FORMAT` | `json` | `json` (one object per line, with `request_id`) or `text` |
| `CARDIOTWIN_GZIP_MIN_SIZE` | `1024` | Minimum response size (bytes) for gzip |

## Design

```
request ─► RequestContextMiddleware (X-Request-ID, X-Response-Time-ms, access log, JSON 500)
        ─► CORS ─► GZip ─► router
                          └─► PredictionService: FeatureValidator ─► LRU cache ─► Predictor ─► contract check ─► JSON bytes
```

* **Predictor boundary** — the API depends only on the structural `Predictor` protocol
  (`schema`, `metrics`, `cohort`, `version`, `predict`) in `app/predictors/base.py`. Production uses
  `cardiotwin_ml.inference.CardioTwinPredictor.load(artifacts_dir)` (imported lazily);
  `FakePredictor` is a deterministic additive model with exact SHAP values for tests and UI development.
* **Schema-driven** — validation, imputation reporting, examples in errors and the generated model card all
  derive from `schema.json`. Adding a clinical feature, a new target or a different model requires no API
  change: retrain, and the new schema flows through (targets are ordered CAD, LAD, LCX, RCA, then extras).
* **Contract enforcement** — every model output is validated against the §3.2 Pydantic models (extra fields
  added by the ML package pass through untouched); the schema is checked for leakage at startup.
* **Performance** — schema/metrics/cohort are serialised once with strong ETags (304 on revalidation);
  predictions are cached as ready-to-send bytes; model calls are serialised with a lock because SHAP
  explainers are not guaranteed thread-safe.

## Tests and benchmark

```bash
./.venv/Scripts/python -m pytest backend            # unit + API tests (FakePredictor)
./.venv/Scripts/python -m pytest backend -m integration -rs   # real model; skipped until ml/artifacts exist
./.venv/Scripts/python backend/scripts/bench_latency.py --n 200            # in-process p50/p95/p99
./.venv/Scripts/python backend/scripts/bench_latency.py --url http://127.0.0.1:8000 --n 200
```

The integration suite checks SHAP additivity (1e-6), label/threshold/band consistency, cohort predictions,
batch/single parity and parity with the ML package's `fixtures.json`.
