"""Validation analyses (python -m cardiotwin_ml.analysis): statistics, determinism, shapes and published outputs."""

from __future__ import annotations

import dataclasses
import json
import math
from pathlib import Path

import numpy as np
import pytest

from cardiotwin_ml.analysis import ANALYSIS_KEYS
from cardiotwin_ml.analysis.common import AnalysisContext, fingerprint, load_context
from cardiotwin_ml.analysis.modality import columns_by_group, group_order, modality_sets, run_modality_ablation
from cardiotwin_ml.analysis.robustness import fit_recipe, monte_carlo_splits, run_robustness
from cardiotwin_ml.analysis.stats import corrected_t, distribution, holm, percentile_rank
from cardiotwin_ml.analysis.subgroups import OOFPredictions, factors, point_metrics, run_subgroups
from cardiotwin_ml.analysis.summary import build_metrics_summary, merge_analysis, ordinal, serialise, write_metrics
from cardiotwin_ml.paths import ARTIFACTS_DIR, FRONTEND_MODEL_DIR
from cardiotwin_ml.preprocess import LEAKAGE_COLUMNS

SUBGROUP_SETTINGS = {"n_bootstrap": 60, "confidence": 0.95, "small_n": {"min_n": 30, "min_class": 10}, "age_bands": [50, 65]}


@pytest.fixture(scope="module")
def ctx(artifacts_dir: Path) -> AnalysisContext:
    return load_context(artifacts_dir, with_baseline=False)


def _only(ctx: AnalysisContext, *targets: str) -> AnalysisContext:
    return dataclasses.replace(ctx, targets=list(targets))


# --------------------------------------------------------------------------- statistics


def test_percentile_rank_and_distribution() -> None:
    v = np.arange(1, 101, dtype=float)
    assert percentile_rank(v, 50.0) == pytest.approx(49.5)  # 49 below + half of one tie
    assert percentile_rank(v, 0.0) == 0.0 and percentile_rank(v, 1000.0) == 100.0
    d = distribution(v)
    assert d["n"] == 100 and d["mean"] == pytest.approx(50.5) and d["p50"] == pytest.approx(50.5)
    assert d["p05"] < d["p25"] < d["p50"] < d["p75"] < d["p95"] and d["min"] == 1 and d["max"] == 100
    assert distribution([float("nan")]) == {"n": 0}


def test_corrected_t_inflates_the_naive_standard_error() -> None:
    rng = np.random.default_rng(0)
    diffs = rng.normal(0.02, 0.05, size=50)
    ct = corrected_t(diffs, test_train_ratio=0.25)
    sd = diffs.std(ddof=1)
    assert ct["se"] == pytest.approx(math.sqrt((1 / 50 + 0.25) * sd**2), rel=1e-5)
    assert ct["se"] > sd / math.sqrt(50) * 3  # repeated-CV folds are far from independent
    assert ct["ci"][0] < ct["mean"] < ct["ci"][1] and 0 < ct["p_value"] <= 1
    flipped = corrected_t(-diffs, 0.25)
    assert flipped["p_value"] == pytest.approx(ct["p_value"]) and flipped["mean"] == pytest.approx(-ct["mean"])
    with pytest.raises(ValueError):
        corrected_t([0.1], 0.25)


def test_holm_adjustment() -> None:
    assert holm([0.01, 0.04, 0.03, 0.2]) == pytest.approx([0.04, 0.09, 0.09, 0.2])
    assert holm([0.5, 0.9]) == [1.0, 1.0] and holm([0.01, 0.2]) == pytest.approx([0.02, 0.2])


