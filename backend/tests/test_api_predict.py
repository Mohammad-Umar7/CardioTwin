"""POST /api/predict: contract shape, explanation invariants, imputation and caching."""

from __future__ import annotations

import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.predictors.fake import FakePredictor
from app.models import TARGET_ORDER as TARGETS

PATIENT = {"Age": 67, "Sex": "Male", "DM": 1, "HTN": 1, "Typical Chest Pain": 1, "EF-TTE": 35, "Region RWMA": 3}


def band_for(probability: float) -> str:
    for band, upper in (("low", 0.25), ("moderate", 0.5), ("high", 0.75)):
        if probability < upper:
            return band
    return "critical"


def predict(client: TestClient, features: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/predict", json={"features": features})
    assert response.status_code == 200, response.text
    return response.json()


def test_response_matches_contract_shape(client: TestClient) -> None:
    body = predict(client, PATIENT)
    assert {"model_version", "engine", "imputed", "predictions", "explanations", "summary"} <= set(body)
    assert body["engine"] == "server"
    assert body["model_version"] == "0.0.0-fake"
    assert list(body["predictions"]) == list(TARGETS)
    for target in TARGETS:
        prediction = body["predictions"][target]
        assert set(prediction) >= {"probability", "label", "threshold", "risk_band", "logit"}
        explanation = body["explanations"][target]
        assert explanation["space"] == "log-odds"
        assert set(explanation) >= {"base_value", "output_value", "contributions"}
        for item in explanation["contributions"]:
            assert set(item) >= {"feature", "value", "shap"}
    assert set(body["summary"]) >= {"expected_diseased_vessels", "highest_risk_vessel"}


def test_shap_values_are_additive_in_log_odds_space(client: TestClient) -> None:
    body = predict(client, PATIENT)
    for target in TARGETS:
        explanation = body["explanations"][target]
        total = explanation["base_value"] + math.fsum(c["shap"] for c in explanation["contributions"])
        assert total == pytest.approx(explanation["output_value"], abs=1e-6)
        assert explanation["output_value"] == pytest.approx(body["predictions"][target]["logit"], abs=1e-12)


def test_contributions_cover_every_raw_feature_sorted_by_magnitude(
    client: TestClient, schema_features: dict[str, dict[str, Any]]
) -> None:
    body = predict(client, PATIENT)
    for target in TARGETS:
        contributions = body["explanations"][target]["contributions"]
        assert {c["feature"] for c in contributions} == set(schema_features)
        magnitudes = [abs(c["shap"]) for c in contributions]
        assert magnitudes == sorted(magnitudes, reverse=True)
    values = {c["feature"]: c["value"] for c in body["explanations"]["CAD"]["contributions"]}
    assert values["Age"] == 67
    assert values["Sex"] == "Male"


def test_probabilities_labels_and_bands_are_consistent(client: TestClient) -> None:
    body = predict(client, PATIENT)
    for target in TARGETS:
        p = body["predictions"][target]
        assert 0.0 <= p["probability"] <= 1.0
        assert p["label"] == int(p["probability"] >= p["threshold"])
        assert p["risk_band"] == band_for(p["probability"])


def test_summary_aggregates_vessel_probabilities(client: TestClient) -> None:
    body = predict(client, PATIENT)
    vessels = {v: body["predictions"][v]["probability"] for v in ("LAD", "LCX", "RCA")}
    assert body["summary"]["expected_diseased_vessels"] == pytest.approx(sum(vessels.values()))
    assert body["summary"]["highest_risk_vessel"] == max(vessels, key=vessels.__getitem__)


def test_missing_and_null_features_are_imputed(client: TestClient, schema_features: dict[str, Any]) -> None:
    body = predict(client, {"Age": 50, "ESR": None})
    assert "Age" not in body["imputed"]
    assert "ESR" in body["imputed"]
    assert set(body["imputed"]) == set(schema_features) - {"Age"}


def test_empty_request_imputes_everything(client: TestClient, schema_features: dict[str, Any]) -> None:
    body = client.post("/api/predict", json={}).json()
    assert set(body["imputed"]) == set(schema_features)
    for target in TARGETS:
        explanation = body["explanations"][target]
        assert explanation["output_value"] == pytest.approx(explanation["base_value"])  # defaults = baseline


def test_equivalent_encodings_give_identical_predictions(client: TestClient) -> None:
    canonical = predict(client, {"Age": 60, "DM": 1, "Sex": "Female", "BBB": "LBBB"})
    variants = [
        {"Age": "60", "DM": "Y", "Sex": "female", "BBB": "lbbb"},
        {"Age": 60.0, "DM": True, "Sex": "Fmale", "BBB": "Left bundle branch block"},
    ]
    for variant in variants:
        assert predict(client, variant)["predictions"] == canonical["predictions"]


def test_changing_a_risk_factor_moves_the_prediction(client: TestClient) -> None:
    without = predict(client, {**PATIENT, "Typical Chest Pain": 0})
    with_pain = predict(client, PATIENT)
    assert with_pain["predictions"]["CAD"]["probability"] > without["predictions"]["CAD"]["probability"]


def test_identical_requests_hit_the_cache(client: TestClient, predictor: FakePredictor) -> None:
    first = client.post("/api/predict", json={"features": PATIENT})
    second = client.post("/api/predict", json={"features": dict(reversed(list(PATIENT.items())))})
    assert first.headers["X-Cache"] == "MISS"
    assert second.headers["X-Cache"] == "HIT"
    assert first.content == second.content
    assert predictor.calls == 1
    assert first.headers["X-Model-Version"] == "0.0.0-fake"


def test_cache_can_be_disabled(make_client: Any, predictor: FakePredictor) -> None:
    client = make_client(cache_size=0)
    for _ in range(3):
        assert client.post("/api/predict", json={"features": PATIENT}).headers["X-Cache"] == "MISS"
    assert predictor.calls == 3


def test_extra_fields_added_by_the_model_are_passed_through(make_client: Any) -> None:
    class ExtendedPredictor(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            result = super().predict(features)
            result["calibration"] = "platt"
            result["predictions"]["CAD"]["ci"] = [0.1, 0.9]
            return result

    body = make_client(predictor_override=ExtendedPredictor()).post("/api/predict", json={}).json()
    assert body["calibration"] == "platt"
    assert body["predictions"]["CAD"]["ci"] == [0.1, 0.9]
