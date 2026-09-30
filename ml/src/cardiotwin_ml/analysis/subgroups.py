"""Subgroup performance by sex, age band and diabetes - out-of-fold (development) and locked test set.

Two sources of predictions, each at its own honest threshold:

* **OOF** - the cross-fitted development-set predictions behind ``metrics.json -> targets.<t>.cv``: nested-CV
  component margins, with the logistic variant, ensemble weight, Platt calibration and Youden threshold re-chosen
  without the scored fold (``ensemble.cross_fit_ensemble``). Every development patient is predicted once per
  repeat; metrics pool the repeats and CIs come from a patient-level (cluster) stratified bootstrap, so the
  10 correlated predictions of a patient are never treated as independent.
* **Test** - the deployed model on the 61 locked test patients at the deployed threshold; stratified bootstrap.

Subgroups are small (e.g. ~12 test patients younger than 50), so every level carries ``small_n`` when it has fewer
than ``min_n`` patients or fewer than ``min_class`` patients in either class; such estimates are descriptive only.
``delta_roc_auc_vs_reference`` compares each level with the largest level of its factor (independent bootstraps).
Nothing here changes the model: no subgroup-specific thresholds or recalibration are derived.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from ..ensemble import cross_fit_ensemble
from ..evaluate import CVJob, make_folds, run_cv_jobs
from ..metrics import binary_metrics, fast_roc_auc, round_float, summarise_folds
from .common import AnalysisContext
from .stats import percentile_ci

log = logging.getLogger(__name__)

METRICS = ("roc_auc", "sensitivity", "specificity", "ppv", "f1", "brier", "calibration_in_the_large")
#: Class-conditional metrics (ROC-AUC, sensitivity, F1, specificity) need at least this many patients per class.
MIN_CLASS = 3


# --------------------------------------------------------------------------- predictions


@dataclass
class OOFPredictions:
    """Cross-fitted OOF probabilities and the per-prediction thresholds, ``(n_repeats, n_dev)`` per target."""

    proba: dict[str, np.ndarray]
    thresholds: dict[str, np.ndarray]
    reproduced_cv: dict[str, dict[str, float]]


def cross_fitted_oof(ctx: AnalysisContext, n_jobs: int = 1, n_repeats: int | None = None) -> OOFPredictions:
    """Recompute the cross-fitted development-set OOF predictions exactly as ``train.py`` does.

    ``n_repeats`` defaults to ``cv.n_repeats`` (required to reproduce ``metrics.json``); smaller values are for
    smoke tests only.
    """
    cfg, seed = ctx.cfg, ctx.seed
    n_repeats = int(n_repeats or cfg["cv"]["n_repeats"])
    cands = list(cfg["ensemble"]["logistic_candidates"])
    tree = cfg["ensemble"]["tree_component"]
    X_dev = ctx.X[ctx.dev_pos]
    folds, jobs = {}, []
    for t in ctx.targets:
        y = ctx.y(t)[ctx.dev_pos]
        folds[t] = make_folds(y, cfg["cv"]["n_splits"], n_repeats, seed)
        jobs += [CVJob(f"{m}|{t}", ctx.specs[m], t, X_dev, y, folds[t], columns=ctx.columns) for m in (*cands, tree)]
    log.info("subgroups: nested CV of %d components x %d targets", len(cands) + 1, len(ctx.targets))
    cv = run_cv_jobs(jobs, seed, cfg["tuning"], n_jobs)
    proba, thresholds, reproduced = {}, {}, {}
    for t in ctx.targets:
        y = ctx.y(t)[ctx.dev_pos]
        margin_xgb = cv[f"{tree}|{t}"].margin
        assert margin_xgb is not None
        xf = cross_fit_ensemble({c: cv[f"{c}|{t}"].margin for c in cands}, margin_xgb, y, folds[t], cfg["ensemble"]["weight_grid_step"])
        thr = np.full(xf.proba.shape, np.nan)
        for k, f in enumerate(folds[t]):
            thr[f.repeat, f.test] = xf.thresholds[k]
        proba[t], thresholds[t] = xf.proba, thr
        summary = summarise_folds(
            [binary_metrics(y[f.test], xf.proba[f.repeat, f.test], xf.thresholds[k]) for k, f in enumerate(folds[t])]
        )
        reproduced[t] = {"roc_auc": summary["roc_auc"]["mean"], "f1": summary["f1"]["mean"]}
    return OOFPredictions(proba, thresholds, reproduced)


# --------------------------------------------------------------------------- factors


@dataclass(frozen=True)
class Level:
    id: str
    label: str
    mask: np.ndarray  # boolean over all patients


@dataclass(frozen=True)
class Factor:
    id: str
    label: str
    levels: tuple[Level, ...]


def factors(values: pd.DataFrame, age_bands: tuple[float, float] = (50, 65)) -> list[Factor]:
    """Sex, age band (``< lo``, ``lo-hi`` inclusive, ``> hi``) and diabetes, as boolean masks over ``values``."""
    lo, hi = age_bands
    age = values["Age"].to_numpy(dtype=float)
    sex = values["Sex"].to_numpy()
    dm = values["DM"].to_numpy(dtype=int)
    fmt = lambda x: f"{x:g}"  # noqa: E731
    return [
        Factor("sex", "Sex", (Level("female", "Female", sex == "Female"), Level("male", "Male", sex == "Male"))),
        Factor("age_band", "Age band", (
            Level(f"lt{fmt(lo)}", f"< {fmt(lo)} y", age < lo),
            Level(f"{fmt(lo)}to{fmt(hi)}", f"{fmt(lo)}–{fmt(hi)} y", (age >= lo) & (age <= hi)),
            Level(f"gt{fmt(hi)}", f"> {fmt(hi)} y", age > hi),
        )),
        Factor("diabetes", "Diabetes", (Level("no", "No diabetes", dm == 0), Level("yes", "Diabetes", dm == 1))),
    ]


# --------------------------------------------------------------------------- metrics


def point_metrics(y: np.ndarray, p: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    """Subgroup metrics; NaN when a metric is not estimable (e.g. sensitivity without positives)."""
    y = np.asarray(y, dtype=int)
    pred = np.asarray(pred, dtype=bool)
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    tp = int(np.sum(pred & (y == 1)))
    fp = int(np.sum(pred & (y == 0)))
    fn = n_pos - tp
    tn = n_neg - fp
    nan = float("nan")
    return {
        "roc_auc": fast_roc_auc(y, p) if n_pos and n_neg else nan,
        "sensitivity": tp / n_pos if n_pos else nan,
        "specificity": tn / n_neg if n_neg else nan,
        "ppv": tp / (tp + fp) if tp + fp else nan,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else nan,
        "brier": float(np.mean((p - y) ** 2)) if len(y) else nan,
        "calibration_in_the_large": float(np.mean(y) - np.mean(p)) if len(y) else nan,
    }


def _stratified_draws(y: np.ndarray, n: int, rng: np.random.Generator) -> np.ndarray:
    pos, neg = np.flatnonzero(y == 1), np.flatnonzero(y == 0)
    out = np.empty((n, len(y)), dtype=np.int64)
    for b in range(n):
        out[b, : len(pos)] = rng.choice(pos, size=len(pos), replace=True) if len(pos) else []
        out[b, len(pos):] = rng.choice(neg, size=len(neg), replace=True) if len(neg) else []
    return out


def bootstrap(
    y: np.ndarray, P: np.ndarray, PRED: np.ndarray, n_resamples: int, rng: np.random.Generator
) -> tuple[dict[str, float], dict[str, np.ndarray]]:
    """Point estimates and bootstrap samples of :func:`point_metrics` for one subgroup.

    ``P`` / ``PRED`` are ``(n_repeats, n)`` (one row for test predictions). Patients are resampled with their class
    counts fixed, and each resampled patient brings all of their repeats (cluster bootstrap).
    """
    reps = P.shape[0]

    def pooled(idx: np.ndarray) -> dict[str, float]:
        return point_metrics(np.tile(y[idx], reps), P[:, idx].ravel(), PRED[:, idx].ravel())

    point = pooled(np.arange(len(y)))
    samples = {k: np.empty(n_resamples) for k in METRICS}
    for b, idx in enumerate(_stratified_draws(y, n_resamples, rng)):
        m = pooled(idx)
        for k in METRICS:
            samples[k][b] = m[k]
    return point, samples


def _level_block(y: np.ndarray, point: dict[str, float], samples: dict[str, np.ndarray], mean_p: float,
                 small: dict[str, int], confidence: float) -> dict[str, Any]:
    n_pos = int(y.sum())
    n_neg = int(len(y)) - n_pos
    # A metric that conditions on a class is not reported when that class has fewer than MIN_CLASS patients.
    needs = {"roc_auc": min(n_pos, n_neg), "sensitivity": n_pos, "f1": n_pos, "specificity": n_neg}
    out: dict[str, Any] = {"n": int(len(y)), "n_pos": n_pos, "prevalence": round_float(n_pos / len(y)) if len(y) else None}
    for k in METRICS:
        v = point[k]
        estimable = np.isfinite(v) and needs.get(k, len(y)) >= MIN_CLASS
        out[k] = {"value": round_float(v), "ci": percentile_ci(samples[k], confidence)} if estimable else None
    out["mean_predicted"] = round_float(mean_p)
    out["small_n"] = bool(len(y) < small["min_n"] or min(n_pos, len(y) - n_pos) < small["min_class"])
    return out


# --------------------------------------------------------------------------- driver


Sources = dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]]


def _evaluate_level(
    mask: np.ndarray, sources: Sources, seed: tuple[int, ...], n_boot: int, small: dict[str, int], conf: float
) -> tuple[dict[str, Any], dict[str, dict[str, np.ndarray]]]:
    """Blocks and bootstrap draws of one subgroup for every prediction source (``oof``, ``test``).

    ``sources[name] = (row positions, P, PRED, y)``; each source gets its own seeded bootstrap stream.
    """
    blocks, draws = {}, {}
    for si, (name, (pos, P, PRED, y)) in enumerate(sources.items()):
        sel = mask[pos]
        rng = np.random.default_rng([*seed, si])
        point, samples = bootstrap(y[sel], P[:, sel], PRED[:, sel], n_boot, rng)
        mean_p = float(P[:, sel].mean()) if sel.any() else float("nan")
        blocks[name] = _level_block(y[sel], point, samples, mean_p, small, conf)
        draws[name] = samples
    return blocks, draws


def run_subgroups(ctx: AnalysisContext, oof: OOFPredictions, settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Per-target subgroup blocks and the protocol description."""
    n_boot = int(settings["n_bootstrap"])
    conf = float(settings["confidence"])
    small = dict(settings["small_n"])
    facs = factors(ctx.values, tuple(settings["age_bands"]))
    out: dict[str, Any] = {}
    for ti, t in enumerate(ctx.targets):
        y_all = ctx.y(t)
        tm = ctx.deployed[t]
        p_test = tm.predict_proba(ctx.X[ctx.test_pos])
        sources: Sources = {
            "oof": (ctx.dev_pos, oof.proba[t], oof.proba[t] >= oof.thresholds[t], y_all[ctx.dev_pos]),
            "test": (ctx.test_pos, p_test[None, :], (p_test >= tm.threshold)[None, :], y_all[ctx.test_pos]),
        }

        def evaluate(mask: np.ndarray, code: tuple[int, ...], _src: dict = sources, _ti: int = ti) -> tuple[dict, dict]:
            return _evaluate_level(mask, _src, (ctx.seed, _ti, *code), n_boot, small, conf)

        overall, _ = evaluate(np.ones(len(y_all), dtype=bool), (99,))
        fac_out: dict[str, Any] = {}
        for fi, fac in enumerate(facs):
            dev_sizes = [int(level.mask[ctx.dev_pos].sum()) for level in fac.levels]
            ref = fac.levels[int(np.argmax(dev_sizes))]
            evaluated = {lv.id: evaluate(lv.mask, (fi, li)) for li, lv in enumerate(fac.levels)}
            levels = []
            for lv in fac.levels:
                blocks, draws = evaluated[lv.id]
                row: dict[str, Any] = {"id": lv.id, "label": lv.label}
                for name in sources:
                    b = blocks[name]
                    if lv.id != ref.id:
                        ref_block, ref_draws = evaluated[ref.id][0][name], evaluated[ref.id][1][name]
                        if b["roc_auc"] is not None and ref_block["roc_auc"] is not None:
                            b["delta_roc_auc_vs_reference"] = {
                                "value": round_float(b["roc_auc"]["value"] - ref_block["roc_auc"]["value"]),
                                "ci": percentile_ci(draws[name]["roc_auc"] - ref_draws["roc_auc"], conf),
                            }
                        else:
                            b["delta_roc_auc_vs_reference"] = None
                    row[name] = b
                levels.append(row)
            fac_out[fac.id] = {"label": fac.label, "reference": ref.id, "levels": levels}
        out[t] = {"overall": overall, "factors": fac_out}
        log.info("subgroups %s done", t)

    lo, hi = settings["age_bands"]
    proto = {
        "method": (
            "Performance of the same predictions within subgroups. OOF = cross-fitted development-set predictions "
            f"({ctx.cfg['cv']['n_splits']}-fold x {oof.proba[ctx.targets[0]].shape[0]}, every choice re-made without the scored "
            "fold; repeats pooled, per-fold cross-fitted thresholds). Test = deployed model on the locked test set at "
            "the deployed threshold."
        ),
        "factors": {
            "sex": "recorded sex (Female / Male)",
            "age_band": f"age < {lo}, {lo}-{hi} (inclusive), > {hi} years",
            "diabetes": "DM = 0 / 1",
        },
        "ci": (
            f"{conf:.0%} percentile intervals from {n_boot} stratified bootstrap resamples of patients within the "
            "subgroup (OOF: cluster bootstrap - a resampled patient keeps all repeats)"
        ),
        "reference_level": "delta_roc_auc_vs_reference compares each level with the factor's largest development-set level",
        "not_estimable": (
            f"a class-conditional metric is null when its class has fewer than {MIN_CLASS} patients in the subgroup"
        ),
        "small_n": (
            f"small_n = fewer than {small['min_n']} patients or fewer than {small['min_class']} in either class; "
            "estimates are unstable and descriptive only"
        ),
        "cv_reproduced": {
            t: {
                "roc_auc": v["roc_auc"],
                "published_roc_auc": ctx.metrics["targets"][t]["cv"]["roc_auc"]["mean"] if ctx.metrics else None,
                "f1": v["f1"],
                "published_f1": ctx.metrics["targets"][t]["cv"]["f1"]["mean"] if ctx.metrics else None,
            }
            for t, v in oof.reproduced_cv.items()
        },
        "caveat": (
            "Exploratory and under-powered: no subgroup-specific threshold, recalibration or claim of (un)fairness is "
            "derived; sex and diabetes are also model inputs."
        ),
    }
    return out, proto

