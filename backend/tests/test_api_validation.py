"""Helpful 422 errors: unknown features, leakage, wrong types, physiologic bounds, options."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient


def errors_for(client: TestClient, features: Any) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    response = client.post("/api/predict", json={"features": features})
    assert response.status_code == 422, response.text
    body = response.json()
    by_key = {str(item["loc"][-1]): item for item in body["detail"]}
    return body, by_key


def test_error_envelope_and_request_id(client: TestClient) -> None:
    response = client.post("/api/predict", json={"features": {"Age": 200}}, headers={"X-Request-ID": "req-42"})
    body = response.json()
    assert body["error"] == "validation_error"
    assert body["request_id"] == "req-42" == response.headers["X-Request-ID"]
    assert body["message"].startswith("features.Age: Age=200 is outside the allowed range 30–86 years")


def test_unknown_feature_suggests_close_matches(client: TestClient) -> None:
    _, errors = errors_for(client, {"age": 50, "Typical Chest Pian": 1, "Totally Unrelated": 3})
    assert errors["age"]["type"] == "unknown_feature"
    assert errors["age"]["ctx"]["suggestions"] == ["Age"]
    assert "did you mean 'Age'" in errors["age"]["msg"]
    assert errors["Typical Chest Pian"]["ctx"]["suggestions"][0] == "Typical Chest Pain"
    assert "ctx" not in errors["Totally Unrelated"]
    assert "GET /api/schema" in errors["Totally Unrelated"]["msg"]


@pytest.mark.parametrize("target", ["LAD", "LCX", "RCA", "Cath"])
def test_target_columns_are_rejected_as_leakage(client: TestClient, target: str) -> None:
    _, errors = errors_for(client, {target: 1})
    assert errors[target]["type"] == "leakage_feature"
    assert "leakage" in errors[target]["msg"]


@pytest.mark.parametrize(("key", "value", "lo", "hi", "unit"), [
    ("Age", 29, 30, 86, "years"),
    ("Age", 150, 30, 86, "years"),
    ("EF-TTE", 80, 15, 60, "%"),
    ("FBS", -3, 62, 400, "mg/dL"),
])
def test_out_of_range_values_report_the_allowed_range(
    client: TestClient, key: str, value: float, lo: float, hi: float, unit: str
) -> None:
    _, errors = errors_for(client, {key: value})
    error = errors[key]
    assert error["type"] == "out_of_range"
    assert error["ctx"] == {"min": lo, "max": hi, "unit": unit}
    assert f"{lo}–{hi} {unit}" in error["msg"]
    assert error["input"] == value


def test_boundary_values_are_accepted(client: TestClient) -> None:
    assert client.post("/api/predict", json={"features": {"Age": 30, "EF-TTE": 60}}).status_code == 200


@pytest.mark.parametrize("value", ["abc", [1, 2], {"v": 1}, True])
def test_numeric_features_reject_non_numbers(client: TestClient, value: Any) -> None:
    _, errors = errors_for(client, {"Age": value})
    assert errors["Age"]["type"] == "type_error"
    assert errors["Age"]["ctx"]["expected"] == "a number"
    assert errors["Age"]["ctx"]["min"] == 30


def test_non_finite_numbers_are_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/predict", content=b'{"features": {"Age": NaN}}', headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "finite_number"


@pytest.mark.parametrize("value", [2, -1, 0.5, "maybe", [1]])
def test_binary_features_require_yes_no_values(client: TestClient, value: Any) -> None:
    _, errors = errors_for(client, {"DM": value})
    assert errors["DM"]["type"] == "binary_value"
    assert errors["DM"]["ctx"]["allowed"] == [0, 1]


@pytest.mark.parametrize("value", ["Unknown", 3, True])
def test_categorical_features_list_allowed_options(client: TestClient, value: Any) -> None:
    _, errors = errors_for(client, {"VHD": value})
    assert errors["VHD"]["type"] == "invalid_option"
    assert errors["VHD"]["ctx"]["allowed"] == ["N", "mild", "Moderate", "Severe"]
    assert "N, mild, Moderate, Severe" in errors["VHD"]["msg"]


def test_all_problems_are_reported_together(client: TestClient) -> None:
    body, errors = errors_for(client, {"Age": 5, "DM": 7, "Sex": "X", "LAD": 1, "Foo": 1, "BMI": 25})
    assert set(errors) == {"Age", "DM", "Sex", "LAD", "Foo"}
    assert body["message"].endswith("(+4 more)")
    assert all(item["loc"][:2] == ["body", "features"] for item in body["detail"])


def test_features_sent_without_wrapper_get_a_hint(client: TestClient) -> None:
    response = client.post("/api/predict", json={"Age": 60})
    assert response.status_code == 422
    body = response.json()
    assert body["detail"][0]["type"] == "extra_forbidden"
    assert '{"features": {' in body["message"]


@pytest.mark.parametrize("payload", [b"{not json", b'{"features": [1, 2]}', b'"text"'])
def test_malformed_bodies_are_422(client: TestClient, payload: bytes) -> None:
    response = client.post("/api/predict", content=payload, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "validation_error"
    assert body["detail"]
    assert "url" not in body["detail"][0]


def test_out_of_range_rejection_explains_the_training_range(client: TestClient) -> None:
    _, errors = errors_for(client, {"Age": 95})
    assert "range of the training cohort" in errors["Age"]["msg"]


def test_warn_policy_predicts_out_of_range_values_with_warnings(make_client: Any) -> None:
    client = make_client(out_of_range="warn")
    response = client.post("/api/predict", json={"features": {"Age": 95, "EF-TTE": 10, "BMI": 25}})
    assert response.status_code == 200
    body = response.json()
    by_feature = {w["feature"]: w for w in body["warnings"]}
    assert set(by_feature) == {"Age", "EF-TTE"}
    assert by_feature["Age"] | {"msg": ""} == {"type": "out_of_range", "feature": "Age", "value": 95, "min": 30,
                                                "max": 86, "unit": "years", "msg": ""}
    assert "extrapolates" in by_feature["Age"]["msg"]
    values = {c["feature"]: c["value"] for c in body["explanations"]["CAD"]["contributions"]}
    assert values["Age"] == 95
    # Warnings are cached with the prediction; in-range requests carry no warnings key at all.
    assert client.post("/api/predict", json={"features": {"Age": 95, "EF-TTE": 10, "BMI": 25}}).json() == body
    assert "warnings" not in client.post("/api/predict", json={"features": {"Age": 60}}).json()


def test_warn_policy_still_rejects_invalid_values(make_client: Any) -> None:
    client = make_client(out_of_range="warn")
    response = client.post("/api/predict", json={"features": {"Age": "old", "Foo": 1}})
    assert response.status_code == 422
    assert {item["type"] for item in response.json()["detail"]} == {"type_error", "unknown_feature"}


def test_warn_policy_applies_to_batches(make_client: Any) -> None:
    client = make_client(out_of_range="warn")
    body = client.post("/api/predict/batch", json={"rows": [{"features": {"Age": 20}}, {"features": {}}]}).json()
    assert body["results"][0]["prediction"]["warnings"][0]["feature"] == "Age"
    assert "warnings" not in body["results"][1]["prediction"]
