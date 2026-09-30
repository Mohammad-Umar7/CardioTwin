"""Unit tests for the LRU cache, JSON conversion, logging and the fake predictor itself."""

from __future__ import annotations

import io
import json
import logging
import math
import threading

import pytest

from app.cache import LRUCache
from app.logging_config import JsonFormatter, RequestIdFilter, configure_logging, request_id_var
from app.models import FeatureSchema
from app.predictors.fake import FakePredictor
from app.runtime import StaticDocument, to_jsonable
from app.validation import FeatureValidationError, FeatureValidator

# -- LRU cache --------------------------------------------------------------------------------


def test_lru_evicts_least_recently_used() -> None:
    cache: LRUCache[str, int] = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1  # a is now most recent
    cache.put("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3
    assert cache.stats() == {"capacity": 2, "size": 2, "hits": 3, "misses": 1}


def test_lru_capacity_zero_disables_caching() -> None:
    cache: LRUCache[str, int] = LRUCache(0)
    cache.put("a", 1)
    assert cache.get("a") is None
    assert len(cache) == 0


def test_lru_rejects_negative_capacity() -> None:
    with pytest.raises(ValueError):
        LRUCache(-1)


def test_lru_is_thread_safe() -> None:
    cache: LRUCache[int, int] = LRUCache(64)

    def worker(offset: int) -> None:
        for i in range(2000):
            key = (i + offset) % 128
            if cache.get(key) is None:
                cache.put(key, key)

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    stats = cache.stats()
    assert stats["size"] <= 64
    assert stats["hits"] + stats["misses"] == 8 * 2000
    cache.clear()
    assert cache.stats() == {"capacity": 64, "size": 0, "hits": 0, "misses": 0}


# -- JSON helpers -----------------------------------------------------------------------------


def test_to_jsonable_converts_numpy_and_tuples() -> None:
    np = pytest.importorskip("numpy")
    data = {"a": np.float64(0.5), "b": (np.int32(2), [np.bool_(True)]), 3: np.arange(3)}
    assert to_jsonable(data) == {"a": 0.5, "b": [2, [True]], "3": [0, 1, 2]}
    assert json.dumps(to_jsonable(data))


def test_static_document_etag_is_stable_and_content_addressed() -> None:
    first = StaticDocument.from_obj({"x": 1})
    assert first == StaticDocument.from_obj({"x": 1})
    assert first.etag != StaticDocument.from_obj({"x": 2}).etag
    assert first.etag.startswith('"') and first.etag.endswith('"')


# -- logging ----------------------------------------------------------------------------------


def test_json_logs_carry_request_id_and_extras() -> None:
    record = logging.LogRecord("cardiotwin.test", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    record.duration_ms = 1.5
    token = request_id_var.set("rid-1")
    try:
        RequestIdFilter().filter(record)
    finally:
        request_id_var.reset(token)
    payload = json.loads(JsonFormatter().format(record))
    assert payload["msg"] == "hello world"
    assert payload["request_id"] == "rid-1"
    assert payload["duration_ms"] == 1.5
    assert payload["level"] == "INFO"


def test_configure_logging_is_idempotent() -> None:
    logger = configure_logging("INFO", "json")
    configure_logging("INFO", "json")
    own = [h for h in logger.handlers if getattr(h, "_cardiotwin", False)]
    assert len(own) == 1
    stream = io.StringIO()
    own[0].setStream(stream)  # type: ignore[attr-defined]
    logger.info("event", extra={"k": "v"})
    assert json.loads(stream.getvalue())["k"] == "v"


# -- validator on its own ---------------------------------------------------------------------


def test_validator_normalises_types_and_drops_nulls() -> None:
    validator = FeatureValidator(FeatureSchema.model_validate(FakePredictor().schema))
    clean = validator.normalize({"Age": "61.5", "DM": "n", "Sex": "MALE", "ESR": None, "BBB": "RBBB"})
    assert clean == {"Age": 61.5, "DM": 0, "Sex": "Male", "BBB": "RBBB"}


def test_validator_error_lists_every_issue() -> None:
    validator = FeatureValidator(FeatureSchema.model_validate(FakePredictor().schema))
    with pytest.raises(FeatureValidationError) as info:
        validator.normalize({"Age": 1, "DM": 9}, loc=("x",))
    assert [issue.loc for issue in info.value.issues] == [("x", "Age"), ("x", "DM")]
    assert "Age=1 is outside the allowed range" in str(info.value)


def test_plain_string_options_are_accepted_in_schema() -> None:
    raw = FakePredictor().schema
    for feature in raw["features"]:
        if feature["key"] == "VHD":
            feature["options"] = ["N", "mild", "Moderate", "Severe"]
    schema = FeatureSchema.model_validate(raw)
    assert FeatureValidator(schema).normalize({"VHD": "moderate"}) == {"VHD": "Moderate"}


def test_open_ended_range_message() -> None:
    raw = FakePredictor().schema
    for feature in raw["features"]:
        if feature["key"] == "ESR":
            feature["max"] = None
    validator = FeatureValidator(FeatureSchema.model_validate(raw))
    assert validator.normalize({"ESR": 5000}) == {"ESR": 5000}
    with pytest.raises(FeatureValidationError, match=r"allowed range >= 1 mm/h"):
        validator.normalize({"ESR": 0})


# -- fake predictor ---------------------------------------------------------------------------


def test_fake_predictor_is_deterministic_and_additive() -> None:
    a, b = FakePredictor(), FakePredictor()
    features = {"Age": 70, "DM": 1, "VHD": "Severe", "BBB": "LBBB"}
    assert a.predict(features) == b.predict(features)
    for explanation in a.predict(features)["explanations"].values():
        total = explanation["base_value"] + math.fsum(c["shap"] for c in explanation["contributions"])
        assert total == pytest.approx(explanation["output_value"], abs=1e-12)


def test_fake_predictor_rejects_unknown_features() -> None:
    with pytest.raises(KeyError):
        FakePredictor().predict({"LAD": 1})
