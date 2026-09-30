"""Evidence-driven extras, each tested against the plain feature set on the development set.

Variants (all with identical folds and fixed hyper-parameters, so differences are paired):

* ``derived``   - clinically motivated derived features from ``features.yaml`` (NLR, TG/HDL, risk-factor
  count, CKD-EPI eGFR) appended to the raw columns.
* ``selection`` - in-fold univariate feature selection (ANOVA F, top-k) before both components.
* ``chain``     - vessel targets only: the CAD model's probability as an extra input (classifier chain;
  training rows receive inner out-of-fold CAD probabilities, so no label leaks).

Each variant is scored by the ROC-AUC of an equal-weight margin ensemble of logistic regression and
XGBoost on every outer fold and compared fold-by-fold with the baseline. A variant is adopted only if its
mean gain over the affected targets reaches ``ablations.min_gain``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from .evaluate import CVJob, CVResult, Fold, run_chain_cv, run_cv_jobs
from .metrics import fast_roc_auc
from .models import ModelSpec

log = logging.getLogger(__name__)


@dataclass
class VariantScore:
    variant: str
    target: str
    fold_auc: np.ndarray  # equal-weight ensemble, per outer fold
    lr_auc: float
    xgb_auc: float


def _ensemble_fold_auc(lr: CVResult, xgb: CVResult, y: np.ndarray, folds: list[Fold]) -> np.ndarray:
    assert lr.margin is not None and xgb.margin is not None
    out = []
    for f in folds:
        m = 0.5 * lr.margin[f.repeat, f.test] + 0.5 * xgb.margin[f.repeat, f.test]
        out.append(fast_roc_auc(y[f.test], m))
    return np.asarray(out)


def _mean_fold_auc(res: CVResult) -> float:
    return float(np.mean([m["roc_auc"] for m in res.fold_metrics]))


def run_ablations(
    X_base: np.ndarray,
    X_derived: np.ndarray,
    labels: dict[str, np.ndarray],
    folds: dict[str, list[Fold]],
    lr_spec: ModelSpec,
    xgb_spec: ModelSpec,
    cfg: dict[str, Any],
    seed: int,
    chain_source: str = "CAD",
) -> dict[str, Any]:
    """Run every variant and return a JSON-ready report with adoption decisions."""
    fixed_lr = dict(cfg["fixed_params"]["logistic"])
    fixed_xgb = dict(cfg["fixed_params"]["xgboost"])
    k = int(cfg["selection_k"])
    targets = list(labels)
    jobs: list[CVJob] = []
    for t in targets:
        y = labels[t]
        for variant, X, sel in (("baseline", X_base, None), ("derived", X_derived, None), ("selection", X_base, k)):
            jobs.append(CVJob(f"{variant}|{t}|lr", lr_spec, t, X, y, folds[t], nested=False, overrides=fixed_lr, select_k=sel))
            jobs.append(CVJob(f"{variant}|{t}|xgb", xgb_spec, t, X, y, folds[t], nested=False, overrides=fixed_xgb, select_k=sel))
    results = run_cv_jobs(jobs, seed, tuning={}, n_jobs=-1)

    scores: dict[str, dict[str, VariantScore]] = {}
    for t in targets:
        y = labels[t]
        for variant in ("baseline", "derived", "selection"):
            lr, xgb = results[f"{variant}|{t}|lr"], results[f"{variant}|{t}|xgb"]
            scores.setdefault(variant, {})[t] = VariantScore(
                variant, t, _ensemble_fold_auc(lr, xgb, y, folds[t]), _mean_fold_auc(lr), _mean_fold_auc(xgb)
            )
    # Classifier chain for the vessel targets.
    y_src = labels[chain_source]
    for t in targets:
        if t == chain_source:
            continue
        y = labels[t]
        lr = run_chain_cv(lr_spec, lr_spec, t, X_base, y_src, y, folds[t], seed, fixed_lr, fixed_lr)
        xgb = run_chain_cv(lr_spec, xgb_spec, t, X_base, y_src, y, folds[t], seed, fixed_lr, fixed_xgb)
        scores.setdefault("chain", {})[t] = VariantScore(
            "chain", t, _ensemble_fold_auc(lr, xgb, y, folds[t]), _mean_fold_auc(lr), _mean_fold_auc(xgb)
        )

    report: dict[str, Any] = {
        "protocol": (
            f"Paired comparison on identical repeated stratified folds; fixed hyper-parameters "
            f"(logistic {fixed_lr}, XGBoost {fixed_xgb}); score = per-fold ROC-AUC of an equal-weight "
            f"LR+XGB margin ensemble; adopt if mean gain over affected targets >= {cfg['min_gain']}."
        ),
        "baseline": {
            t: {
                "ensemble_auc": round(float(scores["baseline"][t].fold_auc.mean()), 4),
                "lr_auc": round(scores["baseline"][t].lr_auc, 4),
                "xgb_auc": round(scores["baseline"][t].xgb_auc, 4),
            }
            for t in targets
        },
        "min_gain": float(cfg["min_gain"]),
        "n_repeats": int(cfg["n_repeats"]),
        "variants": {},
    }
    for variant in ("derived", "selection", "chain"):
        per_target = {}
        gains = []
        for t, s in scores[variant].items():
            base = scores["baseline"][t]
            diff = s.fold_auc - base.fold_auc
            gains.append(float(diff.mean()))
            per_target[t] = {
                "ensemble_auc": round(float(s.fold_auc.mean()), 4),
                "delta_auc_mean": round(float(diff.mean()), 4),
                "delta_auc_sd": round(float(diff.std(ddof=1)), 4),
                "folds_improved": round(float(np.mean(diff > 0)), 3),
                "lr_auc": round(s.lr_auc, 4),
                "xgb_auc": round(s.xgb_auc, 4),
            }
        mean_gain = float(np.mean(gains))
        adopted = mean_gain >= float(cfg["min_gain"])
        report["variants"][variant] = {
            "targets": per_target,
            "mean_delta_auc": round(mean_gain, 4),
            "adopted": adopted,
        }
        log.info("ablation %-9s mean dAUC=%+.4f adopted=%s", variant, mean_gain, adopted)
    return report
