"""Prediction endpoints (contract §3.2) plus a bounded batch variant."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body
from starlette.responses import Response

from app.deps import JSON, RuntimeDep, SettingsDep
from app.models import BatchPredictRequest, BatchPredictResponse, ErrorResponse, PredictRequest, PredictResponse
from app.runtime import dumps
from app.validation import FeatureValidationError, Issue

router = APIRouter(tags=["predict"])

_ERRORS: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorResponse, "description": "Unknown feature, wrong type, or value outside the allowed range"},
    503: {"model": ErrorResponse, "description": "Model not loaded"},
}

_PREDICT_EXAMPLES: dict[str, Any] = {
    "typical_angina": {
        "summary": "62-year-old diabetic man with typical angina",
        "value": {
            "features": {
                "Age": 62,
                "Sex": "Male",
                "DM": 1,
                "HTN": 1,
                "Typical Chest Pain": 1,
                "EF-TTE": 45,
                "Region RWMA": 2,
            }
        },
    },
    "low_risk": {
        "summary": "41-year-old woman with atypical chest pain",
        "value": {"features": {"Age": 41, "Sex": "Female", "Typical Chest Pain": 0, "Atypical": 1, "EF-TTE": 60}},
    },
    "defaults_only": {
        "summary": "Empty body: every feature imputed with the cohort default",
        "value": {"features": {}},
    },
}


@router.post(
    "/predict",
    response_model=PredictResponse,
    summary="Predict CAD and per-vessel stenosis with SHAP explanations",
    description=(
        "Returns calibrated probabilities, labels at the tuned thresholds, risk bands and per-feature SHAP "
        "contributions (log-odds space) for CAD, LAD, LCX and RCA. Missing features are imputed with the schema "
        "default and listed in `imputed`. Identical requests are served from an LRU cache "
        "(`X-Cache: HIT`)."
    ),
    responses=_ERRORS,
)
def predict(
    body: Annotated[PredictRequest, Body(openapi_examples=_PREDICT_EXAMPLES)],
    runtime: RuntimeDep,
) -> Response:
    result, hit = runtime.service.predict(body.features)
    return Response(
        result.body,
        media_type=JSON,
        headers={"X-Cache": "HIT" if hit else "MISS", "X-Model-Version": runtime.model_version},
    )


@router.post(
    "/predict/batch",
    response_model=BatchPredictResponse,
    summary="Predict up to 256 patients in one call",
    description=(
        "Each row is validated like a `POST /api/predict` body; all errors across all rows are reported "
        "together (loc `['body', 'rows', <index>, 'features', <key>]`). Results keep the request order."
    ),
    responses=_ERRORS,
)
def predict_batch(body: BatchPredictRequest, runtime: RuntimeDep, settings: SettingsDep) -> Response:
    count, limit = len(body.rows), settings.batch_max_rows
    if not 1 <= count <= limit:
        raise FeatureValidationError(
            [
                Issue(
                    "too_short" if count == 0 else "too_long",
                    ("body", "rows"),
                    f"'rows' must contain between 1 and {limit} items, got {count}",
                    None,
                    {"min_length": 1, "max_length": limit, "actual_length": count},
                )
            ]
        )

    validator = runtime.service.validator
    normalized: list[dict[str, Any]] = []
    issues: list[Issue] = []
    for index, row in enumerate(body.rows):
        try:
            normalized.append(validator.normalize(row.features, ("body", "rows", index, "features")))
        except FeatureValidationError as exc:
            issues.extend(exc.issues)
    if issues:
        raise FeatureValidationError(issues)

    parts: list[bytes] = []
    hits = 0
    for index, (row, features) in enumerate(zip(body.rows, normalized, strict=True)):
        result, hit = runtime.service.predict_normalized(features)
        hits += hit
        parts.append(b'{"index":%d,"id":%s,"prediction":%s}' % (index, dumps(row.id), result.body))

    payload = b"".join(
        [
            b'{"model_version":',
            dumps(runtime.model_version),
            b',"engine":"server","count":%d,"results":[' % count,
            b",".join(parts),
            b"]}",
        ]
    )
    return Response(
        payload,
        media_type=JSON,
        headers={"X-Cache-Hits": str(hits), "X-Model-Version": runtime.model_version},
    )
