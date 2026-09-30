"""Demo cohort (contract §3.3): held-out patients with catheterisation ground truth."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import Response

from app.deps import JSON, RuntimeDep, document_response
from app.logging_config import get_logger
from app.models import CohortPatient, CohortPredictionResponse, CohortResponse, ErrorResponse
from app.runtime import Runtime, dumps
from app.validation import FeatureValidationError

router = APIRouter(tags=["cohort"])
log = get_logger("cohort")

_NOT_FOUND = {404: {"model": ErrorResponse, "description": "Unknown patient id"}}


def _patient_or_404(runtime: Runtime, patient_id: str) -> CohortPatient:
    patient = runtime.cohort_index.get(patient_id) or runtime.cohort_index.get(patient_id.upper())
    if patient is None:
        known = list(runtime.cohort_index)
        preview = ", ".join(known[:5]) + (" ..." if len(known) > 5 else "")
        raise HTTPException(
            status_code=404,
            detail=f"Unknown patient id '{patient_id}'. {len(known)} cohort patients exist (e.g. {preview}); "
            "GET /api/cohort lists them.",
        )
    return patient


@router.get(
    "/cohort",
    response_model=CohortResponse,
    summary="Demo patients with ground-truth labels",
    responses={304: {"description": "Not modified"}},
)
def cohort(request: Request, runtime: RuntimeDep) -> Response:
    return document_response(request, runtime.cohort_doc)


@router.get("/cohort/{patient_id}", response_model=CohortPatient, summary="One demo patient", responses=_NOT_FOUND)
def cohort_patient(patient_id: str, runtime: RuntimeDep) -> CohortPatient:
    return _patient_or_404(runtime, patient_id)


@router.get(
    "/cohort/{patient_id}/prediction",
    response_model=CohortPredictionResponse,
    summary="Server-side prediction for a demo patient, with agreement against ground truth",
    responses=_NOT_FOUND,
)
def cohort_prediction(patient_id: str, runtime: RuntimeDep) -> Response:
    patient = _patient_or_404(runtime, patient_id)
    service = runtime.service
    try:
        validated = service.validator.validate(patient.features, ("cohort", patient.id, "features"))
        features: dict[str, Any] = validated.values
        warnings = validated.warnings
    except FeatureValidationError as exc:
        # Cohort rows come from the ML artifacts, not from users: predict on the raw values, but flag the drift.
        log.warning("cohort patient does not validate against the schema", extra={"patient": patient.id,
                                                                                    "error": str(exc)})
        features = {k: v for k, v in patient.features.items() if k in service.validator.specs and v is not None}
        warnings = []
    result, hit = service.predict_normalized(features, warnings=warnings)

    predictions = result.data["predictions"]
    agreement = {
        target: int(predictions[target]["label"]) == int(label)
        for target, label in patient.labels.items()
        if target in predictions
    }
    payload = b"".join(
        [
            b'{"patient":',
            dumps(patient.model_dump(mode="json")),
            b',"prediction":',
            result.body,
            b',"agreement":',
            dumps(agreement),
            b"}",
        ]
    )
    return Response(
        payload,
        media_type=JSON,
        headers={"X-Cache": "HIT" if hit else "MISS", "X-Model-Version": runtime.model_version},
    )
