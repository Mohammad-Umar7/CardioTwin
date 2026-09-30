"""GET /api/health, the root document and the OpenAPI surface."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import CLINICAL_DISCLAIMER
from app.models import TARGET_ORDER as TARGETS


def test_health_reports_model_and_targets(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    # Contract §3.1 fields
    assert body["status"] == "ok"
    assert body["model_version"] == "0.0.0-fake"
    assert body["targets"] == list(TARGETS)
    assert body["engine"] == "server"
    # Added fields
    assert body["predictor"] == "fake"
    assert body["n_features"] == 23
    assert body["disclaimer"] == CLINICAL_DISCLAIMER
    assert body["frontend_served"] is False
    assert set(body["cache"]) == {"capacity", "size", "hits", "misses"}
    assert body["uptime_s"] >= 0


def test_health_cache_stats_track_predictions(client: TestClient) -> None:
    client.post("/api/predict", json={"features": {"Age": 60}})
    client.post("/api/predict", json={"features": {"Age": 60}})
    cache = client.get("/api/health").json()["cache"]
    assert cache == {"capacity": 2048, "size": 1, "hits": 1, "misses": 1}


def test_root_points_to_docs_when_frontend_is_not_served(client: TestClient) -> None:
    body = client.get("/").json()
    assert body["docs"] == "/docs"
    assert body["health"] == "/api/health"
    assert "not a substitute" in body["disclaimer"]


def test_openapi_documents_every_endpoint(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    expected = {
        "/api/health": "get",
        "/api/schema": "get",
        "/api/cohort": "get",
        "/api/cohort/{patient_id}": "get",
        "/api/cohort/{patient_id}/prediction": "get",
        "/api/metrics": "get",
        "/api/model-card": "get",
        "/api/predict": "post",
        "/api/predict/batch": "post",
    }
    for path, method in expected.items():
        assert method in paths.get(path, {}), f"{method.upper()} {path} missing from OpenAPI"
    predict = paths["/api/predict"]["post"]
    examples = predict["requestBody"]["content"]["application/json"]["examples"]
    assert {"typical_angina", "low_risk", "defaults_only"} <= set(examples)
    assert "422" in predict["responses"]
    assert "not a substitute for formal diagnostic imaging" in spec["info"]["description"]


def test_docs_page_is_served(client: TestClient) -> None:
    response = client.get("/docs")
    assert response.status_code == 200
    assert "swagger" in response.text.lower()
