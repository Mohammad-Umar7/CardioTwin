"""Pure-ASGI middleware: request id, timing headers, access logging and last-resort error JSON."""

from __future__ import annotations

import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_config import get_logger, request_id_var
from app.runtime import dumps

REQUEST_ID_HEADER = "X-Request-ID"
RESPONSE_TIME_HEADER = "X-Response-Time-ms"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

access_log = get_logger("access")
error_log = get_logger("error")


class RequestContextMiddleware:
    """Assign/propagate ``X-Request-ID``, add ``X-Response-Time-ms`` + ``Server-Timing`` and log.

    A client-supplied request id is reused when it is well-formed (so traces can be correlated
    across the SPA and the API); otherwise a new UUID4 hex id is generated. Unhandled exceptions
    become a JSON 500 carrying the request id instead of a bare text response.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                elapsed_ms = (time.perf_counter() - started) * 1000
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                headers[RESPONSE_TIME_HEADER] = f"{elapsed_ms:.2f}"
                headers.append("Server-Timing", f"app;dur={elapsed_ms:.2f}")
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            error_log.exception("unhandled error", extra={"method": scope.get("method"), "path": scope.get("path")})
            if response_started:
                raise
            status_code = 500
            await _send_internal_error(send_with_headers, request_id)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            path: str = scope.get("path", "")
            level = 20 if path.startswith("/api") or status_code >= 500 else 10  # static assets at DEBUG
            access_log.log(
                level,
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": path,
                    "status": status_code,
                    "duration_ms": round(elapsed_ms, 3),
                },
            )
            request_id_var.reset(token)


async def _send_internal_error(send: Send, request_id: str) -> None:
    body = dumps(
        {
            "error": "internal_error",
            "message": "The server hit an unexpected error. Retry, and report the request id if it persists.",
            "request_id": request_id,
        }
    )
    await send(
        {
            "type": "http.response.start",
            "status": 500,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})