def test_point_metrics_handle_missing_classes() -> None:
    y = np.array([0, 0, 0])
    m = point_metrics(y, np.array([0.1, 0.6, 0.2]), np.array([False, True, False]))
    assert math.isnan(m["roc_auc"]) and math.isnan(m["sensitivity"]) and m["specificity"] == pytest.approx(2 / 3)
    m = point_metrics(np.array([1, 0, 1, 0]), np.array([0.9, 0.2, 0.4, 0.6]), np.array([1, 0, 0, 1], dtype=bool))
    assert m["roc_auc"] == pytest.approx(0.75) and m["sensitivity"] == 0.5 and m["ppv"] == 0.5


# --------------------------------------------------------------------------- robustness


def test_monte_carlo_splits_are_stratified_deterministic_and_new(ctx: AnalysisContext) -> None:
    a = list(monte_carlo_splits(ctx.strata, 6, 0.2, 1000))
    b = list(monte_carlo_splits(ctx.strata, 6, 0.2, 1000))
    locked = set(ctx.test_pos.tolist())
    tests = set()
    for (i, dev, test), (_, dev_b, test_b) in zip(a, b, strict=True):
        assert np.array_equal(dev, dev_b) and np.array_equal(test, test_b)
        assert len(dev) == len(ctx.dev_pos) and len(test) == len(ctx.test_pos)
        assert not set(dev) & set(test) and len(set(dev) | set(test)) == len(ctx.strata)
        assert set(test.tolist()) != locked
        tests.add(tuple(test))
        for t in ctx.targets:
            y = ctx.y(t)
            assert abs(y[test].mean() - y.mean()) < 0.03, (i, t)
    assert len(tests) == 6


def test_recipe_harness_reproduces_the_deployed_model_exactly(ctx: AnalysisContext) -> None:
    """Frozen recipe on the locked split == the published model (weight, Platt, threshold, probabilities)."""
    X_test = ctx.X[ctx.test_pos]
    for t in ctx.targets:
        fit = fit_recipe(ctx, t, ctx.dev_pos, "frozen")
        deployed = ctx.deployed[t]
        assert (fit.model.weight, fit.model.platt_a, fit.model.platt_b) == (deployed.weight, deployed.platt_a, deployed.platt_b)
        assert fit.model.threshold == deployed.threshold and fit.model.threshold_f1 == deployed.threshold_f1
        assert np.array_equal(fit.model.predict_proba(X_test), deployed.predict_proba(X_test)), t


def test_robustness_is_independent_of_worker_count(ctx: AnalysisContext) -> None:
    small = _only(ctx, "LCX")
    a = run_robustness(small, 2, 0.2, 1000, "frozen", n_jobs=1)
    b = run_robustness(small, 2, 0.2, 1000, "frozen", n_jobs=2)
    assert a.reproduction_max_abs_diff == 0.0 and b.reproduction_max_abs_diff == 0.0
    for k, v in a.values["LCX"].items():
        assert np.array_equal(v, b.values["LCX"][k]), k
    assert a.locked == b.locked
    assert a.locked["LCX"]["roc_auc"] == pytest.approx(ctx.metrics["targets"]["LCX"]["test"]["roc_auc"]["value"], abs=1e-6)


# --------------------------------------------------------------------------- modality ablation


def test_modality_sets_partition_the_encoded_columns(ctx: AnalysisContext) -> None:
    cols = columns_by_group(ctx)
    order = [g["id"] for g in group_order(ctx)]
    assert order == ["demographics", "risk_factors", "symptoms", "exam", "ecg", "labs", "echo"]
    everything = sorted(i for g in order for i in cols[g])
    assert everything == list(range(len(ctx.columns)))  # every column belongs to exactly one modality
    assert not {ctx.columns[i].split("=")[0] for i in everything} & LEAKAGE_COLUMNS
    sets = modality_sets(order, cols)
    cum = [s for s in sets if s.family == "cumulative"]
    assert [s.group for s in cum] == order and list(cum[-1].columns) == everything
    for prev, nxt in zip(cum, cum[1:], strict=False):
        assert set(prev.columns) < set(nxt.columns)
    for s in (s for s in sets if s.family == "leave_one_out"):
        assert set(s.columns) == set(everything) - set(cols[s.group])
    singles = [s for s in sets if s.family == "single"]
    assert sorted(i for s in singles for i in s.columns) == everything


