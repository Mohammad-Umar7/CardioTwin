"""Development-set validation: repeated stratified CV leaderboard, nested tuning and ablations.

Protocol (all on the development split; the locked test split is never passed to this module):

* **Outer loop** - ``RepeatedStratifiedKFold(n_splits, n_repeats)`` per target, identical folds for every
  model of that target so comparisons are paired.
* **Nested tuning** - models with a search space are tuned *inside each outer training fold* by
  ``RandomizedSearchCV`` over a stratified inner k-fold; the outer fold is predicted by the refitted
  inner winner. The outer estimate therefore contains no tuning optimism.
* **Out-of-fold (OOF) predictions** - every dev patient is predicted once per repeat by a model that
  never saw them. OOF log-odds margins of the logistic and XGBoost components feed ensemble weighting,
  Platt calibration and threshold selection (see ``ensemble.py``).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from joblib import Parallel, delayed
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.model_selection import RandomizedSearchCV, RepeatedStratifiedKFold, StratifiedKFold
from sklearn.pipeline import Pipeline

from .metrics import binary_metrics, summarise_folds
from .models import ModelSpec, decision_margin, positive_proba

log = logging.getLogger(__name__)

MARGIN_KINDS = frozenset({"logistic", "xgboost"})


@dataclass(frozen=True)
class Fold:
    fold_id: int
    repeat: int
    train: np.ndarray
    test: np.ndarray


def make_folds(y: np.ndarray, n_splits: int, n_repeats: int, seed: int) -> list[Fold]:
    rskf = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=seed)
    return [
        Fold(i, i // n_splits, tr, te) for i, (tr, te) in enumerate(rskf.split(np.zeros((len(y), 1)), y))
    ]


@dataclass
class FoldOutput:
    fold_id: int
    repeat: int
    test: np.ndarray
    proba: np.ndarray
    margin: np.ndarray | None
    params: dict[str, Any]


@dataclass
class CVResult:
    """Out-of-fold predictions of one model for one target."""

    model: str
    target: str
    n_repeats: int
    proba: np.ndarray  # (n_repeats, n_dev)
    margin: np.ndarray | None  # (n_repeats, n_dev) for margin models
    fold_metrics: list[dict[str, float]] = field(default_factory=list)
    params: list[dict[str, Any]] = field(default_factory=list)

    def summary(self) -> dict[str, dict[str, float]]:
        return summarise_folds(self.fold_metrics)


def anova_f(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """ANOVA F-test that scores constant-within-fold columns as 0 instead of warning (NaN)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        f, p = f_classif(X, y)
    return np.nan_to_num(f, nan=0.0, posinf=0.0), np.nan_to_num(p, nan=1.0)


def with_selector(pipeline: Pipeline, k: int) -> Pipeline:
    """Insert in-fold univariate feature selection (ANOVA F) right before the estimator."""
    steps = list(pipeline.steps)
    steps.insert(len(steps) - 1, ("select", SelectKBest(anova_f, k=k)))
    return Pipeline(steps)


def fit_estimator(
    spec: ModelSpec,
    X: np.ndarray,
    y: np.ndarray,
    seed: int,
    tuning: dict[str, Any] | None,
    inner_seed: int,
    overrides: dict[str, Any] | None = None,
    select_k: int | None = None,
    inner_repeats: int = 1,
    columns: list[str] | None = None,
) -> tuple[Pipeline, dict[str, Any]]:
    """Fit one model; tuned models run a RandomizedSearchCV on (X, y) and refit the winner."""
    pipe = spec.build(seed, overrides, columns)
    if select_k:
        pipe = with_selector(pipe, min(select_k, X.shape[1]))
    if tuning is None or not spec.tuned:
        pipe.fit(X, y)
        return pipe, {}
    if inner_repeats > 1:
        inner = RepeatedStratifiedKFold(n_splits=tuning["inner_splits"], n_repeats=inner_repeats, random_state=inner_seed)
    else:
        inner = StratifiedKFold(n_splits=tuning["inner_splits"], shuffle=True, random_state=inner_seed)
    search = RandomizedSearchCV(
        pipe,
        spec.param_distributions(),
        n_iter=spec.n_iter,
        scoring=tuning.get("scoring", "roc_auc"),
        cv=inner,
        random_state=seed,
        n_jobs=1,
        refit=True,
        error_score="raise",
    )
    search.fit(X, y)
    return search.best_estimator_, dict(search.best_params_)


def _fold_task(
    spec: ModelSpec,
    X: np.ndarray,
    y: np.ndarray,
    fold: Fold,
    seed: int,
    tuning: dict[str, Any] | None,
    overrides: dict[str, Any] | None,
    select_k: int | None,
    columns: list[str] | None = None,
) -> FoldOutput:
    model, params = fit_estimator(
        spec, X[fold.train], y[fold.train], seed, tuning, seed + 1000 + fold.fold_id, overrides, select_k, columns=columns
    )
    Xt = X[fold.test]
    proba = positive_proba(model, Xt)
    margin = decision_margin(model, Xt) if spec.kind in MARGIN_KINDS else None
    return FoldOutput(fold.fold_id, fold.repeat, fold.test, proba, margin, params)


