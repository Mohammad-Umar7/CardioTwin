"""Serve the built React SPA (``frontend/dist``) from the API process.

One ``uvicorn`` process then gives judges a single URL: ``/`` is the app, ``/api`` the REST API,
``/docs`` the OpenAPI UI. Client-side routes fall back to ``index.html``; missing *files* (paths
with an extension) and unknown ``/api`` paths stay real 404s so a typo never returns HTML where
JSON or a model file was expected.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# Windows' registry can map .js to text/plain, which browsers refuse for ES modules; pin the
# types the SPA and the 3D assets rely on.
for _type, _ext in (
    ("text/javascript", ".js"),
    ("text/javascript", ".mjs"),
    ("text/css", ".css"),
    ("text/html", ".html"),
    ("application/json", ".json"),
    ("image/svg+xml", ".svg"),
    ("model/gltf-binary", ".glb"),
    ("model/gltf+json", ".gltf"),
    ("application/wasm", ".wasm"),
    ("application/manifest+json", ".webmanifest"),
    ("font/woff2", ".woff2"),
    ("image/webp", ".webp"),
    ("image/avif", ".avif"),
    ("application/octet-stream", ".bin"),
    ("image/ktx2", ".ktx2"),
):
    mimetypes.add_type(_type, _ext)

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
REVALIDATE_CACHE = "no-cache"
_RESERVED_ROOTS = frozenset({"api", "docs", "redoc"})


class SPAStaticFiles(StaticFiles):
    """``StaticFiles`` with single-page-app fallback and cache headers tuned for Vite builds."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or not is_spa_route(path):
                raise
            response = await super().get_response("index.html", scope)
            response.headers["Cache-Control"] = REVALIDATE_CACHE
            return response
        normalized = path.replace("\\", "/")
        if normalized.startswith("assets/") and response.status_code in (200, 304):
            response.headers["Cache-Control"] = IMMUTABLE_CACHE  # Vite content-hashes these names
        else:
            response.headers.setdefault("Cache-Control", REVALIDATE_CACHE)
        return response


def is_spa_route(path: str) -> bool:
    """True for client-side routes (``patients/P-017``), False for files and reserved prefixes."""
    normalized = path.replace("\\", "/").strip("/")
    if normalized.split("/", 1)[0] in _RESERVED_ROOTS:
        return False
    last_segment = normalized.rsplit("/", 1)[-1]
    return "." not in last_segment


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Mount the SPA at ``/``; must be called after every API route is registered."""
    app.mount("/", SPAStaticFiles(directory=dist, html=True, check_dir=True), name="frontend")