def test_modality_ablation_shape_and_determinism(ctx: AnalysisContext) -> None:
    small = _only(ctx, "LAD")
    a, proto = run_modality_ablation(small, n_repeats=1, n_jobs=1)
    b, _ = run_modality_ablation(small, n_repeats=1, n_jobs=2)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    m = a["LAD"]
    assert len(m["cumulative"]) == len(m["leave_one_out"]) == len(m["single"]) == 7
    assert m["cumulative"][0]["delta_vs_previous"] is None
    assert all({"mean", "ci", "p_value", "p_holm"} <= set(r["delta_vs_previous"]) for r in m["cumulative"][1:])
    assert m["cumulative"][-1]["roc_auc"]["mean"] == m["full"]["roc_auc"]["mean"]
    # removing echo from the full panel is the cumulative set up to the laboratory
    loo_echo = next(r for r in m["leave_one_out"] if r["group"] == "echo")
    assert loo_echo["roc_auc"]["mean"] == m["cumulative"][-2]["roc_auc"]["mean"]
    for r in m["cumulative"]:
        lo, hi = r["roc_auc"]["ci"]
        assert lo <= r["roc_auc"]["mean"] <= hi
    i = m["instrumental"]
    assert i["added_groups"] == ["ecg", "labs", "echo"]
    assert i["delta"]["mean"] == pytest.approx(i["full_roc_auc"]["mean"] - i["bedside_roc_auc"]["mean"], abs=1e-5)
    assert proto["n_folds"] == 5 and len(proto["groups"]) == 7


# --------------------------------------------------------------------------- subgroups


def test_subgroup_factors_partition_patients(ctx: AnalysisContext) -> None:
    facs = factors(ctx.values, (50, 65))
    assert [f.id for f in facs] == ["sex", "age_band", "diabetes"]
    for f in facs:
        stacked = np.vstack([lv.mask for lv in f.levels]).astype(int)
        assert np.array_equal(stacked.sum(axis=0), np.ones(len(ctx.values), dtype=int)), f.id
    import pandas as pd

    probe = pd.DataFrame({"Age": [49, 50, 65, 66], "Sex": ["Male"] * 4, "DM": [0, 1, 0, 1]})
    age = next(f for f in factors(probe) if f.id == "age_band")
    assert [lv.id for lv in age.levels] == ["lt50", "50to65", "gt65"]
    assert [int(np.flatnonzero(np.vstack([lv.mask for lv in age.levels])[:, k])[0]) for k in range(4)] == [0, 1, 1, 2]


def _apparent_oof(ctx: AnalysisContext) -> OOFPredictions:
    proba, thr = {}, {}
    for t in ctx.targets:
        p = ctx.deployed[t].predict_proba(ctx.X[ctx.dev_pos])
        proba[t] = np.vstack([p, p[::-1]])
        thr[t] = np.full_like(proba[t], ctx.deployed[t].threshold)
    return OOFPredictions(proba, thr, {t: {"roc_auc": 0.0, "f1": 0.0} for t in ctx.targets})


