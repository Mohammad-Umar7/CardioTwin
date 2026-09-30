"""End-to-end tests against the real trained predictor (``cardiotwin_ml`` + ``ml/artifacts``).

Skipped automatically until the ML pipeline has produced its artifacts. Set
``CARDIOTWIN_ARTIFACTS`` to test a different artifacts directory.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import LEAKAGE_KEYS
from app.models import TARGET_ORDER as TARGETS
from app.predictors.loader import REQUIRED_ARTIFACTS, ml_package_available

ARTIFACTS = Settings.from_env().artifacts_dir


def _skip_reason() -> str | None:
    missing = [name for name in REQUIRED_ARTIFACTS if not (ARTIFACTS / name).is_file()]
    if missing:
        return f"ML artifacts not built ({ARTIFACTS}; missing {', '.join(missing)})"
    if not ml_package_available():
        return "cardiotwin_ml.inference is not importable"
    return None


SKIP_REASON = _skip_reason()
pytestmark = [pytest.mark.integration, pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")]


@pytest.fixture(scope="module")
def real_client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    tmp = tmp_path_factory.mktemp("integration")
    settings = Settings(
        artifacts_dir=ARTIFACTS,
        predictor="real",
        serve_frontend=False,
        model_card_path=tmp / "absent.md",
        log_level="WARNING",
        log_format="text",
    )
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture(scope="module")
def schema(real_client: TestClient) -> dict[str, Any]:
    body: dict[str, Any] = real_client.get("/api/schema").json()
    return body


def _predict(client: TestClient, features: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/predict", json={"features": features})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _assert_valid_prediction(body: dict[str, Any], feature_keys: set[str]) -> None:
    assert body["engine"] == "server"
    for target in TARGETS:
        prediction = body["predictions"][target]
        assert 0.0 <= prediction["probability"] <= 1.0
        assert prediction["label"] == int(prediction["probability"] >= prediction["threshold"])
        explanation = body["explanations"][target]
        assert explanation["space"] == "log-odds"
        total = explanation["base_value"] + math.fsum(c["shap"] for c in explanation["contributions"])
        assert total == pytest.approx(explanation["output_value"], abs=1e-6)
        assert explanation["output_value"] == pytest.approx(prediction["logit"], abs=1e-9)
        assert {c["feature"] for c in explanation["contributions"]} <= feature_keys
        magnitudes = [abs(c["shap"]) for c in explanation["contributions"]]
        assert magnitudes == sorted(magnitudes, reverse=True)
    vessels = {v: body["predictions"][v]["probability"] for v in ("LAD", "LCX", "RCA")}
    assert body["summary"]["expected_diseased_vessels"] == pytest.approx(sum(vessels.values()), abs=1e-9)
    assert body["summary"]["highest_risk_vessel"] == max(vessels, key=vessels.__getitem__)


def test_health_reports_the_real_model(real_client: TestClient) -> None:
    body = real_client.get("/api/health").json()
    assert body["predictor"] == "real"
    assert body["targets"] == list(TARGETS)
    assert body["n_features"] > 20


def test_schema_has_no_leakage_and_valid_groups(schema: dict[str, Any]) -> None:
    keys = {f["key"] for f in schema["features"]}
    assert not keys & LEAKAGE_KEYS
    assert "Exertional CP" not in keys  # constant column in the dataset
    groups = {g["id"] for g in schema["groups"]}
    assert {f["group"] for f in schema["features"]} <= groups
    assert [t["id"] for t in schema["targets"]][:4] == list(TARGETS)


def test_default_patient_prediction(real_client: TestClient, schema: dict[str, Any]) -> None:
    body = _predict(real_client, {})
    keys = {f["key"] for f in schema["features"]}
    assert set(body["imputed"]) == keys
    _assert_valid_prediction(body, keys)


def test_every_cohort_patient_predicts_consistently(real_client: TestClient, schema: dict[str, Any]) -> None:
    keys = {f["key"] for f in schema["features"]}
    patients = real_client.get("/api/cohort").json()["patients"]
    assert patients
    for patient in patients:
        response = real_client.get(f"/api/cohort/{patient['id']}/prediction")
        assert response.status_code == 200, response.text
        body = response.json()
        _assert_valid_prediction(body["prediction"], keys)
        assert set(body["agreement"]) == set(TARGETS) & set(patient["labels"])


def test_batch_matches_single_predictions(real_client: TestClient) -> None:
    patients = real_client.get("/api/cohort").json()["patients"][:16]
    rows = [{"id": p["id"], "features": p["features"]} for p in patients]
    batch = real_client.post("/api/predict/batch", json={"rows": rows})
    assert batch.status_code == 200, batch.text
    for row, result in zip(rows, batch.json()["results"], strict=True):
        assert result["id"] == row["id"]
        assert result["prediction"] == _predict(real_client, row["features"])


def test_fixtures_parity(real_client: TestClient) -> None:
    """The server reproduces the ML package's reference fixtures (contract §1 fixtures.json)."""
    path = Path(ARTIFACTS) / "fixtures.json"
    if not path.is_file():
        pytest.skip("fixtures.json not produced")
    raw = json.loads(path.read_text(encoding="utf-8"))
    fixtures = raw["fixtures"] if isinstance(raw, dict) and "fixtures" in raw else raw
    assert len(fixtures) >= 1
    for fixture in fixtures:
        body = _predict(real_client, fixture["features"])
        expected = fixture["expected"]
        for target in TARGETS:
            want = expected.get("predictions", {}).get(target)
            if want is None:
                continue
            got = body["predictions"][target]
            assert got["probability"] == pytest.approx(want["probability"], abs=1e-6)
            assert got["label"] == want["label"]
            want_expl = expected.get("explanations", {}).get(target)
            if want_expl:
                got_shap = {c["feature"]: c["shap"] for c in body["explanations"][target]["contributions"]}
                for item in want_expl["contributions"]:
                    assert got_shap[item["feature"]] == pytest.approx(item["shap"], abs=1e-5)


def test_out_of_range_input_is_rejected_with_the_schema_range(
    real_client: TestClient, schema: dict[str, Any]
) -> None:
    numeric = next(f for f in schema["features"] if f["type"] == "numeric" and f.get("max") is not None)
    response = real_client.post("/api/predict", json={"features": {numeric["key"]: numeric["max"] + 1000}})
    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["type"] == "out_of_range"
    assert error["ctx"]["max"] == numeric["max"]


def test_model_card_and_metrics_are_served(real_client: TestClient) -> None:
    metrics = real_client.get("/api/metrics").json()
    assert set(TARGETS) <= set(metrics["targets"])
    card = real_client.get("/api/model-card")
    assert card.status_code == 200
    assert "CardioTwin" in card.text
