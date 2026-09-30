"""Classification metrics, stratified bootstrap confidence intervals and evaluation curves."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.stats import rankdata
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    log_loss,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)

#: Metrics reported everywhere, in display order.
METRIC_NAMES = (
    "roc_auc",
    "pr_auc",
    "accuracy",
    "balanced_accuracy",
    "precision",
    "recall",
    "specificity",
    "f1",
    "mcc",
    "brier",
    "log_loss",
)
THRESHOLD_FREE = frozenset({"roc_auc", "pr_auc", "brier", "log_loss"})
_EPS = 1e-15


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def fast_roc_auc(y: np.ndarray, p: np.ndarray) -> float:
    """Mann-Whitney ROC-AUC with average ranks for ties (== sklearn ``roc_auc_score``)."""
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    ranks = rankdata(p)
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def fast_average_precision(y: np.ndarray, p: np.ndarray) -> float:
    """Step-wise average precision over distinct thresholds (== sklearn ``average_precision_score``)."""
    n_pos = int(y.sum())
    if n_pos == 0:
        return float("nan")
    order = np.argsort(-p, kind="mergesort")
    ps, ys = p[order], y[order]
    last_of_group = np.r_[np.flatnonzero(np.diff(ps) != 0), len(ps) - 1]
    tp = np.cumsum(ys)[last_of_group]
    fp = (last_of_group + 1) - tp
    precision = tp / (tp + fp)
    recall = tp / n_pos
    return float(np.sum(np.diff(np.r_[0.0, recall]) * precision))


def binary_metrics(y: np.ndarray, p: np.ndarray, threshold: float) -> dict[str, float]:
    """All metrics for probabilities ``p`` and labels ``y`` at a decision ``threshold`` (p >= t -> 1)."""
    y = np.asarray(y, dtype=int)
    p = np.clip(np.asarray(p, dtype=np.float64), _EPS, 1 - _EPS)
    pred = p >= threshold
    pos = y == 1
    tp = int(np.sum(pred & pos))
    tn = int(np.sum(~pred & ~pos))
    fp = int(np.sum(pred & ~pos))
    fn = int(np.sum(~pred & pos))
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    specificity = _safe_div(tn, tn + fp)
    denom = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    return {
        "roc_auc": fast_roc_auc(y, p),
        "pr_auc": fast_average_precision(y, p),
        "accuracy": (tp + tn) / len(y),
        "balanced_accuracy": 0.5 * (recall + specificity),
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "f1": _safe_div(2 * precision * recall, precision + recall),
        "mcc": _safe_div(tp * tn - fp * fn, denom),
        "brier": float(np.mean((p - y) ** 2)),
        "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
    }


def sklearn_reference_metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    """Threshold-free metrics via scikit-learn (used by tests to validate the fast versions)."""
    return {
        "roc_auc": float(roc_auc_score(y, p)),
        "pr_auc": float(average_precision_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
    }


def confusion(y: np.ndarray, p: np.ndarray, threshold: float) -> dict[str, int]:
    tn, fp, fn, tp = confusion_matrix(np.asarray(y, int), (np.asarray(p) >= threshold).astype(int), labels=[0, 1]).ravel()
    return {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}


def stratified_bootstrap_indices(y: np.ndarray, n_resamples: int, seed: int) -> np.ndarray:
    """``(n_resamples, n)`` index matrix; each resample keeps the class counts of ``y``."""
    y = np.asarray(y, dtype=int)
    rng = np.random.default_rng(seed)
    pos = np.flatnonzero(y == 1)
    neg = np.flatnonzero(y == 0)
    out = np.empty((n_resamples, len(y)), dtype=np.int64)
    for b in range(n_resamples):
        out[b, : len(pos)] = rng.choice(pos, size=len(pos), replace=True)
        out[b, len(pos) :] = rng.choice(neg, size=len(neg), replace=True)
    return out


def bootstrap_metrics(
    y: np.ndarray, p: np.ndarray, threshold: float, n_resamples: int, seed: int, confidence: float = 0.95
) -> dict[str, dict[str, Any]]:
    """Point estimate + percentile CI for every metric (threshold held fixed, as deployed)."""
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=np.float64)
    point = binary_metrics(y, p, threshold)
    idx = stratified_bootstrap_indices(y, n_resamples, seed)
    samples = {k: np.empty(n_resamples) for k in METRIC_NAMES}
    for b in range(n_resamples):
        m = binary_metrics(y[idx[b]], p[idx[b]], threshold)
        for k in METRIC_NAMES:
            samples[k][b] = m[k]
    alpha = (1 - confidence) / 2
    out: dict[str, dict[str, Any]] = {}
    for k in METRIC_NAMES:
        lo, hi = np.nanquantile(samples[k], [alpha, 1 - alpha])
        out[k] = {"value": round_float(point[k]), "ci": [round_float(lo), round_float(hi)]}
    return out


def roc_band(
    y: np.ndarray, p: np.ndarray, n_resamples: int, seed: int, n_points: int = 101, confidence: float = 0.95
) -> dict[str, list[float]]:
    """Pointwise bootstrap band of TPR over a fixed FPR grid (for plotting CI ribbons)."""
    y = np.asarray(y, dtype=int)
    grid = np.linspace(0, 1, n_points)
    idx = stratified_bootstrap_indices(y, n_resamples, seed + 1)
    tprs = np.empty((n_resamples, n_points))
    for b in range(n_resamples):
        fpr, tpr, _ = roc_curve(y[idx[b]], p[idx[b]])
        tprs[b] = np.interp(grid, fpr, tpr)
        tprs[b, 0] = 0.0
    alpha = (1 - confidence) / 2
    return {
        "fpr": [round_float(v) for v in grid],
        "tpr_low": [round_float(v) for v in np.quantile(tprs, alpha, axis=0)],
        "tpr_high": [round_float(v) for v in np.quantile(tprs, 1 - alpha, axis=0)],
    }


def roc_points(y: np.ndarray, p: np.ndarray) -> dict[str, list[float]]:
    fpr, tpr, thr = roc_curve(y, p)
    thr = np.where(np.isfinite(thr), thr, 1.0)
    return {"fpr": _r(fpr), "tpr": _r(tpr), "thresholds": _r(thr)}


def pr_points(y: np.ndarray, p: np.ndarray) -> dict[str, list[float]]:
    precision, recall, _ = precision_recall_curve(y, p)
    # sklearn returns decreasing recall; flip so recall increases left -> right.
    return {"recall": _r(recall[::-1]), "precision": _r(precision[::-1])}


def calibration_points(y: np.ndarray, p: np.ndarray, n_bins: int) -> dict[str, list[float]]:
    """Reliability curve with quantile bins (equal patient counts per bin)."""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    order = np.argsort(p, kind="mergesort")
    bins = np.array_split(order, n_bins)
    mean_pred, frac_pos, count = [], [], []
    for b in bins:
        if len(b) == 0:
            continue
        mean_pred.append(float(p[b].mean()))
        frac_pos.append(float(y[b].mean()))
        count.append(int(len(b)))
    return {"mean_predicted": _r(mean_pred), "fraction_positive": _r(frac_pos), "count": count}


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int) -> float:
    cal = calibration_points(y, p, n_bins)
    n = sum(cal["count"])
    return float(
        sum(c * abs(m - f) for m, f, c in zip(cal["mean_predicted"], cal["fraction_positive"], cal["count"], strict=True))
        / n
    )


def decision_curve(
    y: np.ndarray, p: np.ndarray, start: float, stop: float, step: float
) -> dict[str, list[float]]:
    """Net benefit (Vickers & Elkin 2006) of the model vs treat-all / treat-none."""
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    n = len(y)
    prevalence = y.mean()
    thresholds = np.round(np.arange(start, stop + step / 2, step), 4)
    model, treat_all = [], []
    for t in thresholds:
        pred = p >= t
        tp = np.sum(pred & (y == 1))
        fp = np.sum(pred & (y == 0))
        odds = t / (1 - t)
        model.append(tp / n - fp / n * odds)
        treat_all.append(prevalence - (1 - prevalence) * odds)
    return {
        "thresholds": _r(thresholds),
        "model": _r(model),
        "treat_all": _r(treat_all),
        "treat_none": [0.0] * len(thresholds),
    }


def youden_threshold(y: np.ndarray, p: np.ndarray) -> float:
    """Threshold maximising sensitivity + specificity - 1 (midpoint between adjacent scores)."""
    fpr, tpr, thr = roc_curve(y, p)
    j = tpr - fpr
    k = int(np.argmax(j))
    return _midpoint_threshold(p, thr[k])


def f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    precision, recall, thr = precision_recall_curve(y, p)
    f1 = np.where(precision + recall > 0, 2 * precision * recall / np.maximum(precision + recall, _EPS), 0)
    k = int(np.argmax(f1[:-1]))
    return _midpoint_threshold(p, thr[k])


def _midpoint_threshold(p: np.ndarray, t: float) -> float:
    """Move a data-valued threshold halfway to the next lower score for stability on unseen data."""
    p = np.unique(np.asarray(p, dtype=float))
    if not np.isfinite(t):
        return float(p.max())
    below = p[p < t]
    return float((t + below.max()) / 2) if below.size else float(t)


def summarise_folds(fold_metrics: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    out = {}
    for k in METRIC_NAMES:
        vals = np.array([m[k] for m in fold_metrics], dtype=float)
        out[k] = {"mean": round_float(np.nanmean(vals)), "std": round_float(np.nanstd(vals, ddof=1))}
    return out


def round_float(x: float, digits: int = 6) -> float:
    x = float(x)
    if not math.isfinite(x):
        return x
    return float(f"{x:.{digits}g}") if x != 0 else 0.0


def _r(values: Any) -> list[float]:
    return [round_float(v) for v in np.asarray(values, dtype=float)]
