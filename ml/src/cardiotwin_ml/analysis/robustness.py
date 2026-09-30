"""Monte-Carlo repeated hold-out of the frozen CardioTwin recipe.

The locked test set holds 61 patients, so a single test ROC-AUC has a bootstrap CI ~0.25 wide *and* depends on
which 61 patients happened to be drawn. This analysis repeats the entire deployment recipe on many random
stratified 80/20 splits of the full cohort and reports the distribution of held-out metrics, plus where the
locked split falls in it (its percentile).

What is frozen vs re-derived inside every split (no information from a split's test part enters any choice):

* **Frozen** (structural choices made once on the locked development set): feature encoding, model families
  (logistic regression + XGBoost margin ensemble), the per-target logistic variant, the search spaces, the
  clinical-baseline specification and every rule below.
* **Re-derived on the split's development part** - ``hyperparameters="search"`` (default): the deployed final
  hyper-parameter search (``RandomizedSearchCV``, log-loss, repeated stratified 5-fold x 3); then a repeated
  stratified 5-fold x 10 CV with those hyper-parameters gives out-of-fold margins on which the ensemble weight
  ``w``, the Platt parameters and the Youden threshold are fitted, and the components are refitted on the whole
  development part - exactly ``train.py``. ``hyperparameters="frozen"`` skips the search and reuses the deployed
  hyper-parameters (cheaper; slightly optimistic because they were tuned on patients that now sit in test parts).

The harness is validated by running it on the locked split itself: it must reproduce the deployed test-set
probabilities exactly (``reproduction`` in the output).
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import numpy as np
from joblib import Parallel, delayed
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from ..ensemble import LogisticComponent, TargetModel, XGBComponent, choose_thresholds, choose_weight, fit_platt, sigmoid
from ..evaluate import MARGIN_KINDS, Fold, make_folds
from ..metrics import binary_metrics, fast_roc_auc, round_float, youden_threshold
from ..models import STEP, ModelSpec, decision_margin, positive_proba
from .common import AnalysisContext, tune
from .stats import distribution, percentile_rank

log = logging.getLogger(__name__)

HYPERPARAMETER_MODES = ("search", "frozen")
#: Held-out metrics summarised per target (keys of :func:`evaluate_on_test`).
REPORTED = ("roc_auc", "pr_auc", "f1", "recall", "specificity", "accuracy", "balanced_accuracy", "mcc", "brier",
            "log_loss", "calibration_slope", "calibration_in_the_large")
#: Metrics whose per-split values are exported (``samples``) for plotting.
SAMPLED = ("roc_auc", "f1", "brier")
LOCKED = -1  # split id of the locked hold-out split


# --------------------------------------------------------------------------- splits


def monte_carlo_splits(
    strata: np.ndarray, n_splits: int, test_size: float, seed_start: int
) -> Iterator[tuple[int, np.ndarray, np.ndarray]]:
    """Random stratified hold-out splits; split ``i`` uses ``random_state = seed_start + i``.

    Stratified on the same merged joint CAD/LAD/LCX/RCA pattern as the locked split, so every split keeps the
    prevalence and co-occurrence structure of the cohort. Yields ``(i, dev_positions, test_positions)`` (sorted).
    """
    idx = np.arange(len(strata))
    for i in range(n_splits):
        dev, test = train_test_split(idx, test_size=test_size, random_state=seed_start + i, shuffle=True, stratify=strata)
        yield i, np.sort(dev), np.sort(test)


# --------------------------------------------------------------------------- recipe


@dataclass
class RecipeFit:
    """The recipe fitted on one development part."""

    model: TargetModel
    baseline: Pipeline
    baseline_threshold: float
    params: dict[str, dict[str, Any]]


def _oof(spec: ModelSpec, X: np.ndarray, y: np.ndarray, folds: list[Fold], overrides: dict[str, Any], seed: int,
         columns: list[str]) -> tuple[np.ndarray, np.ndarray | None]:
    """Out-of-fold probabilities (and log-odds margins for margin models) with fixed hyper-parameters."""
    n_repeats = max(f.repeat for f in folds) + 1
    proba = np.full((n_repeats, len(y)), np.nan)
    margin = np.full((n_repeats, len(y)), np.nan) if spec.kind in MARGIN_KINDS else None
    for f in folds:
        pipe = spec.build(seed, overrides, columns).fit(X[f.train], y[f.train])
        proba[f.repeat, f.test] = positive_proba(pipe, X[f.test])
        if margin is not None:
            margin[f.repeat, f.test] = decision_margin(pipe, X[f.test])
    assert not np.isnan(proba).any()
    return proba, margin


def fit_recipe(ctx: AnalysisContext, target: str, dev_pos: np.ndarray, hyperparameters: str = "search") -> RecipeFit:
    """Fit the complete deployment recipe of ``target`` on the rows ``dev_pos`` (see module docstring)."""
    if hyperparameters not in HYPERPARAMETER_MODES:
        raise ValueError(f"hyperparameters must be one of {HYPERPARAMETER_MODES}")
    cfg, seed, columns = ctx.cfg, ctx.seed, ctx.columns
    frozen = ctx.frozen[target]
    lr_name, tree, bl_name = frozen.logistic, cfg["ensemble"]["tree_component"], cfg["baseline"]["model"]
    X, y = ctx.X[dev_pos], ctx.y(target)[dev_pos]

    params: dict[str, dict[str, Any]] = {}
    for comp, fixed in ((lr_name, frozen.logistic_params), (tree, frozen.xgboost_params), (bl_name, frozen.baseline_params)):
        if comp in params:
            continue
        params[comp] = tune(ctx.specs[comp], X, y, cfg, seed, columns) if hyperparameters == "search" else dict(fixed)

    folds = make_folds(y, cfg["cv"]["n_splits"], cfg["cv"]["n_repeats"], seed)
    oof = {c: _oof(ctx.specs[c], X, y, folds, params[c], seed, columns) for c in params}
    m_lr, m_xgb = oof[lr_name][1], oof[tree][1]
    assert m_lr is not None and m_xgb is not None
    fit = choose_weight(m_lr, m_xgb, y, cfg["ensemble"]["weight_grid_step"])
    oof_p = np.asarray(sigmoid(fit.platt_a * (fit.weight * m_lr + (1 - fit.weight) * m_xgb) + fit.platt_b))
    thresholds = choose_thresholds(y, oof_p)
    bl_oof = oof[bl_name][0]
    bl_threshold = youden_threshold(np.tile(y, bl_oof.shape[0]), bl_oof.ravel())

    pipes = {c: ctx.specs[c].build(seed, params[c], columns).fit(X, y) for c in params}
    lr_comp = LogisticComponent.from_pipeline(lr_name, pipes[lr_name], X, params[lr_name])
    xgb_comp = XGBComponent.from_model(pipes[tree].named_steps[STEP], columns, params[tree])
    model = TargetModel(target, columns, lr_comp, xgb_comp, fit.weight, fit.platt_a, fit.platt_b, thresholds.youden, thresholds.f1)
    return RecipeFit(model, pipes[bl_name], bl_threshold, params)


def evaluate_on_test(fit: RecipeFit, X: np.ndarray, y: np.ndarray) -> dict[str, float]:
    """Held-out metrics of a fitted recipe (deployed threshold) plus the clinical baseline's ROC-AUC."""
    p = fit.model.predict_proba(X)
    out = binary_metrics(y, p, fit.model.threshold)
    lp = np.log(np.clip(p, 1e-12, 1 - 1e-12) / np.clip(1 - p, 1e-12, 1))
    slope, _ = fit_platt(lp, y)
    out["calibration_slope"] = slope
    out["calibration_in_the_large"] = float(np.mean(y) - np.mean(p))
    p_bl = positive_proba(fit.baseline, X)
    out["baseline_roc_auc"] = fast_roc_auc(y, p_bl)
    out["delta_roc_auc_vs_baseline"] = out["roc_auc"] - out["baseline_roc_auc"]
    out["weight_lr"] = fit.model.weight
    out["platt_a"] = fit.model.platt_a
    out["threshold"] = fit.model.threshold
    return {k: float(v) for k, v in out.items()}


