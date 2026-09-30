# syntax=docker/dockerfile:1.7
#
# CardioTwin - one image, one URL: the React/Three.js app at /, the REST API at /api, OpenAPI at /docs.
#
#   docker build -f backend/Dockerfile -t cardiotwin .      (build context = repository root)
#   docker run --rm -p 8000:8000 cardiotwin                 -> http://localhost:8000
#   docker compose up --build                               (same, via docker-compose.yml)
#
# Requires the trained artifacts in ml/artifacts (committed; regenerate with `python -m cardiotwin_ml.train`).
# CI builds this image, boots it and runs scripts/e2e_check.py against it (.github/workflows/ci.yml, job "docker").

ARG PYTHON_VERSION=3.11
ARG NODE_VERSION=22

# ---------------------------------------------------------------------------------------------
# Stage 1: production build of the single-page app
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The Vite plugin (frontend/build/modelArtifacts.ts) emits any model file missing from public/model from
# ../ml/artifacts, so the build works even when the frontend mirror is incomplete.
COPY ml/artifacts/ /src/ml/artifacts/
# The browser evaluates model.json; the pickled scikit-learn/XGBoost bundle is for the Python API only.
RUN npm run build && rm -f dist/model/*.joblib

# ---------------------------------------------------------------------------------------------
# Stage 2: Python runtime (API + model), serving the SPA built above
# ---------------------------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="CardioTwin" \
      org.opencontainers.image.description="Explainable coronary-risk digital twin: CAD and LAD/LCX/RCA stenosis estimates with SHAP, mapped onto a 3D heart. Decision-support / educational prototype, not a diagnostic device." \
      org.opencontainers.image.licenses="MIT AND CC-BY-SA-2.1-JP" \
      org.opencontainers.image.source="https://github.com/Mohammad-Umar7/CardioTwin"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib

# libgomp1: OpenMP runtime required by the xgboost wheel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so code edits do not invalidate the (slow) install layers. Every package is pinned:
# scripts/runtime_requirements.py derives the runtime set from backend/requirements.txt and ml/pyproject.toml
# and pins it with ml/requirements.txt (the exact versions the published artifacts were built with - the pickled
# models must be loaded by the same scikit-learn/XGBoost) and scripts/constraints.txt (API stack and every
# transitive dependency). Test-only tools (pytest, shap) are not installed. --xgboost-cpu: same xgboost module
# and version without CUDA kernels or the NCCL wheel (~480 MB less); inference runs on the CPU.
COPY backend/requirements.txt backend/requirements.txt
COPY ml/requirements.txt ml/pyproject.toml ml/
COPY scripts/constraints.txt scripts/runtime_requirements.py scripts/
RUN python scripts/runtime_requirements.py --xgboost-cpu -o /tmp/runtime.txt \
    && cat /tmp/runtime.txt \
    && python -m pip install -r /tmp/runtime.txt -c scripts/constraints.txt \
    && rm /tmp/runtime.txt

# Editable install: cardiotwin_ml resolves configs/artifacts relative to the checkout (CARDIOTWIN_ROOT).
COPY ml/ ml/
RUN test -f ml/artifacts/schema.json \
        || { echo "ml/artifacts is empty - train the models first (see ml/README.md)" >&2; exit 1; } \
    && python -m pip install --no-deps -e ./ml

# Build-time self-test: the installed stack loads the pickled models and reproduces every reference case in
# fixtures.json, so a library mismatch fails the build instead of the first request.
RUN python - <<'PY'
import json

import sklearn
import xgboost
from cardiotwin_ml.inference import CardioTwinPredictor

fixtures = json.load(open("ml/artifacts/fixtures.json", encoding="utf-8"))
predictor = CardioTwinPredictor.load("ml/artifacts")
tolerance = fixtures["tolerance"]["probability"]
worst = 0.0
for case in fixtures["cases"]:
    got = predictor.predict(case["features"])["predictions"]
    for target, want in case["expected"]["predictions"].items():
        worst = max(worst, abs(got[target]["probability"] - want["probability"]))
assert worst <= tolerance, f"native predictor differs from fixtures.json by {worst:.2e} (> {tolerance:.0e})"
print(
    f"model {fixtures['model_version']}: {len(fixtures['cases'])} fixtures reproduced (max |dp| {worst:.1e}); "
    f"xgboost {xgboost.__version__}, scikit-learn {sklearn.__version__}"
)
PY

COPY backend/ backend/
COPY docs/MODEL_CARD.md docs/MODEL_CARD.md
COPY --from=frontend /src/frontend/dist frontend/dist

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin cardiotwin
USER cardiotwin

ENV CARDIOTWIN_ROOT=/app \
    CARDIOTWIN_ARTIFACTS=/app/ml/artifacts \
    CARDIOTWIN_SERVE_FRONTEND=1 \
    CARDIOTWIN_FRONTEND_DIST=/app/frontend/dist \
    CARDIOTWIN_LOG_FORMAT=json \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, sys, urllib.request; \
url = 'http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'); \
sys.exit(0 if urllib.request.urlopen(url, timeout=4).status == 200 else 1)"

# Shell form so hosting platforms can inject $PORT; exec keeps uvicorn as PID 1 for clean shutdown.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
