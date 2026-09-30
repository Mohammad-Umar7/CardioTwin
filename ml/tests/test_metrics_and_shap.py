"""Metric implementations and TreeSHAP correctness on synthetic XGBoost models."""

from __future__ import annotations

import numpy as np
import pytest
import xgboost as xgb

from cardiotwin_ml import xgb_trees
from cardiotwin_ml.ensemble import fit_platt, sigmoid
from cardiotwin_ml.metrics import (
    binary_metrics,
    bootstrap_metrics,
    decision_curve,
    sklearn_reference_metrics,
    youden_threshold,
)


@pytest.fixture(scope="module")
def scores() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 150)
    p = np.clip(0.35 * y + rng.uniform(0, 0.65, 150), 0.001, 0.999)
    p[:20] = np.round(p[:20], 1)  # ties
    return y, p


def test_fast_metrics_match_sklearn(scores) -> None:  # noqa: ANN001
    y, p = scores
    ours = binary_metrics(y, p, 0.5)
    ref = sklearn_reference_metrics(y, p)
    for k, v in ref.items():
        assert ours[k] == pytest.approx(v, abs=1e-12), k


def test_bootstrap_ci_brackets_point_estimate(scores) -> None:  # noqa: ANN001
    y, p = scores
    res = bootstrap_metrics(y, p, 0.5, n_resamples=300, seed=1)
    for k, m in res.items():
        lo, hi = m["ci"]
        assert lo <= m["value"] + 1e-9 and m["value"] <= hi + 1e-9, k
    assert res == bootstrap_metrics(y, p, 0.5, n_resamples=300, seed=1)  # deterministic


def test_youden_threshold_separates_perfect_scores() -> None:
    y = np.array([0, 0, 0, 1, 1, 1])
    p = np.array([0.1, 0.2, 0.3, 0.7, 0.8, 0.9])
    t = youden_threshold(y, p)
    assert 0.3 < t <= 0.7
    assert binary_metrics(y, p, t)["accuracy"] == 1.0


def test_decision_curve_treat_all_formula() -> None:
    y = np.array([1, 1, 0, 0])
    d = decision_curve(y, np.array([0.9, 0.8, 0.2, 0.1]), 0.3, 0.5, 0.2)
    assert d["thresholds"] == [0.3, 0.5]
    assert d["treat_all"][0] == pytest.approx(0.5 - 0.5 * 0.3 / 0.7)
    assert d["model"][0] == pytest.approx(0.5)  # both positives treated, no false positives


def test_platt_recovers_known_parameters() -> None:
    rng = np.random.default_rng(0)
    m = rng.normal(size=20000)
    y = (rng.uniform(size=m.size) < sigmoid(0.7 * m - 0.3)).astype(float)
    a, b = fit_platt(m, y)
    assert a == pytest.approx(0.7, abs=0.05) and b == pytest.approx(-0.3, abs=0.05)


@pytest.fixture(scope="module")
def booster_and_data() -> tuple[xgb.Booster, np.ndarray]:
    rng = np.random.default_rng(1)
    X = np.round(rng.normal(size=(300, 8)) * 10) / 10
    y = (X[:, 0] + X[:, 1] * X[:, 2] + rng.normal(size=300) > 0).astype(int)
    X[::17, 3] = np.nan  # exercise the "missing" branch
    model = xgb.XGBClassifier(n_estimators=60, max_depth=4, learning_rate=0.1, subsample=0.8, n_jobs=1, random_state=0)
    model.fit(X, y)
    return model.get_booster(), X


def test_leaf_sum_margin_matches_xgboost(booster_and_data) -> None:  # noqa: ANN001
    booster, X = booster_and_data
    trees, _ = xgb_trees.parse_dump(booster, [f"c{i}" for i in range(X.shape[1])])
    base = xgb_trees.logit(xgb_trees.base_score(booster))
    ours = xgb_trees.margin_from_leaves(trees, xgb_trees.leaf_indices(booster, X), base)
    native = booster.predict(xgb.DMatrix(X), output_margin=True)
    assert np.max(np.abs(ours - native)) < 1e-5  # XGBoost accumulates in float32


def test_tree_shap_matches_xgboost_and_is_additive(booster_and_data) -> None:  # noqa: ANN001
    booster, X = booster_and_data
    trees, _ = xgb_trees.parse_dump(booster, [f"c{i}" for i in range(X.shape[1])])
    base = xgb_trees.logit(xgb_trees.base_score(booster))
    phi = xgb_trees.tree_shap(trees, X, X.shape[1])
    contribs = booster.predict(xgb.DMatrix(X), pred_contribs=True)
    assert np.max(np.abs(phi - contribs[:, :-1])) < 1e-5
    ev = xgb_trees.expected_value(trees, base)
    assert abs(ev - contribs[0, -1]) < 1e-5
    margin = xgb_trees.margin_from_leaves(trees, xgb_trees.leaf_indices(booster, X), base)
    assert np.max(np.abs(ev + phi.sum(axis=1) - margin)) < 1e-9
    scalar = xgb_trees.ScalarTreeShap(trees)
    for i in range(0, len(X), 29):
        assert np.max(np.abs(np.asarray(scalar.shap(X[i], X.shape[1])) - phi[i])) < 1e-12


def test_tree_shap_agrees_with_shap_library(booster_and_data) -> None:  # noqa: ANN001
    shap = pytest.importorskip("shap")
    booster, X = booster_and_data
    trees, _ = xgb_trees.parse_dump(booster, [f"c{i}" for i in range(X.shape[1])])
    sv = shap.TreeExplainer(booster, feature_perturbation="tree_path_dependent").shap_values(X)
    assert np.max(np.abs(xgb_trees.tree_shap(trees, X, X.shape[1]) - sv)) < 1e-5
