"""Loaded-model runtime: the predictor plus everything derived from it once at startup.

Static documents (schema, metrics, cohort) are serialised once and served as bytes with strong
ETags; predictions go through :class:`PredictionService` (validation -> LRU cache -> predictor ->
contract check -> JSON bytes).
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.cache import LRUCache
from app.logging_config import get_logger
from app.models import (
    LEAKAGE_KEYS,
    TARGET_ORDER,
    CohortPatient,
    CohortResponse,
    FeatureSchema,
    MetricsReport,
    PredictResponse,
)
from app.predictors.base import Predictor, PredictorContractError
from app.validation import FeatureValidator, Loc

log = get_logger("runtime")


def to_jsonable(obj: Any) -> Any:
    """Convert ML outputs (possibly holding numpy scalars/arrays or tuples) into plain JSON types."""
    if obj is None or isinstance(obj, (str, bool, int, float)):
        return obj
    if isinstance(obj, Mapping):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if hasattr(obj, "dtype"):  # numpy scalar or array, without importing numpy here
        if hasattr(obj, "tolist"):
            return to_jsonable(obj.tolist())
        return to_jsonable(obj.item())
    if hasattr(obj, "model_dump"):
        return to_jsonable(obj.model_dump(mode="json"))
    return str(obj)


def dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


@dataclass(frozen=True, slots=True)
class StaticDocument:
    """A JSON document serialised once, with a strong ETag for conditional GETs."""

    body: bytes
    etag: str

    @classmethod
    def from_obj(cls, obj: Any) -> StaticDocument:
        body = dumps(obj)
        return cls(body=body, etag='"' + hashlib.sha256(body).hexdigest()[:32] + '"')


@dataclass(frozen=True, slots=True)
class PredictionResult:
    """A contract-validated prediction. ``data`` is shared through the cache: treat it as read-only."""

    body: bytes
    data: dict[str, Any]


class PredictionService:
    """Validate features, consult the LRU cache, call the predictor, enforce the output contract."""

    def __init__(self, predictor: Predictor, schema: FeatureSchema, targets: list[str], cache_size: int) -> None:
        self.predictor = predictor
        self.validator = FeatureValidator(schema)
        self.targets = targets
        self.cache: LRUCache[str, PredictionResult] = LRUCache(cache_size)
        # Serialise calls into the model: SHAP explainers are not guaranteed to be thread-safe.
        self._lock = threading.Lock()

    def predict(self, features: Mapping[str, Any], loc: Loc = ("body", "features")) -> tuple[PredictionResult, bool]:
        """Return ``(result, cache_hit)``; raises ``FeatureValidationError`` on bad input."""
        return self.predict_normalized(self.validator.normalize(features, loc))

    def predict_normalized(self, features: Mapping[str, Any]) -> tuple[PredictionResult, bool]:
        key = json.dumps(features, sort_keys=True, separators=(",", ":"), default=str)
        cached = self.cache.get(key)
        if cached is not None:
            return cached, True
        started = time.perf_counter()
        with self._lock:
            raw = self.predictor.predict(dict(features))
        result = self._conform(raw)
        self.cache.put(key, result)
        log.debug("model inference", extra={"inference_ms": round((time.perf_counter() - started) * 1000, 3)})
        return result, False

    def _conform(self, raw: Any) -> PredictionResult:
        data = to_jsonable(raw)
        try:
            model = PredictResponse.model_validate(data)
        except ValidationError as exc:
            raise PredictorContractError(f"Predictor output violates docs/CONTRACTS.md §3.2: {exc}") from exc
        missing = [t for t in self.targets if t not in model.predictions or t not in model.explanations]
        if missing:
            raise PredictorContractError(f"Predictor output lacks predictions/explanations for {missing}")
        dumped = model.model_dump(mode="json")
        return PredictionResult(body=dumps(dumped), data=dumped)


@dataclass
class Runtime:
    """Everything the routers need, built once from a loaded predictor."""

    predictor: Predictor
    kind: str
    schema: FeatureSchema
    targets: list[str]
    model_version: str
    service: PredictionService
    schema_doc: StaticDocument
    metrics_doc: StaticDocument
    cohort_doc: StaticDocument
    cohort_index: dict[str, CohortPatient]
    started_at: float

    @classmethod
    def build(cls, predictor: Predictor, kind: str, cache_size: int) -> Runtime:
        """Validate the predictor's documents against the contract and precompute responses.

        Raises:
            PredictorContractError: when the schema or cohort cannot be served safely.
        """
        schema_raw = to_jsonable(predictor.schema)
        try:
            schema = FeatureSchema.model_validate(schema_raw)
        except ValidationError as exc:
            raise PredictorContractError(f"schema.json violates docs/CONTRACTS.md §2: {exc}") from exc
        leaked = sorted(LEAKAGE_KEYS & {f.key for f in schema.features})
        if leaked:
            raise PredictorContractError(f"schema.json lists target columns {leaked} as model inputs (leakage)")

        declared = [t.id for t in schema.targets]
        targets = [t for t in TARGET_ORDER if t in declared] + [t for t in declared if t not in TARGET_ORDER]

        cohort_raw = to_jsonable(predictor.cohort)
        try:
            cohort = CohortResponse.model_validate(cohort_raw)
        except ValidationError as exc:
            raise PredictorContractError(f"cohort.json violates docs/CONTRACTS.md §3.3: {exc}") from exc

        metrics_raw = to_jsonable(predictor.metrics)
        try:
            MetricsReport.model_validate(metrics_raw)
        except ValidationError as exc:  # served verbatim; a drift here must not take the API down
            log.warning("metrics.json deviates from docs/CONTRACTS.md §4", extra={"error": str(exc)})

        return cls(
            predictor=predictor,
            kind=kind,
            schema=schema,
            targets=targets,
            model_version=str(predictor.version),
            service=PredictionService(predictor, schema, targets, cache_size),
            schema_doc=StaticDocument.from_obj(schema_raw),
            metrics_doc=StaticDocument.from_obj(metrics_raw),
            cohort_doc=StaticDocument.from_obj(cohort_raw),
            cohort_index={p.id: p for p in cohort.patients},
            started_at=time.monotonic(),
        )

    @property
    def uptime_s(self) -> float:
        return round(time.monotonic() - self.started_at, 3)