def _split_task(ctx: AnalysisContext, split_id: int, target: str, dev_pos: np.ndarray, test_pos: np.ndarray,
                hyperparameters: str, return_proba: bool = False) -> tuple[int, str, dict[str, float], np.ndarray | None]:
    fit = fit_recipe(ctx, target, dev_pos, hyperparameters)
    Xt, yt = ctx.X[test_pos], ctx.y(target)[test_pos]
    proba = fit.model.predict_proba(Xt) if return_proba else None
    return split_id, target, evaluate_on_test(fit, Xt, yt), proba


# --------------------------------------------------------------------------- driver


@dataclass
class RobustnessRun:
    """Raw per-split results: ``values[target][metric]`` is an array over the Monte-Carlo splits."""

    hyperparameters: str
    n_splits: int
    values: dict[str, dict[str, np.ndarray]]
    locked: dict[str, dict[str, float]]
    reproduction_max_abs_diff: float


def run_robustness(ctx: AnalysisContext, n_splits: int, test_size: float, seed_start: int,
                   hyperparameters: str = "search", n_jobs: int = 1) -> RobustnessRun:
    """Run the recipe on the locked split (reproduction check) and ``n_splits`` Monte-Carlo splits.

    One joblib task per (split, target); results are assembled by key, so they do not depend on ``n_jobs``.
    """
    light = ctx.light()
    tasks = [delayed(_split_task)(light, LOCKED, t, ctx.dev_pos, ctx.test_pos, hyperparameters, True) for t in ctx.targets]
    for i, dev, test in monte_carlo_splits(ctx.strata, n_splits, test_size, seed_start):
        tasks += [delayed(_split_task)(light, i, t, dev, test, hyperparameters) for t in ctx.targets]
    log.info("robustness (%s hyper-parameters): %d splits x %d targets on %d workers", hyperparameters, n_splits,
             len(ctx.targets), n_jobs)
    outputs = Parallel(n_jobs=n_jobs, backend="loky", batch_size=1)(tasks)
    by_key = {(sid, t): (res, proba) for sid, t, res, proba in outputs}

    locked: dict[str, dict[str, float]] = {}
    max_diff = 0.0
    for t in ctx.targets:
        res, proba = by_key[(LOCKED, t)]
        locked[t] = res
        if ctx.deployed:
            deployed = ctx.deployed[t].predict_proba(ctx.X[ctx.test_pos])
            assert proba is not None
            max_diff = max(max_diff, float(np.max(np.abs(proba - deployed))))
    values = {
        t: {k: np.array([by_key[(i, t)][0][k] for i in range(n_splits)]) for k in by_key[(0, t)][0]}
        for t in ctx.targets
    } if n_splits else {t: {} for t in ctx.targets}
    return RobustnessRun(hyperparameters, n_splits, values, locked, max_diff)


