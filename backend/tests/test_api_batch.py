"""POST /api/predict/batch: ordering, parity with single predictions, limits and row-level errors."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.predictors.fake import FakePredictor


def rows(n: int) -> list[dict[str, Any]]:
    return [{"id": f"r{i}", "features": {"Age": 30 + i % 57, "DM": i % 2}} for i in range(n)]


def test_batch_returns_results_in_request_order(client: TestClient) -> None:
    payload = {"rows": [{"id": "old", "features": {"Age": 80}}, {"features": {"Age": 35}}, {"id": "mid",
                                                                                           "features": {}}]}
    response = client.post("/api/predict/batch", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 3
    assert body["engine"] == "server"
    assert body["model_version"] == "0.0.0-fake"
    assert [r["index"] for r in body["results"]] == [0, 1, 2]
    assert [r["id"] for r in body["results"]] == ["old", None, "mid"]


def test_batch_matches_single_predictions(client: TestClient) -> None:
    features = {"Age": 71, "Sex": "Female", "DM": 1, "EF-TTE": 40}
    single = client.post("/api/predict", json={"features": features}).json()
    batch = client.post("/api/predict/batch", json={"rows": [{"features": features}]}).json()
    assert batch["results"][0]["prediction"] == single


def test_batch_uses_the_prediction_cache(client: TestClient, predictor: FakePredictor) -> None:
    payload = {"rows": [{"features": {"Age": 50}}] * 5}
    response = client.post("/api/predict/batch", json=payload)
    assert response.headers["X-Cache-Hits"] == "4"
    assert predictor.calls == 1


def test_batch_accepts_the_maximum_of_256_rows(client: TestClient) -> None:
    response = client.post("/api/predict/batch", json={"rows": rows(256)})
    assert response.status_code == 200
    assert response.json()["count"] == 256


def test_batch_rejects_more_than_256_rows(client: TestClient) -> None:
    response = client.post("/api/predict/batch", json={"rows": rows(257)})
    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["type"] == "too_long"
    assert error["loc"] == ["body", "rows"]
    assert error["ctx"] == {"min_length": 1, "max_length": 256, "actual_length": 257}


def test_batch_rejects_empty_rows(client: TestClient) -> None:
    response = client.post("/api/predict/batch", json={"rows": []})
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "too_short"


def test_batch_limit_is_configurable(make_client: Any) -> None:
    client = make_client(batch_max_rows=2)
    assert client.post("/api/predict/batch", json={"rows": rows(2)}).status_code == 200
    response = client.post("/api/predict/batch", json={"rows": rows(3)})
    assert response.status_code == 422
    assert "between 1 and 2 items" in response.json()["message"]


def test_batch_reports_errors_of_every_row_with_its_index(client: TestClient, predictor: FakePredictor) -> None:
    payload = {"rows": [{"features": {"Age": 50}}, {"features": {"Age": 5}}, {"features": {"LAD": 1, "DM": 3}}]}
    response = client.post("/api/predict/batch", json=payload)
    assert response.status_code == 422
    locs = [tuple(item["loc"]) for item in response.json()["detail"]]
    assert locs == [
        ("body", "rows", 1, "features", "Age"),
        ("body", "rows", 2, "features", "LAD"),
        ("body", "rows", 2, "features", "DM"),
    ]
    assert predictor.calls == 0  # nothing is predicted when any row is invalid


def test_batch_rows_reject_unknown_fields(client: TestClient) -> None:
    response = client.post("/api/predict/batch", json={"rows": [{"feature": {"Age": 50}}]})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "rows", 0, "feature"]
