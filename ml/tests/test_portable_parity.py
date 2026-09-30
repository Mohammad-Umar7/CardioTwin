"""The dependency-free portable evaluator must reproduce the native predictor to 1e-9."""

from __future__ import annotations

import math

import numpy as np
import pytest

from cardiotwin_ml import portable
from cardiotwin_ml.portable import PortableModel, fround
from cardiotwin_ml.preprocess import FeatureEncoder

PARITY = 1e-9


@pytest.fixture(scope="module")
def pm(model_json) -> PortableModel:  # noqa: ANN001
    import copy

    return PortableModel(copy.deepcopy(model_json))


def test_fixture_suite_is_rich(fixtures_json) -> None:  # noqa: ANN001
    cases = fixtures_json["cases"]
    assert len(cases) >= 30
    ids = {c["id"] for c in cases}
    assert {"all-defaults", "schema-minima", "schema-maxima", "input-spellings", "exactly-on-split-thresholds"} <= ids
    assert sum(c["id"].startswith("P-") for c in cases) >= 20


def test_portable_matches_native_on_every_fixture(pm, fixtures_json) -> None:  # noqa: ANN001
    worst = {"probability": 0.0, "logit": 0.0, "base_value": 0.0, "shap": 0.0}
    for case in fixtures_json["cases"]:
        out = pm.predict(case["features"])
        exp = case["expected"]
        assert out["imputed"] == exp["imputed"], case["id"]
        assert out["summary"]["highest_risk_vessel"] == exp["summary"]["highest_risk_vessel"]
        assert out["summary"]["expected_diseased_vessels"] == pytest.approx(exp["summary"]["expected_diseased_vessels"], abs=PARITY)
        values, _ = portable.normalise_features(pm.spec, case["features"])
        encoded, _ = portable.encode(pm.spec, values)
        assert encoded == case["encoded"], case["id"]
        for t, pred in exp["predictions"].items():
            got = out["predictions"][t]
            assert got["label"] == pred["label"] and got["risk_band"] == pred["risk_band"], (case["id"], t)
            worst["probability"] = max(worst["probability"], abs(got["probability"] - pred["probability"]))
            worst["logit"] = max(worst["logit"], abs(got["logit"] - pred["logit"]))
            e_got, e_exp = out["explanations"][t], exp["explanations"][t]
            worst["base_value"] = max(worst["base_value"], abs(e_got["base_value"] - e_exp["base_value"]))
            got_rows = {r["feature"]: r for r in e_got["contributions"]}
            assert len(got_rows) == len(e_exp["contributions"])
            for r in e_exp["contributions"]:
                assert got_rows[r["feature"]]["value"] == r["value"]
                worst["shap"] = max(worst["shap"], abs(got_rows[r["feature"]]["shap"] - r["shap"]))
    assert all(v < PARITY for v in worst.values()), worst


def test_native_predictor_matches_fixtures(predictor, fixtures_json) -> None:  # noqa: ANN001
    for case in fixtures_json["cases"][:12]:
        out = predictor.predict(case["features"])
        for t, pred in case["expected"]["predictions"].items():
            assert out["predictions"][t]["probability"] == pytest.approx(pred["probability"], abs=1e-12)


def test_fround_matches_ieee_float32() -> None:
    for x in (0.1, 13.2, 39.5, 1e-40, 123456.789, -7.3, 3.4028235e38):
        assert fround(x) == float(np.float32(x))
    assert math.isinf(fround(1e39))
    assert math.isnan(fround(float("nan")))


def test_portable_encoding_supports_derived_features(registry, values) -> None:  # noqa: ANN001
    """Derived features are not adopted by default, but the portable path must compute them identically."""
    enc = FeatureEncoder([f for f in registry.features if f.key != "Exertional CP"], list(registry.derived))
    spec = {"encoding": enc.to_json()["encoding"], "derived": enc.to_json()["derived"], "columns": enc.columns,
            "constants": {"ratio_min_denominator": 1e-3, "ckd_epi_min_creatinine": 0.1}}
    for rec in values.head(40).to_dict(orient="records"):
        row, _ = portable.encode(spec, rec)
        assert row == enc.encode_row(rec)


def test_portable_rejects_unknown_and_invalid_inputs(pm) -> None:  # noqa: ANN001
    with pytest.raises(ValueError):
        pm.predict({"Cath": "CAD"})
    with pytest.raises(ValueError):
        pm.predict({"DM": "sometimes"})
