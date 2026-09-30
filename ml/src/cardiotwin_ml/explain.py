"""Exact SHAP explanations in log-odds (margin) space for the deployed ensembles.

* Logistic component - exact linear SHAP w.r.t. the development-set mean:
  ``phi_j = coef_j / scale_j * (x_j - mean_dev_j)``, base value ``intercept + sum(coef * (mean_dev - mu) / scale)``.
* XGBoost component - exact path-dependent TreeSHAP in float64 (``xgb_trees.py``) using node covers.
* Ensemble - SHAP is linear in the model, so ``phi = w * phi_LR + (1 - w) * phi_XGB`` and
  ``base = w * base_LR + (1 - w) * base_XGB``; hence ``base + sum(phi) = w*m_LR + (1-w)*m_XGB = margin``.
* Reporting - one-hot columns are summed back into their raw feature; derived features (if any are
  adopted) are separate rows carrying ``derived_from``. Every row set is still exactly additive.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from .ensemble import TargetModel
from .preprocess import FeatureEncoder

ADDITIVITY_TOL = 1e-6


def aggregate(shap_cols: np.ndarray, encoder: FeatureEncoder) -> tuple[np.ndarray, list[str]]:
    """Sum encoded-column SHAP values into one value per reported row (raw feature or derived feature)."""
    groups = encoder.attribution_groups()
    names = list(groups)
    shap_cols = np.atleast_2d(shap_cols)
    out = np.column_stack([shap_cols[:, idx].sum(axis=1) for idx in groups.values()])
    return out, names


def explain_rows(
    model: TargetModel, encoder: FeatureEncoder, X: np.ndarray
) -> tuple[np.ndarray, np.ndarray, float, list[str]]:
    """Batch explanation -> (per-row SHAP, margins, base value, row names). Asserts additivity."""
    phi = model.shap(X)
    margin = model.margin(X)
    base = model.base_value()
    err = np.max(np.abs(base + phi.sum(axis=1) - margin)) if len(X) else 0.0
    if err > ADDITIVITY_TOL:
        raise AssertionError(f"{model.target}: SHAP additivity violated (max error {err:.3e})")
    agg, names = aggregate(phi, encoder)
    return agg, margin, base, names


def contribution_list(
    encoder: FeatureEncoder, values: Mapping[str, Any], shap_row: np.ndarray, derived_values: Mapping[str, float]
) -> list[dict[str, Any]]:
    """Contract §3.2 ``contributions``: one row per raw feature (+ derived rows), sorted by |shap| desc."""
    agg, names = aggregate(shap_row[None, :], encoder)
    derived = {d.key: d for d in encoder.derived}
    rows = []
    for name, s in zip(names, agg[0], strict=True):
        if name in derived:
            rows.append(
                {
                    "feature": name,
                    "value": float(derived_values[name]),
                    "shap": float(s),
                    "derived_from": list(derived[name].inputs),
                }
            )
        else:
            v = values[name]
            rows.append({"feature": name, "value": v if isinstance(v, str) else _num(v), "shap": float(s)})
    rows.sort(key=lambda r: (-abs(r["shap"]), r["feature"]))
    return rows


def _num(v: Any) -> int | float:
    f = float(v)
    return int(f) if f.is_integer() else f


def numeric_view(encoder: FeatureEncoder, records: list[Mapping[str, Any]]) -> tuple[np.ndarray, list[str]]:
    """Per reported row, a numeric value used to colour beeswarm points (categorical -> option index)."""
    groups = list(encoder.attribution_groups())
    specs = encoder.specs
    derived = {d.key: d for d in encoder.derived}
    from .preprocess import compute_derived

    mat = np.zeros((len(records), len(groups)))
    for i, rec in enumerate(records):
        for j, name in enumerate(groups):
            if name in derived:
                mat[i, j] = compute_derived(derived[name], rec)
            else:
                spec = specs[name]
                v = rec[name]
                if spec.type == "categorical":
                    if spec.encoding_kind == "ordinal":
                        assert spec.encoding is not None
                        mat[i, j] = float(spec.encoding["map"][v])
                    else:
                        mat[i, j] = float(spec.option_values.index(v))
                else:
                    mat[i, j] = float(v)
    return mat, groups


def global_importance(shap_rows: np.ndarray, names: list[str]) -> list[dict[str, Any]]:
    mean_abs = np.abs(shap_rows).mean(axis=0)
    mean_signed = shap_rows.mean(axis=0)
    order = np.argsort(-mean_abs, kind="mergesort")
    return [
        {"feature": names[j], "mean_abs_shap": round(float(mean_abs[j]), 6), "mean_shap": round(float(mean_signed[j]), 6)}
        for j in order
    ]


def beeswarm(shap_rows: np.ndarray, values: np.ndarray, names: list[str], top: int) -> list[dict[str, Any]]:
    """Top-``top`` features by mean |SHAP|; ``v`` = min-max normalised value in [0, 1], ``s`` = SHAP."""
    mean_abs = np.abs(shap_rows).mean(axis=0)
    order = np.argsort(-mean_abs, kind="mergesort")[:top]
    out = []
    for j in order:
        col = values[:, j]
        lo, hi = float(col.min()), float(col.max())
        span = hi - lo if hi > lo else 1.0
        points = [{"v": round((float(v) - lo) / span, 4), "s": round(float(s), 5)} for v, s in zip(col, shap_rows[:, j], strict=True)]
        out.append({"feature": names[j], "mean_abs_shap": round(float(mean_abs[j]), 6), "min": lo, "max": hi, "points": points})
    return out


def shap_library_crosscheck(model: TargetModel, X: np.ndarray) -> dict[str, Any]:
    """Compare our float64 TreeSHAP with the ``shap`` package and XGBoost ``pred_contribs`` (float32)."""
    import xgboost as xgb

    ours = model.xgb.shap(X)
    booster = model.xgb.model.get_booster()
    contribs = booster.predict(xgb.DMatrix(np.asarray(X, dtype=np.float64)), pred_contribs=True)
    report: dict[str, Any] = {
        "xgboost_pred_contribs_max_abs_diff": float(np.max(np.abs(ours - contribs[:, :-1]))),
        "xgboost_bias_abs_diff": float(abs(model.xgb.expected_value() - float(contribs[0, -1]))),
    }
    try:
        import shap  # noqa: PLC0415

        explainer = shap.TreeExplainer(booster, feature_perturbation="tree_path_dependent")
        sv = np.asarray(explainer.shap_values(np.asarray(X, dtype=np.float64)))
        report["shap_library_version"] = shap.__version__
        report["shap_library_max_abs_diff"] = float(np.max(np.abs(ours - sv)))
    except ImportError:  # pragma: no cover - shap is a dev dependency
        report["shap_library_version"] = None
    return report
