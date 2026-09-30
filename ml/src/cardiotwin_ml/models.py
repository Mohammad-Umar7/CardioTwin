"""Model zoo: estimator factories and hyper-parameter search spaces built from ``training.yaml``.

Every estimator is wrapped in a scikit-learn :class:`~sklearn.pipeline.Pipeline` so that imputation and
scaling are fitted inside each cross-validation training fold only. Adding a model = adding a
``models:`` entry in ``training.yaml`` (with an existing ``kind``) or one factory below.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import stats
from sklearn.base import BaseEstimator
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from xgboost import XGBClassifier

STEP = "model"  # name of the final estimator step in every pipeline


def _scaled(model: BaseEstimator) -> Pipeline:
    return Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()), (STEP, model)])


def _imputed(model: BaseEstimator) -> Pipeline:
    return Pipeline([("impute", SimpleImputer(strategy="median")), (STEP, model)])


def _bare(model: BaseEstimator) -> Pipeline:
    return Pipeline([(STEP, model)])


def _logistic(params: dict[str, Any], seed: int) -> Pipeline:
    return _scaled(LogisticRegression(random_state=seed, **params))


def _xgboost(params: dict[str, Any], seed: int) -> Pipeline:
    base = {"n_jobs": 1, "random_state": seed, "eval_metric": "logloss", "verbosity": 0}
    base.update(params)
    # XGBoost handles missing values natively (learned default directions) -> no imputer.
    return _bare(XGBClassifier(**base))


FACTORIES: dict[str, Callable[[dict[str, Any], int], Pipeline]] = {
    "dummy": lambda p, s: _bare(DummyClassifier(strategy="prior", **p)),
    "logistic": _logistic,
    "svm": lambda p, s: _scaled(SVC(random_state=s, **p)),
    "knn": lambda p, s: _scaled(KNeighborsClassifier(**p)),
    "random_forest": lambda p, s: _imputed(RandomForestClassifier(random_state=s, n_jobs=1, **p)),
    "extra_trees": lambda p, s: _imputed(ExtraTreesClassifier(random_state=s, n_jobs=1, **p)),
    "hist_gb": lambda p, s: _bare(HistGradientBoostingClassifier(random_state=s, **p)),
    "xgboost": _xgboost,
}


def _distribution(spec: Any) -> Any:
    if isinstance(spec, dict) and len(spec) == 1:
        (kind, arg), = spec.items()
        if kind == "loguniform":
            return stats.loguniform(float(arg[0]), float(arg[1]))
        if kind == "uniform":
            return stats.uniform(float(arg[0]), float(arg[1]) - float(arg[0]))
        if kind == "int":
            return stats.randint(int(arg[0]), int(arg[1]) + 1)
        if kind == "choice":
            return list(arg)
    if isinstance(spec, list):
        return spec
    raise ValueError(f"unsupported search distribution {spec!r}")


@dataclass(frozen=True)
class ModelSpec:
    name: str
    kind: str
    label: str
    params: dict[str, Any]
    search: dict[str, Any]
    n_iter: int

    @property
    def tuned(self) -> bool:
        return bool(self.search)

    def build(self, seed: int, overrides: dict[str, Any] | None = None) -> Pipeline:
        params = dict(self.params)
        if overrides:
            params.update({k.removeprefix(f"{STEP}__"): v for k, v in overrides.items()})
        return FACTORIES[self.kind](params, seed)

    def param_distributions(self) -> dict[str, Any]:
        return {f"{STEP}__{k}": _distribution(v) for k, v in self.search.items()}


def model_specs(training_cfg: dict[str, Any]) -> dict[str, ModelSpec]:
    specs = {}
    for name, m in training_cfg["models"].items():
        if m["kind"] not in FACTORIES:
            raise ValueError(f"model {name}: unknown kind {m['kind']!r}")
        specs[name] = ModelSpec(
            name=name,
            kind=m["kind"],
            label=m.get("label", name),
            params=dict(m.get("params") or {}),
            search=dict(m.get("search") or {}),
            n_iter=int(m.get("n_iter", 0)),
        )
    return specs


def decision_margin(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    """Log-odds margin of a fitted logistic or XGBoost pipeline (the ensemble's native space)."""
    model = pipeline.named_steps[STEP]
    if isinstance(model, XGBClassifier):
        return np.asarray(model.predict(X, output_margin=True), dtype=np.float64)
    return np.asarray(pipeline.decision_function(X), dtype=np.float64)


def positive_proba(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    proba = pipeline.predict_proba(X)
    return np.asarray(proba[:, 1], dtype=np.float64)


def clean_params(params: dict[str, Any]) -> dict[str, Any]:
    """JSON-friendly copy of tuned parameters (numpy scalars -> Python, prefix stripped)."""
    out = {}
    for k, v in params.items():
        key = k.removeprefix(f"{STEP}__")
        if isinstance(v, np.generic):
            v = v.item()
        if isinstance(v, float):
            v = float(f"{v:.6g}")
        out[key] = v
    return out
