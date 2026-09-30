"""Service metadata: health, feature schema, evaluation metrics and the model card."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Request
from starlette.responses import Response

from app import CLINICAL_DISCLAIMER
from app.deps import RuntimeDep, SettingsDep, document_response
from app.model_card import load_model_card
from app.models import CacheStats, ErrorResponse, FeatureSchema, HealthResponse, MetricsReport

router = APIRouter(tags=["meta"])

_NOT_READY: dict[int | str, dict[str, Any]] = {503: {"model": ErrorResponse, "description": "Model not loaded"}}


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness and model status",
    responses=_NOT_READY,
)
def health(request: Request, runtime: RuntimeDep, settings: SettingsDep) -> HealthResponse:
    warmer = getattr(request.app.state, "warmup_thread", None)
    warmup: Literal["disabled", "running", "done"] = (
        "disabled" if warmer is None else ("running" if warmer.is_alive() else "done")
    )
    return HealthResponse(
        status="ok",
        model_version=runtime.model_version,
        targets=runtime.targets,
        engine="server",
        predictor="fake" if runtime.kind == "fake" else "real",
        schema_version=runtime.schema.version,
        n_features=len(runtime.schema.features),
        uptime_s=runtime.uptime_s,
        cache=CacheStats(**runtime.service.cache.stats()),
        frontend_served=settings.frontend_available,
        cache_warmup=warmup,
        disclaimer=CLINICAL_DISCLAIMER,
    )


@router.get(
    "/schema",
    response_model=FeatureSchema,
    summary="Feature schema (contract §2)",
    description="Feature metadata that drives the input form: groups, types, units, bounds, defaults, "
    "reference ranges, categorical options, prediction targets and risk bands. Supports ETag revalidation.",
    responses={304: {"description": "Not modified"}, **_NOT_READY},
)
def schema(request: Request, runtime: RuntimeDep) -> Response:
    return document_response(request, runtime.schema_doc)


@router.get(
    "/metrics",
    response_model=MetricsReport,
    summary="Evaluation report (contract §4)",
    description="Cross-validation and held-out test metrics, curves (ROC, PR, calibration, decision "
    "curve), leaderboards and global SHAP importance per target. Supports ETag revalidation.",
    responses={304: {"description": "Not modified"}, **_NOT_READY},
)
def metrics(request: Request, runtime: RuntimeDep) -> Response:
    return document_response(request, runtime.metrics_doc)


@router.get(
    "/model-card",
    summary="Model card (markdown)",
    description="Serves docs/MODEL_CARD.md when present, otherwise a card generated from the loaded "
    "metrics and schema. The `X-Model-Card-Source` header says which (`file` or `generated`).",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {"schema": {"type": "string"}}}}, **_NOT_READY},
)
def model_card(runtime: RuntimeDep, settings: SettingsDep) -> Response:
    text, source = load_model_card(settings, runtime)
    return Response(
        text,
        media_type="text/markdown; charset=utf-8",
        headers={"X-Model-Card-Source": source, "Cache-Control": "no-cache"},
    )
