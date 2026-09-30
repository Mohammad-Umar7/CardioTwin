"""FastAPI dependencies and small response helpers shared by the routers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from starlette.responses import Response

from app.config import Settings
from app.errors import ModelNotReadyError
from app.runtime import Runtime, StaticDocument

JSON = "application/json"


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        reason = getattr(request.app.state, "load_error", None)
        raise ModelNotReadyError(reason or "The model is still loading; retry shortly.")
    return runtime


SettingsDep = Annotated[Settings, Depends(get_settings)]
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    candidates = {tag.strip().removeprefix("W/") for tag in if_none_match.split(",")}
    return etag in candidates


def document_response(request: Request, document: StaticDocument) -> Response:
    """Serve a precomputed JSON document with ETag revalidation (304 when unchanged)."""
    headers = {"ETag": document.etag, "Cache-Control": "no-cache"}
    if _etag_matches(request.headers.get("if-none-match"), document.etag):
        return Response(status_code=304, headers=headers)
    return Response(document.body, media_type=JSON, headers=headers)