# --------------------------------------------------------------------------- summaries


def _block(samples: np.ndarray, fixed: float) -> dict[str, Any]:
    out = distribution(samples)
    out["fixed_split"] = round_float(fixed)
    out["fixed_split_percentile"] = round(percentile_rank(samples, fixed), 1)
    return out


def summarise(run: RobustnessRun, ctx: AnalysisContext, sensitivity: RobustnessRun | None = None) -> dict[str, Any]:
    """Per-target JSON block for ``metrics.json -> robustness`` (docs/CONTRACTS.md §7.2)."""
    out: dict[str, Any] = {}
    for t in ctx.targets:
        v, fixed = run.values[t], run.locked[t]
        cv_auc = ctx.metrics["targets"][t]["cv"]["roc_auc"]["mean"] if ctx.metrics else float("nan")
        block: dict[str, Any] = {"n_splits": run.n_splits}
        for k in REPORTED:
            block[k] = _block(v[k], fixed[k])
        block["fixed_split_percentile"] = block["roc_auc"]["fixed_split_percentile"]
        delta = v["delta_roc_auc_vs_baseline"]
        block["baseline_roc_auc"] = _block(v["baseline_roc_auc"], fixed["baseline_roc_auc"])
        block["delta_roc_auc_vs_baseline"] = _block(delta, fixed["delta_roc_auc_vs_baseline"]) | {
            "share_positive": round_float(float(np.mean(delta > 0)))
        }
        block["cv_estimate"] = {
            "roc_auc": round_float(cv_auc),
            "percentile": round(percentile_rank(v["roc_auc"], cv_auc), 1),
            "note": "cross-fitted development-set CV mean ROC-AUC and its percentile in the Monte-Carlo test distribution",
        }
        block["recipe"] = {k: distribution(v[k]) for k in ("weight_lr", "platt_a", "threshold")}
        block["samples"] = {k: [round(float(x), 4) for x in v[k]] for k in SAMPLED}
        if sensitivity is not None:
            s = sensitivity.values[t]
            d = v["roc_auc"] - s["roc_auc"]
            block["hyperparameter_sensitivity"] = {
                "compared": f"{run.hyperparameters} (primary) - {sensitivity.hyperparameters} hyper-parameters, same splits",
                "roc_auc_mean_primary": round_float(float(np.mean(v["roc_auc"]))),
                "roc_auc_mean_alternative": round_float(float(np.mean(s["roc_auc"]))),
                "delta_roc_auc": distribution(d),
                "brier_mean_alternative": round_float(float(np.mean(s["brier"]))),
                "f1_mean_alternative": round_float(float(np.mean(s["f1"]))),
            }
        out[t] = block
    return out


