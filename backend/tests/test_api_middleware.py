"""Request ids, timing headers, gzip, CORS and error handling across the middleware stack."""

from __future__ import annotations

import re
from typing import Any

from fastapi.testclient import TestClient

from app.predictors.fake import FakePredictor

# -- request id & timing ----------------------------------------------------------------------


def test_request_id_is_generated_when_absent(client: TestClient) -> None:
    response = client.get("/api/health")
    assert re.fullmatch(r"[0-9a-f]{32}", response.headers["X-Request-ID"])


def test_valid_incoming_request_id_is_propagated(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "spa-7f3a.01"})
    assert response.headers["X-Request-ID"] == "spa-7f3a.01"


def test_malformed_incoming_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "bad id with spaces" + "x" * 200})
    assert re.fullmatch(r"[0-9a-f]{32}", response.headers["X-Request-ID"])


def test_timing_headers_are_present(client: TestClient) -> None:
    response = client.post("/api/predict", json={"features": {}})
    assert float(response.headers["X-Response-Time-ms"]) >= 0
    assert response.headers["Server-Timing"].startswith("app;dur=")


# -- compression ------------------------------------------------------------------------------


def test_large_responses_are_gzipped(client: TestClient) -> None:
    response = client.get("/api/schema", headers={"Accept-Encoding": "gzip"})
    assert response.headers["Content-Encoding"] == "gzip"
    assert response.json()["features"]  # httpx transparently decompresses


def test_small_responses_are_not_gzipped(client: TestClient) -> None:
    response = client.get("/api/cohort/P-404", headers={"Accept-Encoding": "gzip"})
    assert "Content-Encoding" not in response.headers


# -- CORS -------------------------------------------------------------------------------------


def test_cors_preflight_from_the_dev_frontend_is_allowed(client: TestClient) -> None:
    response = client.options(
        "/api/predict",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-request-id",
        },
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "POST" in response.headers["Access-Control-Allow-Methods"]


def test_cors_exposes_diagnostic_headers(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "http://127.0.0.1:5173"})
    assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:5173"
    exposed = response.headers["Access-Control-Expose-Headers"]
    for header in ("X-Request-ID", "X-Response-Time-ms", "X-Cache", "ETag"):
        assert header in exposed


def test_cors_rejects_unknown_origins(client: TestClient) -> None:
    response = client.options(
        "/api/predict",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 400
    assert "Access-Control-Allow-Origin" not in response.headers
    simple = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in simple.headers


def test_cors_wildcard_configuration(make_client: Any) -> None:
    client = make_client(cors_origins=("*",))
    response = client.get("/api/health", headers={"Origin": "https://judge.example"})
    assert response.headers["Access-Control-Allow-Origin"] == "*"
    assert "Access-Control-Allow-Credentials" not in response.headers


# -- failures ---------------------------------------------------------------------------------


def test_unhandled_errors_become_json_500_with_request_id(make_client: Any) -> None:
    class Exploding(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            raise RuntimeError("boom")

    client = make_client(predictor_override=Exploding())
    response = client.post("/api/predict", json={"features": {}}, headers={"X-Request-ID": "trace-1"})
    assert response.status_code == 500
    body = response.json()
    assert body["error"] == "internal_error"
    assert body["request_id"] == "trace-1"
    assert "boom" not in body["message"]  # internals are logged, not leaked


def test_contract_violations_are_reported_as_model_contract_errors(make_client: Any) -> None:
    class Broken(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            result = super().predict(features)
            result["predictions"]["LCX"]["probability"] = 1.7
            return result

    client = make_client(predictor_override=Broken())
    response = client.post("/api/predict", json={"features": {}})
    assert response.status_code == 500
    assert response.json()["error"] == "model_contract_error"


def test_missing_target_in_model_output_is_a_contract_error(make_client: Any) -> None:
    class MissingRCA(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            result = super().predict(features)
            del result["predictions"]["RCA"]
            return result

    response = make_client(predictor_override=MissingRCA()).post("/api/predict", json={})
    assert response.status_code == 500
    assert response.json()["error"] == "model_contract_error"


def test_numpy_scalars_from_the_model_are_serialised(make_client: Any) -> None:
    import numpy as np

    class NumpyPredictor(FakePredictor):
        def predict(self, features: Any) -> dict[str, Any]:
            result = super().predict(features)
            cad = result["predictions"]["CAD"]
            cad["probability"] = np.float32(cad["probability"])
            cad["label"] = np.int64(cad["label"])
            result["explanations"]["CAD"]["contributions"][0]["value"] = np.int64(1)
            result["imputed"] = np.array(result["imputed"])
            return result

    response = make_client(predictor_override=NumpyPredictor()).post("/api/predict", json={})
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["predictions"]["CAD"]["label"], int)
    assert isinstance(body["imputed"], list)


def test_unknown_api_paths_are_json_404(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"] == "not_found"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]


def test_wrong_method_is_json_405(client: TestClient) -> None:
    response = client.get("/api/predict")
    assert response.status_code == 405
    assert response.json()["error"] == "method_not_allowed"
