# Running, testing and shipping CardioTwin

Everything here is driven by one entry point per platform. The targets are the same on both:

| Windows (PowerShell 5.1 or 7) | Linux, macOS, Git Bash | What it does |
| --- | --- | --- |
| `.\scripts\dev.ps1 setup` | `make setup` | Creates `.venv` (Python 3.11) with the pinned ML stack, API, test and lint tools, then runs `npm ci` for `frontend/` and `anatomy/` |
| `.\scripts\dev.ps1 dev` | `make dev` | API on :8000 (uvicorn `--reload`) and Vite on :5173 with `/api` proxied; Ctrl+C stops both |
| `.\scripts\dev.ps1 serve` | `make serve` | One process on :8000 serving the built SPA **and** the API (builds `frontend/dist` if it is missing) |
| `.\scripts\dev.ps1 build -Base /CardioTwin/` | `make build BASE=/CardioTwin/` | Production SPA build; `BASE` is only needed for sub-path hosting such as GitHub Pages |
| `.\scripts\dev.ps1 test` | `make test` | ML, anatomy, API and tooling tests, then frontend typecheck, lint and unit tests |
| `.\scripts\dev.ps1 lint` | `make lint` | ruff (backend, scripts, ml), mypy (backend, scripts) and eslint |
| `.\scripts\dev.ps1 train` | `make train ARGS=--fast` | Retrains the models and republishes the artifacts (`python -m cardiotwin_ml.train`) |
| `.\scripts\dev.ps1 anatomy` | `make anatomy` | Rebuilds the 3D anatomy assets (needs Blender 5.1, see `anatomy/README.md`) |
| `.\scripts\dev.ps1 e2e` | `make e2e` | End-to-end check of a running API (below) |

If the execution policy blocks the script, run `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 <target>`.
Without `make`, call the POSIX runner directly: `bash scripts/dev.sh <target> [--backend-port N] [--frontend-port N] [--port N] [--smoke]`.

**Ports.** Every runner checks its ports before starting anything and names the flag to use when one is taken:
`-BackendPort 8010 -FrontendPort 5180` / `-Port 8012` on Windows, `BACKEND_PORT=8010 FRONTEND_PORT=5180` / `PORT=8012`
with `make`. **Smoke mode** (`-Smoke`, `--smoke`, `make smoke`) starts the services, verifies them end to end, stops
them and exits 0 or 1: `dev` checks the API health, the Vite page and the `/api` proxy; `serve` runs the full
end-to-end check below against the single-process server.

Requirements: Python 3.11 (the artifacts and pins were produced with 3.11) and Node.js 22 (>= 20.19).

## End-to-end check: `scripts/e2e_check.py`

Talks to a running server over HTTP (standard library only) and verifies the whole serving path against the ML
package's reference artifacts. Exit status: 0 all checks passed, 1 a check failed, 2 the server was unreachable.

```text
$ python scripts/e2e_check.py --url http://127.0.0.1:8000
CardioTwin end-to-end check: http://127.0.0.1:8000 (fixtures model 1.1.0, 39 cases)
  PASS  health    real predictor, model 1.1.0, 4 targets, 53 features, warm-up done
  PASS  schema    53 features, no outcome inputs, 4 targets; LAD/LCX/RCA <-> anatomy consistent (served /anatomy/manifest.json)
  PASS  leakage   LAD, LCX, RCA, Cath rejected as inputs (422 leakage_feature)
  PASS  fixtures  38/39 server = native reference (max |dp| 0, |dlogit| 0, |dshap| 0); 1 outside the training range rejected by the 'reject' policy as designed
  PASS  cohort    81 patients consistent; server = portable (max |dp| 2.2e-16, |dshap| 0); server = native (max |dp| 0, |dshap| 0); test-split label agreement CAD 0.82, LAD 0.64, LCX 0.72, RCA 0.62
  PASS  batch     81 rows in 2 call(s) = single predictions, in order
  PASS  frontend  SPA index, model and anatomy assets served; unknown /api paths stay JSON 404s
  INFO  latency   miss (model + exact SHAP) p50 24.4 / p95 27.9 / p99 31.3 ms (n=40); hit p50 1.3 / p95 2.2 / p99 3.1 ms (n=40)
RESULT: PASS (8 checks, 0 failed, 6.5 s)
```

