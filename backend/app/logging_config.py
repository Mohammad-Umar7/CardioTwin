"""Structured logging with a per-request correlation id.

Log records emitted while a request is being served automatically carry its ``request_id``
(set by :class:`app.middleware.RequestContextMiddleware`). Any ``extra={...}`` fields passed to a
logging call are emitted as top-level JSON keys.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

LOGGER_NAME = "cardiotwin"

request_id_var: ContextVar[str | None] = ContextVar("cardiotwin_request_id", default=None)

# Attributes present on every LogRecord; anything else was supplied through ``extra=``.
_STANDARD_ATTRS = frozenset(
    vars(logging.LogRecord("x", logging.INFO, "x", 0, "x", None, None)).keys()
    | {"message", "asctime", "request_id", "taskName"}
)


class RequestIdFilter(logging.Filter):
    """Attach the current request id (or ``None``) to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """Render records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Human-readable format for local development."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        if not getattr(record, "request_id", None):
            record.request_id = "-"
        base = super().format(record)
        extras = {
            k: v for k, v in record.__dict__.items() if k not in _STANDARD_ATTRS and not k.startswith("_")
        }
        if extras:
            base += " " + " ".join(f"{k}={v}" for k, v in extras.items())
        return base


def configure_logging(level: str = "INFO", fmt: str = "json") -> logging.Logger:
    """Configure the ``cardiotwin`` logger hierarchy (idempotent).

    Only the service's own logger namespace is touched so uvicorn's loggers keep their config.
    """
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level.upper())
    for handler in list(logger.handlers):
        if getattr(handler, "_cardiotwin", False):
            logger.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler._cardiotwin = True  # type: ignore[attr-defined]
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def get_logger(name: str) -> logging.Logger:
    """Child logger of the ``cardiotwin`` namespace (e.g. ``get_logger("access")``)."""
    return logging.getLogger(f"{LOGGER_NAME}.{name}")
