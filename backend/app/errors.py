"""Exception handlers producing one consistent JSON error envelope.

Every error body is ``{"error": <code>, "message": <human text>, "detail": [...]?, "request_id": ...}``.
For 422s, ``detail`` keeps FastAPI's item format (``type``/``loc``/``msg``/``input``/``ctx``).
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_config import get_logger, request_id_var
from app.predictors.base import PredictorContractError
from app.validation import FeatureValidationError

log = get_logger("errors")


class ModelNotReadyError(RuntimeError):
    """The predictor has not been loaded (startup failed or still in progress)."""


def request_id_of(request: Request) -> str | None:
    return getattr(request.state, "request_id", None) or request_id_var.get()


def error_response(
    request: Request,
    status_code: int,
    error: str,
    message: str,
    detail: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"error": error, "message": message}
    if detail is not None:
        body["detail"] = detail
    body["request_id"] = request_id_of(request)
    return JSONResponse(body, status_code=status_code, headers=headers)


def _summarise(detail: list[dict[str, Any]]) -> str:
    first = detail[0]
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    more = f" (+{len(detail) - 1} more)" if len(detail) > 1 else ""
    return f"{where + ': ' if where else ''}{first.get('msg', 'invalid value')}{more}"


async def _feature_validation_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, FeatureValidationError)
    detail = jsonable_encoder([issue.as_dict() for issue in exc.issues])
    return error_response(request, 422, "validation_error", _summarise(detail), detail)


async def _request_validation_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    detail: list[dict[str, Any]] = []
    for item in jsonable_encoder(exc.errors()):
        item.pop("url", None)
        detail.append(item)
    message = _summarise(detail) if detail else "Invalid request"
    top_level_extras = [
        d for d in detail if d.get("type") == "extra_forbidden" and len(d.get("loc", [])) == 2
    ]
    if top_level_extras and request.url.path.endswith("/predict"):
        message += '. Send raw features wrapped in an object: {"features": {"Age": 62, ...}}'
    return error_response(request, 422, "validation_error", message, detail)


async def _http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    try:
        code = HTTPStatus(exc.status_code).phrase.lower().replace(" ", "_").replace("-", "_")
    except ValueError:
        code = "http_error"
    message = exc.detail if isinstance(exc.detail, str) else HTTPStatus(exc.status_code).phrase
    if exc.status_code == 404 and message == "Not Found":
        message = f"No resource at {request.url.path}. The API lives under /api (docs at /docs)."
    return error_response(request, exc.status_code, code, message, headers=getattr(exc, "headers", None))


async def _contract_error_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error("model output violates the interface contract", extra={"error": str(exc)})
    return error_response(
        request,
        500,
        "model_contract_error",
        "The model returned data that does not match the API contract; see the server log.",
    )


async def _not_ready_handler(request: Request, exc: Exception) -> JSONResponse:
    return error_response(
        request, 503, "model_not_ready", str(exc) or "The model is not loaded.", headers={"Retry-After": "5"}
    )


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(FeatureValidationError, _feature_validation_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(PredictorContractError, _contract_error_handler)
    app.add_exception_handler(ModelNotReadyError, _not_ready_handler)
