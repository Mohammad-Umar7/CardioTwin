"""The published OpenAPI models carry every field that docs/CONTRACTS.md defines (names never drift)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

# Field names copied from docs/CONTRACTS.md; the API may add fields but never rename or remove these.
CONTRACT_FIELDS: dict[str, set[str]] = {
    "HealthResponse": {"status", "model_version", "targets", "engine"},  # §3.1
    "PredictResponse": {"model_version", "engine", "imputed", "predictions", "explanations", "summary"},  # §3.2
    "TargetPrediction": {"probability", "label", "threshold", "risk_band", "logit"},
    "Explanation": {"space", "base_value", "output_value", "contributions"},
    "Contribution": {"feature", "value", "shap"},
    "PredictionSummary": {"expected_diseased_vessels", "highest_risk_vessel"},
    "CohortResponse": {"patients"},  # §3.3
    "CohortPatient": {"id", "split", "summary", "features", "labels"},
    "FeatureSchema": {"version", "groups", "features", "targets", "risk_bands"},  # §2
    "FeatureSpec": {"key", "label", "group", "type", "unit", "min", "max", "step", "default", "normal",
                    "description", "options"},
    "FeatureGroup": {"id", "label", "order", "icon"},
    "TargetSpec": {"id", "label", "short", "anatomy", "description", "territory"},
    "RiskBand": {"id", "max"},
    "MetricsReport": {"version", "generated_at", "dataset", "protocol", "targets"},  # §4
}


@pytest.fixture(scope="module")
def components() -> dict[str, Any]:
    from app.config import Settings
    from app.main import create_app
    from app.predictors.fake import FakePredictor

    app = create_app(Settings(predictor="fake", serve_frontend=False, log_level="WARNING"), predictor=FakePredictor())
    with TestClient(app) as client:
        schemas: dict[str, Any] = client.get("/openapi.json").json()["components"]["schemas"]
    return schemas


@pytest.mark.parametrize("model", sorted(CONTRACT_FIELDS))
def test_openapi_model_has_contract_fields(components: dict[str, Any], model: str) -> None:
    properties = set(components[model]["properties"])
    missing = CONTRACT_FIELDS[model] - properties
    assert not missing, f"{model} lacks contract fields {sorted(missing)}"


def test_risk_band_and_engine_enumerations(components: dict[str, Any]) -> None:
    assert components["TargetPrediction"]["properties"]["risk_band"]["enum"] == ["low", "moderate", "high",
                                                                                 "critical"]
    assert components["PredictResponse"]["properties"]["engine"]["enum"] == ["server", "edge"]
    # Open on purpose: vessel targets added to the schema later must not require an API change.
    assert "enum" not in components["PredictionSummary"]["properties"]["highest_risk_vessel"]


def test_response_models_accept_added_fields(components: dict[str, Any]) -> None:
    for model in ("PredictResponse", "TargetPrediction", "Explanation", "CohortPatient", "FeatureSpec"):
        assert components[model].get("additionalProperties", True) is not False, model


def test_request_models_reject_unknown_fields(components: dict[str, Any]) -> None:
    for model in ("PredictRequest", "BatchPredictRequest", "BatchRow"):
        assert components[model]["additionalProperties"] is False, model
