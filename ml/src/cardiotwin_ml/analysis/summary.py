"""Publishing: additive merge into ``metrics.json`` and the compact ``metrics_summary.json``.

``metrics.json`` is ~1.5 MB (curves, beeswarms, leaderboards, analyses). The landing page only needs headline
numbers, so :func:`build_metrics_summary` extracts them (test + CV metrics with CIs per target, robustness and
modality headlines) into a compact file of ~20 kB (subgroups stay in ``metrics.json``). The summary is derived purely from ``metrics.json``; it never contains
a number that is not also in ``metrics.json``.

The merge is strictly additive: existing keys are copied unchanged (and a round-trip check proves their
serialisation is byte-identical); only ``robustness``, ``modality_ablation``, ``subgroups`` and ``analysis`` are
added or replaced.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from ..export import to_jsonable
from . import ANALYSIS_KEYS
from .common import fingerprint

log = logging.getLogger(__name__)

SUMMARY_FORMAT = "cardiotwin-metrics-summary"
SUMMARY_FORMAT_VERSION = "1.0.0"
ANALYSIS_VERSION = "1.0.0"
RESULT_KEYS = ("robustness", "modality_ablation", "subgroups")
TEST_METRICS = ("roc_auc", "pr_auc", "f1", "precision", "recall", "specificity", "accuracy", "balanced_accuracy", "mcc", "brier")
CV_METRICS = ("roc_auc", "pr_auc", "f1", "recall", "specificity", "accuracy", "brier")


# --------------------------------------------------------------------------- metrics.json


def serialise(obj: Any) -> str:
    """Exactly the text ``export.write_json`` produces (indent 2, UTF-8, trailing newline)."""
    return json.dumps(to_jsonable(obj), ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def read_metrics(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    return json.loads(text), text


def merge_analysis(
    metrics: dict[str, Any],
    blocks: dict[str, Any],
    protocols: dict[str, Any],
    fp: dict[str, str],
    fast: bool = False,
) -> dict[str, Any]:
    """New metrics dict: existing keys unchanged, analysis keys added/replaced at the end (in canonical order).

    Results of analyses that are not re-run are kept only if they were computed for the same fingerprint.
    """
    out = {k: v for k, v in metrics.items() if k not in ANALYSIS_KEYS}
    old_meta = metrics.get("analysis") or {}
    same_inputs = old_meta.get("fingerprint") == fp
    meta: dict[str, Any] = {
        "version": ANALYSIS_VERSION,
        "command": "python -m cardiotwin_ml.analysis",
        "fingerprint": fp,
        "note": (
            "Descriptive validation analyses; nothing in the deployed model (model.json, thresholds, calibration) "
            "depends on them."
        ),
    }
    for key in RESULT_KEYS:
        if key in blocks:
            out[key] = blocks[key]
            meta[key] = {**protocols.get(key, {}), "fast_mode": bool(fast)}
        elif key in metrics and same_inputs:
            out[key] = metrics[key]
            meta[key] = old_meta.get(key, {})
        elif key in metrics:
            log.warning("dropping stale %s (computed for different model/data/config)", key)
    out["analysis"] = meta
    return out


def write_metrics(path: Path, merged: dict[str, Any], original_text: str) -> None:
    """Write ``merged``; refuse if any pre-existing key would change or re-serialise differently."""
    original = json.loads(original_text)
    if serialise(original) != original_text:
        raise RuntimeError("metrics.json does not round-trip byte-identically; refusing to rewrite it")
    for k, v in original.items():
        if k not in ANALYSIS_KEYS and merged.get(k) != v:
            raise RuntimeError(f"metrics.json key {k!r} would change; analyses may only add keys")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(serialise(merged), encoding="utf-8", newline="\n")


def carry_over(previous_path: Path, metrics: dict[str, Any], artifacts_dir: Path) -> dict[str, Any]:
    """Used by ``train.py``: keep the analysis keys of the previous ``metrics.json`` if the inputs are unchanged.

    A deterministic re-run reproduces ``model.json`` byte for byte, so its analyses stay valid; any change of the
    model, data or configuration drops them (with a warning to re-run ``python -m cardiotwin_ml.analysis``).
    """
    if not previous_path.exists():
        return metrics
    try:
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return metrics
    meta = previous.get("analysis")
    if not meta:
        return metrics
    if meta.get("fingerprint") != fingerprint(artifacts_dir):
        log.warning("model/data/config changed: previous validation analyses dropped; rerun python -m cardiotwin_ml.analysis")
        return metrics
    out = dict(metrics)
    for key in ANALYSIS_KEYS:
        if key in previous:
            out[key] = previous[key]
    return out


# --------------------------------------------------------------------------- metrics_summary.json


def _pick(d: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: d[k] for k in keys if k in d}


def _robustness_summary(r: dict[str, Any]) -> dict[str, Any]:
    dist = ("mean", "sd", "p05", "p50", "p95", "fixed_split", "fixed_split_percentile")
    out = {"n_splits": r["n_splits"], "fixed_split_percentile": r["fixed_split_percentile"]}
    for k in ("roc_auc", "f1", "brier", "calibration_slope"):
        if k in r:
            out[k] = _pick(r[k], dist)
    if "delta_roc_auc_vs_baseline" in r:
        d = r["delta_roc_auc_vs_baseline"]
        out["delta_roc_auc_vs_baseline"] = _pick(d, ("mean", "p05", "p50", "p95", "share_positive"))
    return out


def _modality_summary(m: dict[str, Any]) -> dict[str, Any]:
    def auc(block: dict[str, Any]) -> dict[str, Any]:
        return {"mean": block["mean"], "ci": block["ci"]}

    out: dict[str, Any] = {
        "full_roc_auc": auc(m["full"]["roc_auc"]),
        "cumulative": [
            {"group": r["group"], "label": r["label"], "roc_auc": auc(r["roc_auc"]),
             "delta": None if r["delta_vs_previous"] is None else _pick(r["delta_vs_previous"], ("mean", "ci", "p_holm"))}
            for r in m["cumulative"]
        ],
        "unique_contribution": [
            {"group": r["group"], "label": r["label"], "delta_if_removed": _pick(r["delta_vs_full"], ("mean", "ci", "p_holm"))}
            for r in m["leave_one_out"]
        ],
    }
    if "instrumental" in m:
        i = m["instrumental"]
        out["instrumental"] = {
            "bedside_roc_auc": auc(i["bedside_roc_auc"]),
            "full_roc_auc": auc(i["full_roc_auc"]),
            "delta": _pick(i["delta"], ("mean", "ci", "p_value", "share_folds_improved")),
            "added_groups": i["added_groups"],
        }
    return out


def ordinal(x: float) -> str:
    """``3.0 -> '3rd'``, ``1.5 -> '2nd'``, ``84 -> '84th'`` (rounded half to even like ``round``)."""
    n = int(round(x))
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _headline(metrics: dict[str, Any], labels: dict[str, str]) -> dict[str, Any]:
    targets = list(metrics["targets"])
    out: dict[str, Any] = {}
    rob = metrics.get("robustness")
    if rob:
        n = rob[targets[0]]["n_splits"]
        parts = [
            f"{t} median {rob[t]['roc_auc']['p50']:.2f} (middle 90% of splits {rob[t]['roc_auc']['p05']:.2f}–"
            f"{rob[t]['roc_auc']['p95']:.2f}; locked split at the {ordinal(rob[t]['fixed_split_percentile'])} percentile)"
            for t in targets
        ]
        out["robustness"] = {
            "text": f"Across {n} random stratified 80/20 re-splits, held-out ROC-AUC: " + "; ".join(parts) + ".",
            "n_splits": n,
            "median_roc_auc": {t: rob[t]["roc_auc"]["p50"] for t in targets},
            "fixed_split_percentile": {t: rob[t]["fixed_split_percentile"] for t in targets},
        }
    mod = metrics.get("modality_ablation")
    if mod and all("instrumental" in mod[t] for t in targets):
        parts = []
        for t in targets:
            d = mod[t]["instrumental"]["delta"]
            parts.append(f"{t} {d['mean']:+.3f} (95% CI {d['ci'][0]:+.3f} to {d['ci'][1]:+.3f})")
        top = {}
        for t in targets:
            worst = min(mod[t]["leave_one_out"], key=lambda r: r["delta_vs_full"]["mean"])
            top[t] = {"group": worst["group"], "label": worst["label"], "delta_if_removed": worst["delta_vs_full"]["mean"]}
        out["modality"] = {
            "text": "Adding ECG, laboratory and echocardiography to bedside data changes development-CV ROC-AUC by "
                    + "; ".join(parts) + ".",
            "instrumental_delta": {t: mod[t]["instrumental"]["delta"]["mean"] for t in targets},
            "most_informative_modality": top,
        }
    out["labels"] = labels
    return out


def build_metrics_summary(metrics: dict[str, Any], schema: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compact landing-page view of ``metrics.json`` (see ``ml/README.md -> metrics_summary.json``)."""
    labels = {t["id"]: t["label"] for t in (schema or {}).get("targets", [])}
    ds = metrics["dataset"]
    proto = metrics["protocol"]
    summary: dict[str, Any] = {
        "format": SUMMARY_FORMAT,
        "format_version": SUMMARY_FORMAT_VERSION,
        "model_version": metrics["model_version"],
        "source": "metrics.json",
        "metrics_generated_at": metrics.get("generated_at"),
        "dataset": {
            "name": ds["name"],
            "n": ds["n"],
            "n_dev": ds["n_dev"],
            "n_test": ds["n_test"],
            "prevalence": ds["prevalence"],
        },
        "protocol": {
            "test": f"locked test set of {ds['n_test']} patients, 95% CIs from {proto['n_bootstrap']} stratified bootstrap resamples",
            "cv": f"development set, repeated stratified {proto['cv_splits']}-fold x {proto['cv_repeats']}, cross-fitted "
                  "ensemble (mean ± sd over folds)",
        },
        "targets": {},
    }
    for t, tr in metrics["targets"].items():
        entry: dict[str, Any] = {
            "label": labels.get(t, t),
            "threshold": tr["threshold"],
            "test": _pick(tr["test"], TEST_METRICS),
            "cv": _pick(tr["cv"], CV_METRICS),
            "calibration": _pick(tr["calibration_summary"], ("calibration_slope", "calibration_in_the_large", "ece")),
            "baseline": {
                "features": tr["baseline"]["features"],
                "test_roc_auc": tr["baseline"]["test"]["roc_auc"],
                "delta_roc_auc": tr["baseline"]["delta_roc_auc_test"],
            },
        }
        if metrics.get("robustness", {}).get(t):
            entry["robustness"] = _robustness_summary(metrics["robustness"][t])
        if metrics.get("modality_ablation", {}).get(t):
            entry["modality"] = _modality_summary(metrics["modality_ablation"][t])
        summary["targets"][t] = entry
    summary["headline"] = _headline(metrics, {t: labels.get(t, t) for t in metrics["targets"]})
    return summary
