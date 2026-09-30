"""Application factory and ASGI entry point.

Run locally (from the repository root)::

    ./.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload

``create_app`` accepts explicit settings and/or a ready predictor so tests can build isolated apps.
"""

from __future__ import annotations

import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse

from app import CLINICAL_DISCLAIMER, __version__
from app.config import Settings
from app.errors import install_exception_handlers
from app.frontend import mount_frontend
from app.logging_config import configure_logging, get_logger
from app.middleware import REQUEST_ID_HEADER, RESPONSE_TIME_HEADER, RequestContextMiddleware
from app.predictors import FakePredictor, Predictor, PredictorContractError, PredictorLoadError, load_predictor
from app.routers import api_router
from app.runtime import Runtime

log = get_logger("app")

API_DESCRIPTION = f"""
Explainable coronary-risk **digital twin** API.

Predicts overall coronary artery disease (**CAD**) and stenosis of the three major coronary arteries
(**LAD**, **LCX**, **RCA**) from routine clinical data, and explains every prediction with per-feature
SHAP contributions. Interface contract: `docs/CONTRACTS.md`.

**Clinical safety:** {CLINICAL_DISCLAIMER}
"""

OPENAPI_TAGS: list[dict[str, Any]] = [
    {"name": "predict", "description": "Model inference with SHAP explanations."},
    {"name": "cohort", "description": "Held-out demo patients with angiography ground truth."},
    {"name": "meta", "description": "Health, feature schema, evaluation metrics and model card."},
]


class StartupError(RuntimeError):
    """The service cannot start; the message says why and how to fix it."""


def _build_runtime(predictor: Predictor, kind: str, settings: Settings) -> Runtime:
    try:
        return Runtime.build(
            predictor, kind=kind, cache_size=settings.cache_size, out_of_range=settings.out_of_range
        )
    except PredictorContractError as exc:
        raise StartupError(f"The loaded model does not satisfy the API contract: {exc}") from exc


def _start_cache_warmup(runtime: Runtime, settings: Settings, stop: threading.Event) -> threading.Thread | None:
    """Warm the prediction cache with the demo cohort without delaying startup."""
    if not settings.warm_cache or settings.cache_size == 0 or not runtime.cohort_index:
        return None

    def warm() -> None:
        started = time.perf_counter()
        warmed = runtime.warm_cohort(stop)
        log.info(
            "prediction cache warmed with the demo cohort",
            extra={"patients": warmed, "duration_ms": round((time.perf_counter() - started) * 1000, 1)},
        )

    thread = threading.Thread(target=warm, name="cardiotwin-cache-warmup", daemon=True)
    thread.start()
    return thread


def create_app(settings: Settings | None = None, predictor: Predictor | None = None) -> FastAPI:
    """Build the CardioTwin ASGI application.

    Args:
        settings: Configuration; defaults to :meth:`Settings.from_env`.
        predictor: A ready predictor (tests, embedding). When omitted, the predictor selected by
            ``settings.predictor`` is loaded during application startup, and startup aborts with a
            clear, actionable message if that fails.
    """
    settings = settings or Settings.from_env()
    configure_logging(settings.log_level, settings.log_format)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if app.state.runtime is None:
            try:
                loaded = load_predictor(settings)
                app.state.runtime = _build_runtime(loaded, settings.predictor, settings)
            except (PredictorLoadError, StartupError) as exc:
                app.state.load_error = str(exc)
                log.critical("CardioTwin API cannot start: %s", exc)
                raise StartupError(f"CardioTwin API cannot start: {exc}") from None
        runtime: Runtime = app.state.runtime
        if runtime.kind == "fake":
            log.warning("serving the FakePredictor: predictions are synthetic (CARDIOTWIN_PREDICTOR=fake)")
        log.info(
            "CardioTwin API ready",
            extra={
                "model_version": runtime.model_version,
                "predictor": runtime.kind,
                "n_features": len(runtime.schema.features),
                "artifacts": str(settings.artifacts_dir) if runtime.kind == "real" else None,
                "frontend": str(settings.frontend_dist) if settings.frontend_available else None,
            },
        )
        stop = threading.Event()
        warmer = _start_cache_warmup(runtime, settings, stop)
        app.state.warmup_thread = warmer
        try:
            yield
        finally:
            stop.set()
            if warmer is not None:
                warmer.join(timeout=5)

    app = FastAPI(
        title="CardioTwin API",
        version=__version__,
        description=API_DESCRIPTION,
        openapi_tags=OPENAPI_TAGS,
        lifespan=lifespan,
        license_info={"name": "MIT", "identifier": "MIT"},
    )
    app.state.settings = settings
    app.state.runtime = None
    app.state.load_error = None
    app.state.warmup_thread = None
    if predictor is not None:
        kind = "fake" if isinstance(predictor, FakePredictor) else "real"
        app.state.runtime = _build_runtime(predictor, kind, settings)

    install_exception_handlers(app)

    # Starlette wraps middleware in reverse order of registration: the last added is outermost.
    app.add_middleware(GZipMiddleware, minimum_size=settings.gzip_min_size, compresslevel=6)
    wildcard = settings.cors_origins == ("*",)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=not wildcard,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER, RESPONSE_TIME_HEADER, "X-Cache", "X-Cache-Hits", "X-Model-Version",
                        "X-Model-Card-Source", "ETag"],
        max_age=600,
    )
    app.add_middleware(RequestContextMiddleware)

    app.include_router(api_router)

    if settings.frontend_available:
        mount_frontend(app, settings.frontend_dist)
    else:
        if settings.serve_frontend:
            log.info("frontend build not found; serving the API only", extra={"expected": str(settings.frontend_index)})

        @app.get("/", include_in_schema=False)
        def root() -> JSONResponse:
            return JSONResponse(
                {
                    "name": "CardioTwin API",
                    "version": __version__,
                    "docs": "/docs",
                    "health": "/api/health",
                    "frontend": "not built - run `npm --prefix frontend run build` to serve the app here",
                    "disclaimer": CLINICAL_DISCLAIMER,
                }
            )

    return app


_default_app: FastAPI | None = None


def __getattr__(name: str) -> Any:
    """Build the module-level ``app`` lazily (PEP 562).

    ``uvicorn app.main:app`` resolves the attribute and gets an app configured from the
    environment, while importing :func:`create_app` (e.g. in tests) has no side effects.
    """
    global _default_app
    if name == "app":
        if _default_app is None:
            _default_app = create_app()
        return _default_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
