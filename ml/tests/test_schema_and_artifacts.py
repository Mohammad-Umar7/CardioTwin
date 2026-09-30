"""schema.json / metrics.json / cohort.json completeness against docs/CONTRACTS.md."""

from __future__ import annotations

import json

from cardiotwin_ml.paths import ARTIFACTS_DIR, FRONTEND_MODEL_DIR

EXPECTED_ANATOMY = {
    "CAD": ["heart"],
    "LAD": ["Coronary_LAD", "Coronary_LAD_Septal"],
    "LCX": ["Coronary_LCX"],
    "RCA": ["Coronary_RCA", "Coronary_RCA_Marginal", "Coronary_RCA_PDA", "Coronary_RCA_PL", "Coronary_RCA_Septal"],
}
GROUPS = {"demographics", "risk_factors", "symptoms", "exam", "ecg", "labs", "echo"}


def test_feature_registry_is_complete(registry, raw) -> None:  # noqa: ANN001
    inputs = set(raw.columns) - {"LAD", "LCX", "RCA", "Cath"}
    assert set(registry.keys) == inputs  # every dataset input is documented
    for f in registry.features:
        assert f.group in GROUPS and len(f.description) > 20 and f.label
        if f.type == "numeric":
            assert f.unit, f.key


def test_schema_features(schema_json, registry) -> None:  # noqa: ANN001
    assert schema_json["version"] and {g["id"] for g in schema_json["groups"]} == GROUPS
    by_key = registry.by_key()
    for f in schema_json["features"]:
        assert set(f) >= {"key", "label", "group", "type", "unit", "min", "max", "step", "default", "normal", "description", "options"}
        assert f["key"] in by_key and f["type"] in {"numeric", "binary", "categorical"}
        if f["type"] == "numeric":
            assert f["min"] <= f["default"] <= f["max"]
        if f["type"] == "binary":
            assert f["default"] in (0, 1)
        if f["type"] == "categorical":
            assert f["default"] in [o["value"] for o in f["options"]]
    assert "Exertional CP" in schema_json["dropped_features"]


def test_schema_targets_follow_the_contract(schema_json) -> None:  # noqa: ANN001
    assert [t["id"] for t in schema_json["targets"]] == ["CAD", "LAD", "LCX", "RCA"]
    for t in schema_json["targets"]:
        assert t["anatomy"] == EXPECTED_ANATOMY[t["id"]]
        assert t["territory"] and 0 < t["threshold"] < 1
    assert [(b["id"], b["max"]) for b in schema_json["risk_bands"]] == [
        ("low", 0.25), ("moderate", 0.5), ("high", 0.75), ("critical", 1.0)
    ]


def test_metrics_contract(metrics_json) -> None:  # noqa: ANN001
    m = metrics_json
    assert m["dataset"]["n"] == 303 and m["dataset"]["n_dev"] == 242 and m["dataset"]["n_test"] == 61
    assert {"holdout", "cv", "tuning", "calibration", "threshold", "seed"} <= set(m["protocol"])
    for t, r in m["targets"].items():
        for k in ("roc_auc", "accuracy", "precision", "recall", "specificity", "f1", "pr_auc", "brier", "mcc", "log_loss", "balanced_accuracy"):
            v = r["test"][k]
            assert v["ci"][0] <= v["value"] <= v["ci"][1], (t, k)
        for k in ("roc_auc", "f1", "accuracy", "precision", "recall"):
            assert set(r["cv"][k]) == {"mean", "std"}
        assert set(r["confusion_matrix"]) == {"tn", "fp", "fn", "tp"}
        assert sum(r["confusion_matrix"].values()) == 61
        assert {"roc", "pr", "calibration", "dca"} <= set(r["curves"])
        assert r["leaderboard"] and {"model", "roc_auc_mean", "roc_auc_std", "f1_mean"} <= set(r["leaderboard"][0])
        assert r["global_importance"][0]["mean_abs_shap"] >= r["global_importance"][-1]["mean_abs_shap"]
        assert len(r["beeswarm"]) == 15 and all(0 <= p["v"] <= 1 for p in r["beeswarm"][0]["points"])
        checks = m["explainability_checks"][t]
        assert checks["xgboost_pred_contribs_max_abs_diff"] < 1e-5
        assert checks["ensemble_additivity_max_error"] < 1e-9


def test_cohort_contract(artifacts_dir) -> None:  # noqa: ANN001
    cohort = json.loads((artifacts_dir / "cohort.json").read_text(encoding="utf-8"))
    pts = cohort["patients"]
    assert sum(p["split"] == "test" for p in pts) == 61 and 15 <= sum(p["split"] == "dev" for p in pts) <= 25
    assert len({p["id"] for p in pts}) == len(pts)
    for p in pts:
        assert p["id"].startswith("P-") and " · " in p["summary"]
        assert set(p["labels"]) == {"CAD", "LAD", "LCX", "RCA"}
        assert not {"LAD", "LCX", "RCA", "Cath"} & set(p["features"])


def test_frontend_mirror_is_in_sync() -> None:
    for name in ("schema.json", "model.json", "metrics.json", "cohort.json", "fixtures.json"):
        mirrored = FRONTEND_MODEL_DIR / name
        if mirrored.exists():
            assert mirrored.read_bytes() == (ARTIFACTS_DIR / name).read_bytes(), name
