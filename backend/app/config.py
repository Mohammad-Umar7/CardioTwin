"""Runtime configuration, read from ``CARDIOTWIN_*`` environment variables.

Every setting has a sensible default so ``uvicorn app.main:app --app-dir backend`` works from a
fresh checkout. Invalid values fail fast with a message naming the offending variable.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal, get_args

REPO_ROOT: Path = Path(__file__).resolve().parents[2]
"""Repository root (``backend/app/config.py`` -> ``<repo>``); also valid inside the Docker image."""

PredictorKind = Literal["real", "fake"]
LogFormat = Literal["json", "text"]
RangePolicy = Literal["reject", "warn"]

ENV_PREFIX = "CARDIOTWIN_"
DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)
MAX_BATCH_ROWS_LIMIT = 256

_TRUE = frozenset({"1", "true", "yes", "on", "y"})
_FALSE = frozenset({"0", "false", "no", "off", "n", "none", "disabled"})


class SettingsError(ValueError):
    """Raised when an environment variable holds an invalid value."""


@dataclass(frozen=True, slots=True)
class Settings:
    """Immutable service configuration.

    Attributes:
        artifacts_dir: Directory holding the ML artifacts (``schema.json``, ``*.joblib`` ...).
        predictor: ``"real"`` loads :class:`cardiotwin_ml.inference.CardioTwinPredictor`;
            ``"fake"`` uses the deterministic :class:`~app.predictors.fake.FakePredictor`
            (UI development / tests only - never for demos of model performance).
        cors_origins: Allowed browser origins. ``("*",)`` allows any origin (no credentials).
        serve_frontend: Serve the built SPA from ``frontend_dist`` at ``/`` when it exists.
        frontend_dist: Path of the Vite production build (``frontend/dist``).
        model_card_path: Markdown served by ``GET /api/model-card``.
        cache_size: Capacity of the LRU cache of identical predictions (0 disables it).
        warm_cache: After startup, predict every demo-cohort patient in a background thread so cohort
            selections are answered from the cache.
        batch_max_rows: Maximum rows accepted by ``POST /api/predict/batch`` (<= 256).
        out_of_range: Numeric values outside the schema ``min``/``max`` (the training-cohort range):
            ``"reject"`` answers 422 with the allowed range; ``"warn"`` predicts anyway and lists them
            in the response ``warnings``.
        log_level: Python logging level name.
        log_format: ``"json"`` (one JSON object per line) or ``"text"``.
        gzip_min_size: Responses smaller than this many bytes are not compressed.
    """

    artifacts_dir: Path = REPO_ROOT / "ml" / "artifacts"
    predictor: PredictorKind = "real"
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    serve_frontend: bool = True
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    model_card_path: Path = REPO_ROOT / "docs" / "MODEL_CARD.md"
    cache_size: int = 2048
    warm_cache: bool = True
    batch_max_rows: int = MAX_BATCH_ROWS_LIMIT
    out_of_range: RangePolicy = "reject"
    log_level: str = "INFO"
    log_format: LogFormat = "json"
    gzip_min_size: int = 1024

    def __post_init__(self) -> None:
        if self.predictor not in get_args(PredictorKind):
            raise SettingsError(f"predictor must be one of {get_args(PredictorKind)}, got {self.predictor!r}")
        if self.out_of_range not in get_args(RangePolicy):
            raise SettingsError(f"out_of_range must be one of {get_args(RangePolicy)}, got {self.out_of_range!r}")
        if self.log_format not in get_args(LogFormat):
            raise SettingsError(f"log_format must be one of {get_args(LogFormat)}, got {self.log_format!r}")
        if self.cache_size < 0:
            raise SettingsError("cache_size must be >= 0")
        if not 1 <= self.batch_max_rows <= MAX_BATCH_ROWS_LIMIT:
            raise SettingsError(f"batch_max_rows must be between 1 and {MAX_BATCH_ROWS_LIMIT}")
        if self.gzip_min_size < 0:
            raise SettingsError("gzip_min_size must be >= 0")

    @property
    def frontend_index(self) -> Path:
        return self.frontend_dist / "index.html"

    @property
    def frontend_available(self) -> bool:
        """True when the SPA should be (and can be) served."""
        return self.serve_frontend and self.frontend_index.is_file()

    def with_overrides(self, **changes: object) -> Settings:
        """Return a copy with some fields replaced (validated again)."""
        return replace(self, **changes)  # type: ignore[arg-type]

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        """Build settings from ``CARDIOTWIN_*`` environment variables.

        Variables (all optional):

        ``CARDIOTWIN_ARTIFACTS``        artifacts directory (default ``<repo>/ml/artifacts``)
        ``CARDIOTWIN_PREDICTOR``        ``real`` (default) or ``fake``
        ``CARDIOTWIN_CORS_ORIGINS``     comma-separated origins, or ``*``
        ``CARDIOTWIN_SERVE_FRONTEND``   ``1``/``0``, or a path to the built SPA (implies enabled)
        ``CARDIOTWIN_FRONTEND_DIST``    path to the built SPA (default ``<repo>/frontend/dist``)
        ``CARDIOTWIN_MODEL_CARD``       markdown file for ``/api/model-card``
        ``CARDIOTWIN_CACHE_SIZE``       LRU capacity (default 2048, 0 disables)
        ``CARDIOTWIN_WARM_CACHE``       ``1`` (default) / ``0``: precompute demo-cohort predictions
        ``CARDIOTWIN_BATCH_MAX_ROWS``   batch limit (default and maximum 256)
        ``CARDIOTWIN_OUT_OF_RANGE``     ``reject`` (default) or ``warn``
        ``CARDIOTWIN_LOG_LEVEL``        ``DEBUG``/``INFO``/... (default ``INFO``)
        ``CARDIOTWIN_LOG_FORMAT``       ``json`` (default) or ``text``
        ``CARDIOTWIN_GZIP_MIN_SIZE``    bytes (default 1024)

        Relative paths are resolved against the repository root, so the service behaves the same
        whatever the current working directory is.
        """
        source = os.environ if env is None else env
        defaults = cls()

        def get(name: str) -> str | None:
            raw = source.get(ENV_PREFIX + name)
            if raw is None:
                return None
            raw = raw.strip()
            return raw or None

        kwargs: dict[str, object] = {}
        if (value := get("ARTIFACTS")) is not None:
            kwargs["artifacts_dir"] = _path(value)
        if (value := get("PREDICTOR")) is not None:
            kwargs["predictor"] = value.lower()
        if (value := get("CORS_ORIGINS")) is not None:
            kwargs["cors_origins"] = _origins(value)
        if (value := get("FRONTEND_DIST")) is not None:
            kwargs["frontend_dist"] = _path(value)
        if (value := get("SERVE_FRONTEND")) is not None:
            flag = _bool_or_none(value)
            if flag is None:  # a path: enable and point at it
                kwargs["serve_frontend"] = True
                kwargs["frontend_dist"] = _path(value)
            else:
                kwargs["serve_frontend"] = flag
        if (value := get("MODEL_CARD")) is not None:
            kwargs["model_card_path"] = _path(value)
        if (value := get("CACHE_SIZE")) is not None:
            kwargs["cache_size"] = _int("CACHE_SIZE", value)
        if (value := get("WARM_CACHE")) is not None:
            flag = _bool_or_none(value)
            if flag is None:
                raise SettingsError(f"{ENV_PREFIX}WARM_CACHE must be a boolean (1/0, true/false), got {value!r}")
            kwargs["warm_cache"] = flag
        if (value := get("BATCH_MAX_ROWS")) is not None:
            kwargs["batch_max_rows"] = _int("BATCH_MAX_ROWS", value)
        if (value := get("OUT_OF_RANGE")) is not None:
            kwargs["out_of_range"] = value.lower()
        if (value := get("LOG_LEVEL")) is not None:
            kwargs["log_level"] = value.upper()
        if (value := get("LOG_FORMAT")) is not None:
            kwargs["log_format"] = value.lower()
        if (value := get("GZIP_MIN_SIZE")) is not None:
            kwargs["gzip_min_size"] = _int("GZIP_MIN_SIZE", value)

        try:
            return replace(defaults, **kwargs)  # type: ignore[arg-type]
        except SettingsError as exc:
            raise SettingsError(f"Invalid CardioTwin configuration: {exc}") from exc


def _path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (REPO_ROOT / path).resolve()


def _origins(value: str) -> tuple[str, ...]:
    origins = tuple(o.strip().rstrip("/") for o in value.split(",") if o.strip())
    if "*" in origins:
        return ("*",)
    return origins


def _bool_or_none(value: str) -> bool | None:
    lowered = value.lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    return None


def _int(name: str, value: str) -> int:
    try:
        return int(value)
    except ValueError:
        raise SettingsError(f"{ENV_PREFIX}{name} must be an integer, got {value!r}") from None