| Check | Verifies |
| --- | --- |
| `health` | status `ok`, the real predictor, model version = `fixtures.json`, target order CAD, LAD, LCX, RCA, clinical-safety disclaimer |
| `schema` | no LAD/LCX/RCA/Cath inputs, served schema = `ml/artifacts/schema.json`, every LAD/LCX/RCA output maps to the 3D anatomy manifest |
| `leakage` | each outcome column sent as an input is rejected (422 `leakage_feature`) |
| `fixtures` | every reference case in `fixtures.json` reproduced by the server within the fixture tolerances (server = native model) |
| `cohort` | every demo patient: invariants (SHAP additivity, labels, bands, summary), `/cohort/{id}/prediction` = `/predict`, server = portable `model.json` evaluator (the browser engine's spec) = native model |
| `batch` | `/predict/batch` = single predictions, in request order |
| `frontend` | when the SPA is served: index, model and anatomy assets, JSON 404s for unknown API paths |
| `latency` | client and server (`X-Response-Time-ms`) p50/p95/p99 for cache misses and hits; `--max-p95-ms` turns it into a gate |

Useful options: `--wait 120` (wait for the server and its cache warm-up), `--json-report e2e.json`, `--no-native`
(skip the in-process native model, e.g. without the ML dependencies), `--latency-n 0` (skip latency).

## Continuous integration: `.github/workflows/ci.yml`

Runs on every push to `main` and every pull request.

| Job | What it proves |
| --- | --- |
| ML pipeline (reference platform, Windows) | Full ML suite: leakage guard, encoding, calibration, TreeSHAP, portable parity, bit-exact reproduction of the published artifacts |
| ML pipeline (Linux) | ruff and the same suite; the three bit-exact reproduction tests are reported but not gating, because training numerics differ between Windows (where `ml/artifacts` were produced) and Linux |
| ML reproducibility | Two full fast trainings from the raw dataset produce byte-identical artifacts (reference platform) |
| Anatomy assets | Asset contracts, centreline graphs and mesh QA (no Blender needed) |
| API | ruff, mypy `--strict`, unit, contract and real-model integration tests |
| Frontend | eslint (zero warnings), unit and engine-parity tests |
| Frontend build | typecheck and production bundle (size table in the run summary); the bundle feeds the end-to-end job |
| End-to-end | Boots the API serving the built SPA and runs `e2e_check.py` (latency table in the run summary) |
| Docker image + compose | Builds `backend/Dockerfile`, starts it with `docker compose --wait` and runs `e2e_check.py` against the container |
| One-command run | From a clean checkout: `make setup && make smoke` on Linux, `dev.ps1 setup`, `dev -Smoke`, `serve -Smoke` on Windows |

Badges for the top-level README:

```markdown
[![CI](https://github.com/Mohammad-Umar7/CardioTwin/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mohammad-Umar7/CardioTwin/actions/workflows/ci.yml)
[![Pages](https://github.com/Mohammad-Umar7/CardioTwin/actions/workflows/pages.yml/badge.svg)](https://github.com/Mohammad-Umar7/CardioTwin/actions/workflows/pages.yml)
```

## Static demo: `.github/workflows/pages.yml`

Manual only (**Actions -> Pages -> Run workflow**). Builds the SPA with base `/<repository>/` (`/CardioTwin/`), gates on
the unit and engine-parity tests, drops the server-only pickle, smoke-tests the bundle under the base path and
deploys it to GitHub Pages. Without a server every estimate comes from the in-browser engine evaluating
`model.json`. Before the first run enable Pages with **Settings -> Pages -> Source: GitHub Actions**.

## Docker

```bash
docker compose up --build      # -> http://localhost:8000 (app at /, API at /api, OpenAPI at /docs)
```

`backend/Dockerfile` builds the SPA in a Node 22 stage and serves it with the API from one non-root uvicorn
process. The build fails unless the installed stack reproduces every case in `fixtures.json`; the container has
a health check and `docker-compose.yml` runs it with a read-only root filesystem and no Linux capabilities.

## Reproducible installs

* `ml/requirements.txt`: exact versions of the ML stack the published artifacts were built with.
* `scripts/constraints.txt`: exact versions of the API stack and of every transitive dependency (all with
  CPython 3.11 wheels for Windows and manylinux), applied to every install by the runners, CI and Docker.
* `scripts/requirements-dev.txt`: the complete development environment in one file.
* `scripts/runtime_requirements.py`: the exactly pinned server runtime set for the Docker image, derived from
  `backend/requirements.txt` and `ml/pyproject.toml` (fails if a runtime dependency is unpinned). With
  `--xgboost-cpu` it installs the CPU-only XGBoost build, which halves the image (1.36 GB to 645 MB).

## Files

| File | Purpose |
| --- | --- |
| `dev.ps1`, `dev.sh` | The runners above (Windows / POSIX); the `Makefile` delegates to `dev.sh` |
| `probe.py` | Port and HTTP probes shared by both runners, so they behave identically |
| `e2e_check.py` | End-to-end check of a running server |
| `runtime_requirements.py` | Pinned runtime requirement set for the Docker image |
| `constraints.txt`, `requirements-dev.txt` | Pins (see above) |
| `ruff.toml` | Lint settings for the tools in this folder |
| `tests/` | Tests of the tools, including full `e2e_check.py` runs against a live in-process API |
