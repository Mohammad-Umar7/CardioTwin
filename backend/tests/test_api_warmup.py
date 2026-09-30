"""Background warm-up of the prediction cache with the demo cohort."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, SettingsError
from app.predictors.fake import FakePredictor


def _wait_for_warmup(client: TestClient) -> None:
    thread = client.app.state.warmup_thread  # type: ignore[attr-defined]
    assert thread is not None
    thread.join(timeout=10)
    assert not thread.is_alive()


def test_cohort_predictions_are_precomputed(make_client: Any, predictor: FakePredictor) -> None:
    client = make_client(warm_cache=True)
    _wait_for_warmup(client)
    n_patients = len(predictor.cohort["patients"])
    assert predictor.calls == n_patients
    assert client.get("/api/health").json()["cache_warmup"] == "done"
    response = client.get("/api/cohort/P-004/prediction")
    assert response.headers["X-Cache"] == "HIT"
    features = client.get("/api/cohort/P-002").json()["features"]
    assert client.post("/api/predict", json={"features": features}).headers["X-Cache"] == "HIT"
    assert predictor.calls == n_patients


@pytest.mark.parametrize("overrides", [{"warm_cache": False}, {"warm_cache": True, "cache_size": 0}])
def test_warmup_can_be_disabled(make_client: Any, predictor: FakePredictor, overrides: dict[str, Any]) -> None:
    client = make_client(**overrides)
    assert client.app.state.warmup_thread is None  # type: ignore[attr-defined]
    assert client.get("/api/health").json()["cache_warmup"] == "disabled"
    assert predictor.calls == 0


def test_warmup_skips_patients_that_fail(make_client: Any) -> None:
    class Flaky(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            if features.get("Age") == 41:  # P-002
                raise RuntimeError("transient failure")
            return super().predict(features)

    flaky = Flaky()
    client = make_client(predictor_override=flaky, warm_cache=True)
    _wait_for_warmup(client)
    assert flaky.calls == len(flaky.cohort["patients"]) - 1
    assert client.get("/api/cohort/P-001/prediction").headers["X-Cache"] == "HIT"


def test_warm_cache_setting_from_env() -> None:
    assert Settings.from_env({}).warm_cache is True
    assert Settings.from_env({"CARDIOTWIN_WARM_CACHE": "0"}).warm_cache is False
    with pytest.raises(SettingsError, match="CARDIOTWIN_WARM_CACHE must be a boolean"):
        Settings.from_env({"CARDIOTWIN_WARM_CACHE": "sometimes"})
