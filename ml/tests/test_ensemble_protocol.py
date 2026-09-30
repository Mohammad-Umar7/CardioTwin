"""Ensemble fitting protocol: cross-fitted CV estimate and calibration consistency."""

from __future__ import annotations

import numpy as np
import pytest

from cardiotwin_ml.ensemble import (
    choose_weight,
    cross_fit_ensemble,
    cross_fitted_threshold_metrics,
    fit_platt,
    sigmoid,
)
from cardiotwin_ml.evaluate import make_folds


@pytest.fixture(scope="module")
def oof() -> tuple[np.ndarray, dict[str, np.ndarray], np.ndarray, list]:
    rng = np.random.default_rng(7)
    n, repeats = 120, 3
    y = rng.integers(0, 2, n)
    signal = (2 * y - 1).astype(float)
    folds = make_folds(y, 5, repeats, seed=11)
    lr = {
        "good": 0.8 * signal + rng.normal(size=(repeats, n)),
        "weak": 0.2 * signal + rng.normal(size=(repeats, n)),
    }
    xgb = 0.6 * signal + rng.normal(size=(repeats, n))
    return y, lr, xgb, folds


def test_cross_fit_scores_every_patient_once_per_repeat(oof) -> None:  # noqa: ANN001
    y, lr, xgb, folds = oof
    xf = cross_fit_ensemble(lr, xgb, y, folds, 0.25)
    assert xf.proba.shape == xgb.shape and np.all((xf.proba > 0) & (xf.proba < 1))
    assert len(xf.thresholds) == len(folds) == len(xf.choices)
    assert {c["logistic"] for c in xf.choices} <= set(lr)


def test_cross_fit_never_uses_the_labels_of_the_scored_fold(oof) -> None:  # noqa: ANN001
    """Flipping every label inside one outer fold must not change that fold's probabilities or threshold."""
    y, lr, xgb, folds = oof
    ref = cross_fit_ensemble(lr, xgb, y, folds, 0.25)
    k = 7
    fold = folds[k]
    y_flipped = y.copy()
    y_flipped[fold.test] = 1 - y_flipped[fold.test]
    alt = cross_fit_ensemble(lr, xgb, y_flipped, folds, 0.25)
    assert np.array_equal(ref.proba[fold.repeat, fold.test], alt.proba[fold.repeat, fold.test])
    assert ref.thresholds[k] == alt.thresholds[k]
    assert ref.choices[k] == alt.choices[k]


def test_cross_fitted_thresholds_ignore_the_scored_fold(oof) -> None:  # noqa: ANN001
    y, _, xgb, folds = oof
    p = np.asarray(sigmoid(xgb))
    ref = cross_fitted_threshold_metrics(y, p, folds)
    assert len(ref) == len(folds)
    # Relabelling fold 0 changes its own metrics only through its labels, never through its threshold: with
    # the same threshold, recall on flipped labels equals the false-positive rate on the original labels.
    y2 = y.copy()
    y2[folds[0].test] = 1 - y2[folds[0].test]
    alt = cross_fitted_threshold_metrics(y2, p, folds)
    assert alt[0]["roc_auc"] == pytest.approx(1 - ref[0]["roc_auc"])
    assert alt[0]["recall"] == pytest.approx(1 - ref[0]["specificity"])
    assert alt[0]["specificity"] == pytest.approx(1 - ref[0]["recall"])


def test_platt_fitted_on_mis_scaled_margins_is_detectably_wrong() -> None:
    """Why calibration uses OOF margins of the DEPLOYED hyper-parameters: a map fitted on margins with a
    different spread (e.g. a much weaker regularisation in the CV folds) compresses deployed probabilities."""
    rng = np.random.default_rng(0)
    n = 4000
    y = rng.integers(0, 2, n)
    true_logit = 1.5 * (2 * y - 1) + rng.normal(size=n)
    deployed = 0.3 * true_logit  # heavily shrunk final model (tiny C)
    cv_folds = 1.0 * true_logit  # fold models with a larger C
    a_wrong, b_wrong = fit_platt(cv_folds, y)
    a_right, b_right = fit_platt(deployed, y)
    assert a_right == pytest.approx(a_wrong / 0.3, rel=1e-6)
    p_wrong = np.asarray(sigmoid(a_wrong * deployed + b_wrong))
    p_right = np.asarray(sigmoid(a_right * deployed + b_right))
    slope_wrong, _ = fit_platt(np.log(p_wrong / (1 - p_wrong)), y)
    slope_right, _ = fit_platt(np.log(p_right / (1 - p_right)), y)
    assert slope_wrong > 3 and slope_right == pytest.approx(1.0, abs=1e-6)


def test_choose_weight_prefers_the_informative_component(oof) -> None:  # noqa: ANN001
    y, lr, xgb, _ = oof
    fit = choose_weight(lr["good"], lr["weak"], y, 0.1)
    assert fit.weight >= 0.7 and fit.platt_a > 0


def test_deployed_calibration_is_documented(metrics_json, model_json) -> None:  # noqa: ANN001
    for t, r in metrics_json["targets"].items():
        comps = r["components"]
        assert "deployed hyper-parameters" in comps["calibration_source"]
        cal = model_json["models"][t]["calibration"]
        assert cal["a"] == pytest.approx(comps["platt"]["a"], rel=1e-5)
        assert cal["b"] == pytest.approx(comps["platt"]["b"], rel=1e-5, abs=1e-6)
        lr_w = next(c["weight"] for c in model_json["models"][t]["components"] if c["type"] == "logistic")
        assert lr_w == pytest.approx(comps["logistic"]["weight"], abs=1e-6)
        assert r["threshold"] == pytest.approx(model_json["models"][t]["threshold"], rel=1e-5)
    assert metrics_json["protocol"]["test_set_history"], "every re-scoring of the locked test set must be recorded"