def test_subgroup_blocks_shape_small_n_and_determinism(ctx: AnalysisContext) -> None:
    small = _only(ctx, "LCX")
    oof = _apparent_oof(small)
    a, proto = run_subgroups(small, oof, SUBGROUP_SETTINGS)
    b, _ = run_subgroups(small, oof, SUBGROUP_SETTINGS)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    s = a["LCX"]
    assert s["overall"]["test"]["n"] == len(ctx.test_pos) and s["overall"]["oof"]["n"] == len(ctx.dev_pos)
    assert s["overall"]["test"]["roc_auc"]["value"] == pytest.approx(ctx.metrics["targets"]["LCX"]["test"]["roc_auc"]["value"], abs=1e-6)
    assert list(s["factors"]) == ["sex", "age_band", "diabetes"]
    for fac in s["factors"].values():
        assert sum(lv["oof"]["n"] for lv in fac["levels"]) == len(ctx.dev_pos)
        assert sum(lv["test"]["n"] for lv in fac["levels"]) == len(ctx.test_pos)
        ref = next(lv for lv in fac["levels"] if lv["id"] == fac["reference"])
        assert ref["oof"]["n"] == max(lv["oof"]["n"] for lv in fac["levels"])
        assert "delta_roc_auc_vs_reference" not in ref["oof"]
        for lv in fac["levels"]:
            for block in (lv["oof"], lv["test"]):
                n_pos, n = block["n_pos"], block["n"]
                assert block["small_n"] == (n < 30 or min(n_pos, n - n_pos) < 10)
                if min(n_pos, n - n_pos) < 3:
                    assert block["roc_auc"] is None
                elif block["roc_auc"] is not None:
                    lo, hi = block["roc_auc"]["ci"]
                    assert 0 <= lo <= hi <= 1
    assert "small_n" in proto and "cv_reproduced" in proto


# --------------------------------------------------------------------------- publishing


def test_merge_is_additive_and_refuses_to_change_existing_keys(tmp_path: Path) -> None:
    original = {"version": "1.0.0", "generated_at": "x", "targets": {"CAD": {"test": {"roc_auc": {"value": 0.85, "ci": [0.7, 0.9]}}}}}
    text = serialise(original)
    fp = {"model_json_sha256": "abc"}
    merged = merge_analysis(original, {"robustness": {"CAD": {"n_splits": 3}}}, {"robustness": {"method": "m"}}, fp)
    assert list(merged)[: len(original)] == list(original) and merged["robustness"] == {"CAD": {"n_splits": 3}}
    assert merged["analysis"]["fingerprint"] == fp and merged["analysis"]["robustness"]["method"] == "m"
    path = tmp_path / "metrics.json"
    write_metrics(path, merged, text)
    written = path.read_text(encoding="utf-8")
    assert written.startswith(text[:-3] + ",\n")  # original keys serialised byte-identically, analyses appended
    again = merge_analysis(json.loads(written), {}, {}, fp)
    assert again["robustness"] == merged["robustness"]  # same inputs -> kept
    assert "robustness" not in merge_analysis(json.loads(written), {}, {}, {"model_json_sha256": "other"})
    tampered = dict(merged, version="2.0.0")
    with pytest.raises(RuntimeError):
        write_metrics(path, tampered, text)


