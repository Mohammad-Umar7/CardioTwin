"""Cohort, schema, metrics and model-card endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings
from app.models import TARGET_ORDER as TARGETS
from app.predictors.fake import FakePredictor

# -- cohort ---------------------------------------------------------------------------------


def test_cohort_lists_patients_in_contract_shape(client: TestClient, predictor: FakePredictor) -> None:
    body = client.get("/api/cohort").json()
    assert body == predictor.cohort
    for patient in body["patients"]:
        assert set(patient) >= {"id", "split", "summary", "features", "labels"}
        assert patient["split"] in {"test", "dev"}
        assert set(patient["labels"]) == set(TARGETS)


def test_single_cohort_patient(client: TestClient) -> None:
    body = client.get("/api/cohort/P-003").json()
    assert body["id"] == "P-003"
    assert body["features"]["Current Smoker"] == 1
    assert client.get("/api/cohort/p-003").json()["id"] == "P-003"  # ids are case-insensitive


def test_cohort_prediction_matches_post_predict(client: TestClient, predictor: FakePredictor) -> None:
    response = client.get("/api/cohort/P-001/prediction")
    assert response.status_code == 200
    body = response.json()
    assert body["patient"]["id"] == "P-001"
    direct = client.post("/api/predict", json={"features": body["patient"]["features"]})
    assert direct.headers["X-Cache"] == "HIT"  # same normalised features -> same cache entry
    assert body["prediction"] == direct.json()
    assert set(body["agreement"]) == set(TARGETS)
    for target in TARGETS:
        predicted = body["prediction"]["predictions"][target]["label"]
        assert body["agreement"][target] is (predicted == body["patient"]["labels"][target])


def test_unknown_cohort_patient_is_a_helpful_404(client: TestClient) -> None:
    for path in ("/api/cohort/P-999", "/api/cohort/P-999/prediction"):
        response = client.get(path)
        assert response.status_code == 404
        body = response.json()
        assert body["error"] == "not_found"
        assert "P-999" in body["message"]
        assert "P-001" in body["message"]


def test_cohort_patient_with_out_of_schema_values_is_still_predicted(make_client: Any) -> None:
    class DriftingCohort(FakePredictor):
        @property
        def cohort(self) -> dict[str, Any]:
            data = super().cohort
            data["patients"][0]["features"]["Age"] = 99  # outside the schema max of 86
            return data

    client = make_client(predictor_override=DriftingCohort())
    response = client.get("/api/cohort/P-001/prediction")
    assert response.status_code == 200
    ages = {c["feature"]: c["value"] for c in response.json()["prediction"]["explanations"]["CAD"]["contributions"]}
    assert ages["Age"] == 99


# -- static documents -------------------------------------------------------------------------


def test_schema_is_served_verbatim_with_etag(client: TestClient, predictor: FakePredictor) -> None:
    response = client.get("/api/schema")
    assert response.status_code == 200
    assert response.json() == predictor.schema
    etag = response.headers["ETag"]
    assert response.headers["Cache-Control"] == "no-cache"
    revalidated = client.get("/api/schema", headers={"If-None-Match": etag})
    assert revalidated.status_code == 304
    assert revalidated.content == b""
    assert client.get("/api/schema", headers={"If-None-Match": f'W/{etag}, "other"'}).status_code == 304
    assert client.get("/api/schema", headers={"If-None-Match": '"stale"'}).status_code == 200


def test_schema_contract_fields(client: TestClient) -> None:
    body = client.get("/api/schema").json()
    assert set(body) >= {"version", "groups", "features", "targets", "risk_bands"}
    assert [t["id"] for t in body["targets"]] == list(TARGETS)
    assert [b["id"] for b in body["risk_bands"]] == ["low", "moderate", "high", "critical"]
    keys = {f["key"] for f in body["features"]}
    assert not keys & {"LAD", "LCX", "RCA", "Cath"}


def test_metrics_and_cohort_support_etags(client: TestClient) -> None:
    for path in ("/api/metrics", "/api/cohort"):
        etag = client.get(path).headers["ETag"]
        assert client.get(path, headers={"If-None-Match": etag}).status_code == 304


def test_metrics_report_shape(client: TestClient) -> None:
    body = client.get("/api/metrics").json()
    assert set(body) >= {"version", "generated_at", "dataset", "protocol", "targets"}
    assert set(body["targets"]) == set(TARGETS)
    for block in body["targets"].values():
        assert set(block) >= {"selected_model", "cv", "test", "threshold", "confusion_matrix", "curves",
                              "global_importance"}


# -- model card -------------------------------------------------------------------------------


def test_model_card_is_generated_when_no_file_exists(client: TestClient) -> None:
    response = client.get("/api/model-card")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert response.headers["X-Model-Card-Source"] == "generated"
    text = response.text
    assert text.startswith("# CardioTwin model card")
    assert "not a substitute for formal diagnostic imaging" in text
    for target in TARGETS:
        assert f"| {target} | FakePredictor" in text
    assert "| 0.500 (0.50–0.50) |" in text


def test_model_card_file_is_served_verbatim(client: TestClient, settings: Settings) -> None:
    Path(settings.model_card_path).write_text("# Custom card\n\nÄ utf-8 body\n", encoding="utf-8")
    response = client.get("/api/model-card")
    assert response.headers["X-Model-Card-Source"] == "file"
    assert response.text == "# Custom card\n\nÄ utf-8 body\n"


def test_model_card_falls_back_to_artifacts_directory(client: TestClient, settings: Settings) -> None:
    settings.artifacts_dir.mkdir(parents=True)
    (settings.artifacts_dir / "MODEL_CARD.md").write_text("# Artifact card\n", encoding="utf-8")
    response = client.get("/api/model-card")
    assert response.headers["X-Model-Card-Source"] == "file"
    assert response.text == "# Artifact card\n"
