"""Modality ablation: what each data modality adds to CAD / vessel-level prediction (development set only).

The 53 inputs come in seven clinical modalities (``features.yaml -> groups``): demographics, risk factors &
history, symptoms, physical examination, resting ECG, laboratory and transthoracic echo. Three families of
feature sets are cross-validated on **identical folds** (the leaderboard's repeated stratified 5-fold x 10), so
every comparison is paired fold by fold:

* ``cumulative``   - demographics -> +risk factors -> +symptoms -> +exam -> +ECG -> +labs -> +echo (the last is the
  full panel); ``delta_vs_previous`` is the gain of each added modality.
* ``leave_one_out`` - full panel without one modality; ``delta_vs_full`` < 0 means the modality carries
  information the others cannot replace.
* ``single``        - each modality on its own.

``instrumental`` contrasts the full panel with the *bedside* information (demographics, history, symptoms and
examination): the combined value of ECG + laboratory + echo - the multimodal question.

Model: the equal-weight margin ensemble of L2 logistic regression and XGBoost with the fixed hyper-parameters of
``training.yaml -> ablations`` (the protocol of the existing feature ablations), so feature sets are compared
under one model rather than each with its own tuning optimism. Uncertainty: Nadeau-Bengio corrected resampled t
intervals over the 50 folds (paired differences for deltas) and Holm adjustment within each family. The locked
test set is never used.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..evaluate import CVJob, CVResult, Fold, make_folds, run_cv_jobs
from ..metrics import fast_roc_auc, round_float
from .common import AnalysisContext
from .stats import corrected_t, holm

log = logging.getLogger(__name__)

BEDSIDE = ("demographics", "risk_factors", "symptoms", "exam")


@dataclass(frozen=True)
class ModalitySet:
    id: str
    family: str  # cumulative | leave_one_out | single
    group: str  # the modality added (cumulative), removed (leave_one_out) or used alone (single)
    groups: tuple[str, ...]
    columns: tuple[int, ...]


def group_order(ctx: AnalysisContext) -> list[dict[str, Any]]:
    return sorted(ctx.registry.groups, key=lambda g: g["order"])


def columns_by_group(ctx: AnalysisContext) -> dict[str, list[int]]:
    """Encoded column indices of every modality (one-hot columns follow their raw feature)."""
    group_of = {f.key: f.group for f in ctx.registry.features}
    out: dict[str, list[int]] = {g["id"]: [] for g in group_order(ctx)}
    for i, col in enumerate(ctx.encoder.encoded_columns):
        if col.source not in group_of:
            raise ValueError(f"column {col.name!r} has no modality (derived features are not part of the deployed model)")
        out[group_of[col.source]].append(i)
    return out


def modality_sets(order: list[str], cols: dict[str, list[int]]) -> list[ModalitySet]:
    """All cumulative, leave-one-out and single-modality feature sets (modalities without columns are skipped)."""
    order = [g for g in order if cols.get(g)]
    sets: list[ModalitySet] = []
    for k, g in enumerate(order):
        groups = tuple(order[: k + 1])
        sets.append(ModalitySet(f"cumulative:{g}", "cumulative", g, groups, tuple(sorted(i for h in groups for i in cols[h]))))
    for g in order:
        groups = tuple(h for h in order if h != g)
        sets.append(ModalitySet(f"leave_one_out:{g}", "leave_one_out", g, groups, tuple(sorted(i for h in groups for i in cols[h]))))
    for g in order:
        sets.append(ModalitySet(f"single:{g}", "single", g, (g,), tuple(cols[g])))
    return sets


def _fold_auc(lr: CVResult, xgb: CVResult, y: np.ndarray, folds: list[Fold]) -> dict[str, np.ndarray]:
    assert lr.margin is not None and xgb.margin is not None
    ens, a_lr, a_xgb = [], [], []
    for f in folds:
        m_lr, m_xgb = lr.margin[f.repeat, f.test], xgb.margin[f.repeat, f.test]
        ens.append(fast_roc_auc(y[f.test], 0.5 * m_lr + 0.5 * m_xgb))
        a_lr.append(fast_roc_auc(y[f.test], m_lr))
        a_xgb.append(fast_roc_auc(y[f.test], m_xgb))
    return {"ensemble": np.asarray(ens), "lr": np.asarray(a_lr), "xgb": np.asarray(a_xgb)}


def _auc_block(auc: np.ndarray, ratio: float, confidence: float) -> dict[str, Any]:
    ct = corrected_t(auc, ratio, confidence)
    return {"mean": ct["mean"], "sd": round_float(float(np.std(auc, ddof=1))), "se": ct["se"], "ci": ct["ci"], "n_folds": ct["n_folds"]}


def _delta_block(diff: np.ndarray, ratio: float, confidence: float) -> dict[str, Any]:
    ct = corrected_t(diff, ratio, confidence)
    return {
        "mean": ct["mean"], "se": ct["se"], "ci": ct["ci"], "p_value": ct["p_value"],
        "share_folds_improved": round_float(float(np.mean(diff > 0))),
    }


def run_modality_ablation(
    ctx: AnalysisContext, n_repeats: int, confidence: float = 0.95, n_jobs: int = 1
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Cross-validate every modality set per target; returns ``(per-target block, protocol)``."""
    cfg, seed = ctx.cfg, ctx.seed
    k = int(cfg["cv"]["n_splits"])
    ratio = 1.0 / (k - 1)  # n_test / n_train of one fold
    fixed_lr = dict(cfg["ablations"]["fixed_params"]["logistic"])
    fixed_xgb = dict(cfg["ablations"]["fixed_params"]["xgboost"])
    lr_spec, xgb_spec = ctx.specs["lr_l2"], ctx.specs[cfg["ensemble"]["tree_component"]]
    groups = group_order(ctx)
    labels = {g["id"]: g["label"] for g in groups}
    cols = columns_by_group(ctx)
    sets = modality_sets([g["id"] for g in groups], cols)
    unique = sorted({s.columns for s in sets}, key=lambda c: (len(c), c))
    key_of = {c: f"set{n}" for n, c in enumerate(unique)}

    X_dev = ctx.X[ctx.dev_pos]
    folds: dict[str, list[Fold]] = {}
    jobs: list[CVJob] = []
    for t in ctx.targets:
        y = ctx.y(t)[ctx.dev_pos]
        folds[t] = make_folds(y, k, n_repeats, seed)
        for c in unique:
            Xs = X_dev[:, list(c)]
            jobs.append(CVJob(f"{t}|{key_of[c]}|lr", lr_spec, t, Xs, y, folds[t], nested=False, overrides=fixed_lr))
            jobs.append(CVJob(f"{t}|{key_of[c]}|xgb", xgb_spec, t, Xs, y, folds[t], nested=False, overrides=fixed_xgb))
    log.info("modality ablation: %d feature sets x %d targets x %d folds", len(unique), len(ctx.targets), k * n_repeats)
    res = run_cv_jobs(jobs, seed, tuning={}, n_jobs=n_jobs)

    full_cols = [s for s in sets if s.family == "cumulative"][-1].columns
    bedside_cols = next((s.columns for s in sets if s.family == "cumulative" and s.groups == BEDSIDE), None)
    out: dict[str, Any] = {}
    for t in ctx.targets:
        y = ctx.y(t)[ctx.dev_pos]
        aucs = {c: _fold_auc(res[f"{t}|{key_of[c]}|lr"], res[f"{t}|{key_of[c]}|xgb"], y, folds[t]) for c in unique}
        full = aucs[full_cols]["ensemble"]

        def row(s: ModalitySet, _aucs: dict = aucs) -> dict[str, Any]:
            a = _aucs[s.columns]
            return {
                "id": s.id, "group": s.group, "label": labels[s.group], "groups": list(s.groups),
                "n_columns": len(s.columns),
                "roc_auc": _auc_block(a["ensemble"], ratio, confidence),
                "lr_roc_auc": round_float(float(a["lr"].mean())), "xgb_roc_auc": round_float(float(a["xgb"].mean())),
            }

        cumulative, prev = [], None
        for s in (s for s in sets if s.family == "cumulative"):
            r = row(s)
            r["step"] = len(s.groups)
            r["delta_vs_previous"] = None if prev is None else _delta_block(aucs[s.columns]["ensemble"] - aucs[prev]["ensemble"], ratio, confidence)
            cumulative.append(r)
            prev = s.columns
        adjusted = holm([r["delta_vs_previous"]["p_value"] for r in cumulative[1:]])
        for r, p in zip(cumulative[1:], adjusted, strict=True):
            r["delta_vs_previous"]["p_holm"] = p

        loo = []
        for s in (s for s in sets if s.family == "leave_one_out"):
            r = row(s)
            r["delta_vs_full"] = _delta_block(aucs[s.columns]["ensemble"] - full, ratio, confidence)
            loo.append(r)
        for r, p in zip(loo, holm([r["delta_vs_full"]["p_value"] for r in loo]), strict=True):
            r["delta_vs_full"]["p_holm"] = p

        single = [row(s) for s in sets if s.family == "single"]
        block: dict[str, Any] = {
            "full": {"n_columns": len(full_cols), "roc_auc": _auc_block(full, ratio, confidence)},
            "cumulative": cumulative,
            "leave_one_out": loo,
            "single": single,
        }
        if bedside_cols is not None:
            bedside = aucs[bedside_cols]["ensemble"]
            block["instrumental"] = {
                "description": "full panel vs bedside information only (demographics, history, symptoms, examination): "
                               "the combined value of ECG + laboratory + echo",
                "bedside_groups": list(BEDSIDE),
                "added_groups": [g for g in cols if g not in BEDSIDE and cols[g]],
                "bedside_roc_auc": _auc_block(bedside, ratio, confidence),
                "full_roc_auc": _auc_block(full, ratio, confidence),
                "delta": _delta_block(full - bedside, ratio, confidence),
            }
        out[t] = block

    features_by_group: dict[str, list[str]] = {g["id"]: [] for g in groups}
    for f in ctx.encoder.features:
        features_by_group[f.group].append(f.key)
    proto = {
        "method": (
            "Development-set repeated stratified cross-validation of cumulative (demographics -> +risk factors -> "
            "+symptoms -> +exam -> +ECG -> +labs -> +echo), leave-one-modality-out and single-modality feature sets "
            "on identical folds; score = per-fold ROC-AUC. The locked test set is not used."
        ),
        "model": (
            f"equal-weight log-odds ensemble of L2 logistic regression {fixed_lr} and XGBoost {fixed_xgb} "
            "(fixed hyper-parameters of training.yaml -> ablations, identical for every feature set)"
        ),
        "folds": f"repeated stratified {k}-fold x {n_repeats} per target (the leaderboard folds when n_repeats matches)",
        "n_folds": k * n_repeats,
        "confidence": confidence,
        "ci": (
            "Nadeau-Bengio corrected resampled t interval over folds (variance x (1/J + n_test/n_train)); deltas are "
            "paired per fold"
        ),
        "multiplicity": "Holm adjustment within each family per target (cumulative steps; leave-one-out)",
        "groups": [
            {"id": g["id"], "label": g["label"], "features": features_by_group[g["id"]], "n_columns": len(cols[g["id"]])}
            for g in groups
        ],
    }
    return out, proto
