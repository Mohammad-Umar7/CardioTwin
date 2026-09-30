"""Deployed per-target model: a Platt-calibrated margin-space ensemble of logistic regression + XGBoost.

    m(x) = w * m_LR(x) + (1 - w) * m_XGB(x)          (log-odds margins)
    p(x) = 1 / (1 + exp(-(a * m(x) + b)))              (Platt calibration)
    label = p(x) >= threshold

``w``, ``a``, ``b`` and ``threshold`` are all fitted on *out-of-fold* development-set margins produced by
nested cross-validation, so none of them sees a patient that the margin was trained on. Because the
ensemble is linear in margin space, its SHAP values are the same convex combination of the component
SHAP values (see ``explain.py``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from . import xgb_trees
from .metrics import f1_threshold, fast_roc_auc, youden_threshold
from .models import STEP


def sigmoid(z: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-np.asarray(z, dtype=np.float64)))


def fit_platt(margin: np.ndarray, y: np.ndarray, max_iter: int = 100, tol: float = 1e-12) -> tuple[float, float]:
    """Maximum-likelihood Platt scaling ``p = sigmoid(a*m + b)`` by Newton-Raphson (deterministic)."""
    m = np.asarray(margin, dtype=np.float64).ravel()
    t = np.asarray(y, dtype=np.float64).ravel()
    a, b = 1.0, 0.0
    for _ in range(max_iter):
        p = sigmoid(a * m + b)
        g_a = np.sum((p - t) * m)
        g_b = np.sum(p - t)
        w = p * (1 - p)
        h_aa = np.sum(w * m * m) + 1e-12
        h_ab = np.sum(w * m)
        h_bb = np.sum(w) + 1e-12
        det = h_aa * h_bb - h_ab * h_ab
        da = (h_bb * g_a - h_ab * g_b) / det
        db = (h_aa * g_b - h_ab * g_a) / det
        a, b = a - da, b - db
        if abs(da) < tol and abs(db) < tol:
            break
    return float(a), float(b)


def _log_loss(y: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, 1e-15, 1 - 1e-15)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


@dataclass
class EnsembleFit:
    weight: float  # w on the logistic component
    platt_a: float
    platt_b: float
    oof_log_loss: float
    oof_auc: float
    grid: list[dict[str, float]] = field(default_factory=list)


def choose_weight(m_lr: np.ndarray, m_xgb: np.ndarray, y: np.ndarray, step: float) -> EnsembleFit:
    """Grid-search ``w`` minimising pooled OOF log-loss after refitting Platt for each ``w``.

    ``m_lr`` / ``m_xgb`` are ``(n_repeats, n)`` OOF margins; repeats are pooled (each patient appears once
    per repeat). Log-loss is a proper scoring rule, so the choice rewards discrimination *and* calibration.
    """
    n_repeats = m_lr.shape[0]
    yy = np.tile(np.asarray(y, dtype=np.float64), n_repeats)
    grid = []
    best: EnsembleFit | None = None
    for w in np.round(np.arange(0.0, 1.0 + step / 2, step), 6):
        m = (w * m_lr + (1 - w) * m_xgb).ravel()
        a, b = fit_platt(m, yy)
        p = sigmoid(a * m + b)
        ll = _log_loss(yy, p)
        auc = float(np.mean([fast_roc_auc(np.asarray(y), (w * m_lr[r] + (1 - w) * m_xgb[r])) for r in range(n_repeats)]))
        grid.append({"w": float(w), "log_loss": round(ll, 6), "roc_auc": round(auc, 6)})
        if best is None or ll < best.oof_log_loss - 1e-12:
            best = EnsembleFit(float(w), a, b, ll, auc)
    assert best is not None
    best.grid = grid
    return best


@dataclass
class Thresholds:
    youden: float
    f1: float


def choose_thresholds(y: np.ndarray, p_oof: np.ndarray) -> Thresholds:
    """Youden-J and F1-optimal thresholds on pooled OOF calibrated probabilities."""
    n_repeats = p_oof.shape[0]
    yy = np.tile(np.asarray(y, dtype=int), n_repeats)
    pp = p_oof.ravel()
    return Thresholds(youden=youden_threshold(yy, pp), f1=f1_threshold(yy, pp))


@dataclass
class LogisticComponent:
    """Standardised logistic regression in closed form: m = intercept + sum(coef * (x - mean) / scale)."""

    name: str
    pipeline: Pipeline
    mean: np.ndarray
    scale: np.ndarray
    coef: np.ndarray
    intercept: float
    background: np.ndarray  # dev-set mean of the encoded columns (SHAP reference)
    params: dict[str, Any]

    @classmethod
    def from_pipeline(cls, name: str, pipeline: Pipeline, X_dev: np.ndarray, params: dict[str, Any]) -> LogisticComponent:
        scaler = pipeline.named_steps["scale"]
        model = pipeline.named_steps[STEP]
        return cls(
            name=name,
            pipeline=pipeline,
            mean=np.asarray(scaler.mean_, dtype=np.float64),
            scale=np.asarray(scaler.scale_, dtype=np.float64),
            coef=np.asarray(model.coef_[0], dtype=np.float64),
            intercept=float(model.intercept_[0]),
            background=np.asarray(X_dev, dtype=np.float64).mean(axis=0),
            params=params,
        )

    def margin(self, X: np.ndarray) -> np.ndarray:
        return self.intercept + ((np.asarray(X, dtype=np.float64) - self.mean) / self.scale) @ self.coef

    def expected_value(self) -> float:
        return float(self.intercept + np.sum(self.coef * (self.background - self.mean) / self.scale))

    def shap(self, X: np.ndarray) -> np.ndarray:
        """Exact linear SHAP w.r.t. the dev-set mean (interventional = observational for linear models)."""
        return (np.asarray(X, dtype=np.float64) - self.background) * (self.coef / self.scale)


@dataclass
class XGBComponent:
    """XGBoost booster evaluated through its parsed trees (float64 leaf sums, exact TreeSHAP)."""

    model: XGBClassifier
    trees: list[xgb_trees.FlatTree]
    nested: list[dict[str, Any]]
    base_score: float
    base_margin: float
    n_features: int
    params: dict[str, Any]

    @classmethod
    def from_model(cls, model: XGBClassifier, columns: list[str], params: dict[str, Any]) -> XGBComponent:
        booster = model.get_booster()
        trees, nested = xgb_trees.parse_dump(booster, columns)
        bs = xgb_trees.base_score(booster)
        return cls(model, trees, nested, bs, xgb_trees.logit(bs), len(columns), params)

    def margin(self, X: np.ndarray) -> np.ndarray:
        leaves = xgb_trees.leaf_indices(self.model.get_booster(), np.asarray(X, dtype=np.float64))
        return xgb_trees.margin_from_leaves(self.trees, leaves, self.base_margin)

    def expected_value(self) -> float:
        return xgb_trees.expected_value(self.trees, self.base_margin)

    def shap(self, X: np.ndarray) -> np.ndarray:
        return xgb_trees.tree_shap(self.trees, X, self.n_features)

    def __getstate__(self) -> dict[str, Any]:
        state = dict(self.__dict__)
        state.pop("_scalar", None)
        return state

    def shap_row(self, x: np.ndarray) -> np.ndarray:
        scalar = self.__dict__.get("_scalar")
        if scalar is None:
            scalar = xgb_trees.ScalarTreeShap(self.trees)
            self.__dict__["_scalar"] = scalar
        return np.asarray(scalar.shap(x, self.n_features))


@dataclass
class TargetModel:
    """Everything needed to predict and explain one target."""

    target: str
    columns: list[str]
    logistic: LogisticComponent
    xgb: XGBComponent
    weight: float
    platt_a: float
    platt_b: float
    threshold: float
    threshold_f1: float

    def components_margin(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.logistic.margin(X), self.xgb.margin(X)

    def margin(self, X: np.ndarray) -> np.ndarray:
        m_lr, m_xgb = self.components_margin(X)
        return self.weight * m_lr + (1 - self.weight) * m_xgb

    def calibrate(self, margin: np.ndarray) -> np.ndarray:
        return np.asarray(sigmoid(self.platt_a * np.asarray(margin) + self.platt_b), dtype=np.float64)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return self.calibrate(self.margin(X))

    def base_value(self) -> float:
        return self.weight * self.logistic.expected_value() + (1 - self.weight) * self.xgb.expected_value()

    def shap(self, X: np.ndarray) -> np.ndarray:
        return self.weight * self.logistic.shap(X) + (1 - self.weight) * self.xgb.shap(X)

    def shap_row(self, x: np.ndarray) -> np.ndarray:
        return self.weight * self.logistic.shap(x[None, :])[0] + (1 - self.weight) * self.xgb.shap_row(x)


def platt_description(a: float, b: float) -> str:
    return f"p = 1 / (1 + exp(-({a:.4f} * m {'+' if b >= 0 else '-'} {abs(b):.4f})))"


def logit(p: float) -> float:
    return math.log(p / (1 - p))