def protocol(run: RobustnessRun, test_size: float, seed_start: int, sensitivity: RobustnessRun | None) -> dict[str, Any]:
    """Human-readable method description + settings (``metrics.json -> analysis.robustness``)."""
    searched = run.hyperparameters == "search"
    return {
        "method": (
            f"Monte-Carlo repeated hold-out: {run.n_splits} random {1 - test_size:.0%}/{test_size:.0%} splits of all "
            "patients, stratified on the joint CAD/LAD/LCX/RCA pattern (as the locked split). In every split the "
            "complete deployment recipe is re-run on the development part only"
            + (" - final hyper-parameter search (RandomizedSearchCV, log-loss)," if searched else " (deployed hyper-parameters),")
            + " 10 x 5-fold out-of-fold margins -> ensemble weight, Platt calibration and Youden threshold, refit - and "
            "scored once on the split's test part. The clinical baseline is re-fitted the same way."
        ),
        "n_splits": run.n_splits,
        "test_size": test_size,
        "split_seeds": f"random_state = {seed_start} + i (i = 0..{run.n_splits - 1})",
        "hyperparameters": run.hyperparameters,
        "frozen": [
            "feature encoding and dropped constant columns",
            "model families and the per-target logistic variant",
            "hyper-parameter search spaces and every selection rule",
        ] + ([] if searched else ["hyper-parameters (deployed values)"]),
        "re_derived_per_split": (["hyper-parameters (same search procedure)"] if searched else [])
        + ["ensemble weight w", "Platt a, b", "Youden threshold", "component refit"],
        "fixed_split": "the locked seed-42 split; its values are the published test metrics",
        "reproduction": {
            "description": "the harness run on the locked split must reproduce the deployed test probabilities",
            "max_abs_probability_difference": run.reproduction_max_abs_diff,
        },
        "percentile": "mid-rank percentile of the locked split's value within the Monte-Carlo distribution",
        "sensitivity": (
            f"the same splits were also run with {sensitivity.hyperparameters} hyper-parameters "
            "(robustness.<target>.hyperparameter_sensitivity)" if sensitivity is not None else None
        ),
        "caveat": (
            "Test parts overlap across splits (and with the locked test set), so the spread describes split-to-split "
            "variability of a 61-patient evaluation, not independent replications; no choice of the deployed model "
            "depends on this analysis."
        ),
    }
