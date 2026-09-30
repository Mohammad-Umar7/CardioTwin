"""CardioTwinPredictor: §3.2 response contract, validation and SHAP additivity."""

from __future__ import annotations

import numpy as np
import pytest

TARGETS = ["CAD", "LAD", "LCX", "RCA"]
BANDS = [("low", 0.25), ("moderate", 0.5), ("high", 0.75), ("critical", 1.0)]


def _band(p: float) -> str:
    return next(b for b, hi in BANDS if p < hi) if p < 1.0 else "critical"


def test_response_shape(predictor, schema_json) -> None:  # noqa: ANN001
    out = predictor.predict({"Age": 63, "Sex": "Male", "Typical Chest Pain": 1, "DM": 1})
    assert set(out) == {"model_version", "engine", "imputed", "predictions", "explanations", "summary"}
    assert out["engine"] == "server" and out["model_version"] == predictor.version
    assert list(out["predictions"]) == TARGETS and list(out["explanations"]) == TARGETS
    n_features = len(schema_json["features"])
    assert len(out["imputed"]) == n_features - 4 and "Age" not in out["imputed"]
    for t in TARGETS:
        pred = out["predictions"][t]
        assert set(pred) == {"probability", "label", "threshold", "risk_band", "logit"}
        assert 0.0 <= pred["probability"] <= 1.0
        assert pred["label"] == int(pred["probability"] >= pred["threshold"])
        assert pred["risk_band"] == _band(pred["probability"])
        exp = out["explanations"][t]
        assert exp["space"] == "log-odds" and exp["output_value"] == pred["logit"]
        rows = exp["contributions"]
        assert len(rows) == n_features and {r["feature"] for r in rows} == {f["key"] for f in schema_json["features"]}
        mags = [abs(r["shap"]) for r in rows]
        assert mags == sorted(mags, reverse=True)
        assert abs(exp["base_value"] + sum(r["shap"] for r in rows) - exp["output_value"]) < 1e-6
        # The same decomposition on the scale of the displayed probability (Platt slope x SHAP).
        cal_out = exp["calibrated_output_value"]
        assert abs(exp["calibrated_base_value"] + sum(r["shap_calibrated"] for r in rows) - cal_out) < 1e-6
        assert 1.0 / (1.0 + np.exp(-cal_out)) == pytest.approx(pred["probability"], abs=1e-12)
        slope = rows[0]["shap_calibrated"] / rows[0]["shap"]
        assert slope > 0 and all(r["shap_calibrated"] == pytest.approx(slope * r["shap"], rel=1e-12, abs=1e-15) for r in rows)
    vessels = ["LAD", "LCX", "RCA"]
    s = out["summary"]
    assert s["expected_diseased_vessels"] == pytest.approx(sum(out["predictions"][v]["probability"] for v in vessels))
    assert s["highest_risk_vessel"] == max(vessels, key=lambda v: out["predictions"][v]["probability"])


def test_additivity_across_cohort(predictor) -> None:  # noqa: ANN001
    for patient in predictor.cohort["patients"][:40]:
        out = predictor.predict(patient["features"])
        assert out["imputed"] == []
        for t in TARGETS:
            e = out["explanations"][t]
            assert abs(e["base_value"] + sum(r["shap"] for r in e["contributions"]) - e["output_value"]) < 1e-9


def test_input_validation(predictor) -> None:  # noqa: ANN001
    with pytest.raises(ValueError, match="unknown feature"):
        predictor.predict({"LAD": "Stenotic"})
    with pytest.raises(ValueError):
        predictor.predict({"Sex": "Robot"})
    with pytest.raises(ValueError):
        predictor.predict({"Age": "old"})
    with pytest.raises(ValueError):
        predictor.predict({"DM": 3})


def test_equivalent_spellings_give_identical_predictions(predictor) -> None:  # noqa: ANN001
    a = predictor.predict({"DM": 1, "HTN": 0, "Obesity": 1, "Sex": "Female", "BBB": "LBBB"})
    b = predictor.predict({"DM": "Y", "HTN": False, "Obesity": "yes", "Sex": "Fmale", "BBB": "lbbb"})
    for t in TARGETS:
        assert a["predictions"][t] == b["predictions"][t]


def test_empty_request_uses_defaults(predictor, schema_json) -> None:  # noqa: ANN001
    out = predictor.predict({})
    assert out["imputed"] == [f["key"] for f in schema_json["features"]]
    defaults = {f["key"]: f["default"] for f in schema_json["features"]}
    assert predictor.predict(defaults)["predictions"] == out["predictions"]


def test_typical_angina_raises_cad_risk(predictor) -> None:  # noqa: ANN001
    base = {"Age": 60, "Sex": "Male"}
    lo = predictor.predict({**base, "Typical Chest Pain": 0})["predictions"]["CAD"]["probability"]
    hi = predictor.predict({**base, "Typical Chest Pain": 1})["predictions"]["CAD"]["probability"]
    assert hi > lo


def test_predictor_exposes_contract_documents(predictor) -> None:  # noqa: ANN001
    assert predictor.schema["targets"][1]["anatomy"] == ["Coronary_LAD", "Coronary_LAD_Septal"]
    assert set(predictor.metrics["targets"]) == set(TARGETS)
    assert {p["split"] for p in predictor.cohort["patients"]} == {"test", "dev"}
    assert isinstance(predictor.version, str)


def test_batch_and_single_paths_agree(predictor) -> None:  # noqa: ANN001
    pts = predictor.cohort["patients"][:10]
    X = np.array([predictor.encoder.encode_row(predictor.normalise(p["features"])[0]) for p in pts])
    batch = predictor.predict_proba_matrix(X)
    for i, p in enumerate(pts):
        single = predictor.predict(p["features"])["predictions"]
        for t in TARGETS:
            assert single[t]["probability"] == pytest.approx(batch[t][i], abs=1e-12)