def _assemble(model: str, target: str, n: int, n_repeats: int, outs: Sequence[FoldOutput], y: np.ndarray) -> CVResult:
    proba = np.full((n_repeats, n), np.nan)
    has_margin = outs[0].margin is not None
    margin = np.full((n_repeats, n), np.nan) if has_margin else None
    fold_metrics, params = [], []
    for o in sorted(outs, key=lambda o: o.fold_id):
        proba[o.repeat, o.test] = o.proba
        if margin is not None and o.margin is not None:
            margin[o.repeat, o.test] = o.margin
        fold_metrics.append(binary_metrics(y[o.test], o.proba, 0.5))
        params.append(o.params)
    assert not np.isnan(proba).any(), "every dev patient must be predicted once per repeat"
    return CVResult(model, target, n_repeats, proba, margin, fold_metrics, params)


@dataclass(frozen=True)
class CVJob:
    """One (model, target) cross-validation to run."""

    key: str
    spec: ModelSpec
    target: str
    X: np.ndarray
    y: np.ndarray
    folds: list[Fold]
    nested: bool = True
    overrides: dict[str, Any] | None = None
    select_k: int | None = None
    columns: list[str] | None = None


def run_cv_jobs(jobs: Sequence[CVJob], seed: int, tuning: dict[str, Any], n_jobs: int = -1) -> dict[str, CVResult]:
    """Run many CV jobs with fold-level parallelism; results are deterministic and order-independent."""
    tasks = []
    index = []
    for j, job in enumerate(jobs):
        for fold in job.folds:
            tasks.append(
                delayed(_fold_task)(
                    job.spec, job.X, job.y, fold, seed, tuning if job.nested else None, job.overrides, job.select_k,
                    job.columns,
                )
            )
            index.append(j)
    outputs = Parallel(n_jobs=n_jobs, backend="loky", batch_size=1)(tasks)
    grouped: dict[int, list[FoldOutput]] = {}
    for j, out in zip(index, outputs, strict=True):
        grouped.setdefault(j, []).append(out)
    results = {}
    for j, job in enumerate(jobs):
        n_repeats = max(f.repeat for f in job.folds) + 1
        results[job.key] = _assemble(job.spec.name, job.target, len(job.y), n_repeats, grouped[j], job.y)
    return results


# --------------------------------------------------------------------------- classifier-chain ablation


def _chain_fold_task(
    lr_spec: ModelSpec,
    comp_spec: ModelSpec,
    X: np.ndarray,
    y_cad: np.ndarray,
    y: np.ndarray,
    fold: Fold,
    seed: int,
    overrides_lr: dict[str, Any],
    overrides_comp: dict[str, Any],
) -> FoldOutput:
    """Vessel model with an extra input: the CAD model's probability, computed without leakage.

    Training rows receive *inner out-of-fold* CAD probabilities; held-out rows receive the prediction of a
    CAD model fitted on the whole outer training fold.
    """
    Xtr, Xte = X[fold.train], X[fold.test]
    cad_oof = np.zeros(len(fold.train))
    inner = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed + 2000 + fold.fold_id)
    for itr, ite in inner.split(Xtr, y_cad[fold.train]):
        m = lr_spec.build(seed, overrides_lr).fit(Xtr[itr], y_cad[fold.train][itr])
        cad_oof[ite] = positive_proba(m, Xtr[ite])
    cad_model = lr_spec.build(seed, overrides_lr).fit(Xtr, y_cad[fold.train])
    cad_test = positive_proba(cad_model, Xte)
    Xtr_c = np.column_stack([Xtr, cad_oof])
    Xte_c = np.column_stack([Xte, cad_test])
    model = comp_spec.build(seed, overrides_comp).fit(Xtr_c, y[fold.train])
    proba = positive_proba(model, Xte_c)
    margin = decision_margin(model, Xte_c)
    return FoldOutput(fold.fold_id, fold.repeat, fold.test, proba, margin, {})


def run_chain_cv(
    lr_spec: ModelSpec,
    comp_spec: ModelSpec,
    target: str,
    X: np.ndarray,
    y_cad: np.ndarray,
    y: np.ndarray,
    folds: list[Fold],
    seed: int,
    overrides_lr: dict[str, Any],
    overrides_comp: dict[str, Any],
    n_jobs: int = -1,
) -> CVResult:
    outs = Parallel(n_jobs=n_jobs, backend="loky", batch_size=1)(
        delayed(_chain_fold_task)(lr_spec, comp_spec, X, y_cad, y, f, seed, overrides_lr, overrides_comp) for f in folds
    )
    n_repeats = max(f.repeat for f in folds) + 1
    return _assemble(comp_spec.name, target, len(y), n_repeats, outs, y)


# --------------------------------------------------------------------------- helpers


def pooled_auc_by_repeat(proba: np.ndarray, y: np.ndarray) -> np.ndarray:
    """ROC-AUC of each repeat's complete OOF prediction vector."""
    from .metrics import fast_roc_auc

    return np.array([fast_roc_auc(y, proba[r]) for r in range(proba.shape[0])])


def fold_auc(result: CVResult) -> np.ndarray:
    return np.array([m["roc_auc"] for m in result.fold_metrics])

