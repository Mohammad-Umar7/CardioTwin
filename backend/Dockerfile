# syntax=docker/dockerfile:1.7
#
# CardioTwin - one image, one URL: the React/Three.js app at /, the REST API at /api, OpenAPI at /docs.
#
#   docker build -f backend/Dockerfile -t cardiotwin .      (build context = repository root)
#   docker run --rm -p 8000:8000 cardiotwin                 -> http://localhost:8000
#
# Requires the trained artifacts in ml/artifacts (produced by the ML pipeline, see ml/README.md).

ARG PYTHON_VERSION=3.11
ARG NODE_VERSION=22

# ---------------------------------------------------------------------------------------------
# Stage 1: production build of the single-page app
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY ml/artifacts/ /src/ml/artifacts/
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Stage 2: Python runtime (API + model), serving the SPA built above
# ---------------------------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

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

# Dependencies first so code edits do not invalidate the (slow) install layers.
COPY backend/requirements.txt backend/requirements.txt
RUN python -m pip install -r backend/requirements.txt

# Editable install: cardiotwin_ml resolves configs/artifacts relative to the checkout (CARDIOTWIN_ROOT).
COPY ml/ ml/
RUN test -f ml/artifacts/schema.json \
        || { echo "ml/artifacts is empty - train the models first (see ml/README.md)" >&2; exit 1; } \
    && python -m pip install -e ./ml

COPY backend/ backend/
COPY docs/ docs/
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