def test_ordinal_suffixes() -> None:
    values = (1, 1.5, 3.0, 11, 12, 13, 21, 22, 84, 100, 111)
    assert [ordinal(v) for v in values] == ["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "22nd", "84th", "100th", "111th"]


def test_carry_over_requires_an_unchanged_fingerprint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import cardiotwin_ml.analysis.summary as summary

    prev = tmp_path / "metrics.json"
    prev.write_text(json.dumps({"robustness": {"CAD": {}}, "analysis": {"fingerprint": {"a": "1"}}}), encoding="utf-8")
    monkeypatch.setattr(summary, "fingerprint", lambda _d: {"a": "1"})
    assert summary.carry_over(prev, {"version": "1"}, tmp_path)["robustness"] == {"CAD": {}}
    monkeypatch.setattr(summary, "fingerprint", lambda _d: {"a": "2"})
    assert "robustness" not in summary.carry_over(prev, {"version": "1"}, tmp_path)
    assert summary.carry_over(tmp_path / "missing.json", {"version": "1"}, tmp_path) == {"version": "1"}


# --------------------------------------------------------------------------- published artifacts


def _published(metrics_json: dict) -> dict:
    if not all(k in metrics_json for k in ANALYSIS_KEYS):
        pytest.skip("analyses not published yet - run `python -m cardiotwin_ml.analysis`")
    return metrics_json


def test_published_analyses_are_current(metrics_json: dict) -> None:
    m = _published(metrics_json)
    assert m["analysis"]["fingerprint"] == fingerprint(ARTIFACTS_DIR)
    for key in ("robustness", "modality_ablation", "subgroups"):
        assert not m["analysis"][key]["fast_mode"], key
        assert list(m[key]) == list(m["targets"]), key


def test_published_robustness_contract(metrics_json: dict) -> None:
    m = _published(metrics_json)
    assert m["analysis"]["robustness"]["reproduction"]["max_abs_probability_difference"] <= 1e-12
    for t, r in m["robustness"].items():
        assert r["n_splits"] >= 200 and 0 <= r["fixed_split_percentile"] <= 100
        for k in ("roc_auc", "f1", "brier"):
            assert {"mean", "sd", "p05", "p50", "p95", "fixed_split", "fixed_split_percentile"} <= set(r[k]), (t, k)
            assert r[k]["p05"] <= r[k]["p50"] <= r[k]["p95"]
            assert r[k]["fixed_split"] == pytest.approx(m["targets"][t]["test"][k]["value"], abs=1e-6), (t, k)
            assert len(r["samples"][k]) == r["n_splits"]
        assert r["fixed_split_percentile"] == r["roc_auc"]["fixed_split_percentile"]
        assert 0 <= r["delta_roc_auc_vs_baseline"]["share_positive"] <= 1


def test_published_modality_and_subgroups_contract(metrics_json: dict) -> None:
    m = _published(metrics_json)
    groups = [g["id"] for g in m["analysis"]["modality_ablation"]["groups"]]
    for t in m["targets"]:
        mod = m["modality_ablation"][t]
        assert [r["group"] for r in mod["cumulative"]] == groups
        assert mod["full"]["roc_auc"]["mean"] == mod["cumulative"][-1]["roc_auc"]["mean"]
        assert mod["full"]["roc_auc"]["n_folds"] == m["protocol"]["cv_splits"] * m["protocol"]["cv_repeats"]
        sub = m["subgroups"][t]
        assert sub["overall"]["test"]["roc_auc"]["value"] == pytest.approx(m["targets"][t]["test"]["roc_auc"]["value"], abs=1e-6)
        for fac in sub["factors"].values():
            assert sum(lv["test"]["n"] for lv in fac["levels"]) == m["dataset"]["n_test"]
    for t, v in m["analysis"]["subgroups"]["cv_reproduced"].items():
        assert v["roc_auc"] == pytest.approx(v["published_roc_auc"], abs=1e-6), t


def test_metrics_summary_is_small_consistent_and_mirrored(metrics_json: dict, schema_json: dict) -> None:
    path = ARTIFACTS_DIR / "metrics_summary.json"
    if not path.exists():
        pytest.skip("metrics_summary.json not built yet")
    raw = path.read_bytes()
    assert len(raw) < 40_000
    summary = json.loads(raw)
    assert summary == json.loads(json.dumps(build_metrics_summary(metrics_json, schema_json)))
    assert summary["format"] == "cardiotwin-metrics-summary" and summary["model_version"] == metrics_json["model_version"]
    for t, s in summary["targets"].items():
        assert s["test"]["roc_auc"] == metrics_json["targets"][t]["test"]["roc_auc"]
        assert s["cv"]["roc_auc"] == metrics_json["targets"][t]["cv"]["roc_auc"]
        if "robustness" in metrics_json:
            assert s["robustness"]["roc_auc"]["p50"] == metrics_json["robustness"][t]["roc_auc"]["p50"]
    mirrored = FRONTEND_MODEL_DIR / "metrics_summary.json"
    if mirrored.exists():
        assert mirrored.read_bytes() == raw
