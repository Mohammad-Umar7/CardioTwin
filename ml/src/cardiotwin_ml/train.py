"""One-command, deterministic CardioTwin pipeline.

    ./.venv/Scripts/python -m cardiotwin_ml.train            # full run (~2-10 min on a laptop CPU)
    ./.venv/Scripts/python -m cardiotwin_ml.train --fast     # smoke run (reduced CV / search / bootstrap)

Stages: data -> locked hold-out split -> ablations (dev) -> nested-CV leaderboard (dev) -> ensemble
weighting, Platt calibration and threshold on out-of-fold margins (dev) -> final refit on dev ->
**single** evaluation on the locked test set -> SHAP explanations -> artifacts -> figures + report.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import logging
import platform
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import sklearn
import xgboost
from joblib import Parallel, delayed
from sklearn.model_selection import train_test_split

from . import MODEL_VERSION, data, explain, export
from .ablation import run_ablations
from .config import load_feature_registry, load_target_registry, load_training_config
from .ensemble import (
    LogisticComponent,
    TargetModel,
    XGBComponent,
    choose_thresholds,
    choose_weight,
    sigmoid,
)
from .evaluate import CVJob, fit_estimator, make_folds, run_cv_jobs
from .inference import CardioTwinPredictor
from .metrics import (
    METRIC_NAMES,
    binary_metrics,
    bootstrap_metrics,
    calibration_points,
    confusion,
    decision_curve,
    expected_calibration_error,
    fast_roc_auc,
    pr_points,
    roc_band,
    roc_points,
    round_float,
    stratified_bootstrap_indices,
    summarise_folds,
    youden_threshold,
)
from .models import STEP, clean_params, model_specs
from .paths import ARTIFACTS_DIR, FIGURES_DIR, FRONTEND_MODEL_DIR, REPORTS_DIR
from .preprocess import (
    FeatureEncoder,
    assert_no_leakage,
    check_leakage_config,
    extract_labels,
    find_constant_columns,
    normalise_frame,
)
from .splits import holdout_split, joint_patterns

log = logging.getLogger("cardiotwin_ml.train")

FAST_MODELS = ("dummy_prior", "lr_l2", "lr_l1", "lr_core", "xgboost")


def fast_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Reduced settings for smoke tests (same code paths, far fewer fits)."""
    cfg = copy.deepcopy(cfg)
    cfg["cv"]["n_repeats"] = 2
    cfg["final_tuning"]["inner_repeats"] = 1
    cfg["bootstrap"]["n_resamples"] = 200
    cfg["ablations"]["n_repeats"] = 1
    cfg["models"] = {k: v for k, v in cfg["models"].items() if k in FAST_MODELS}
    for m in cfg["models"].values():
        if "n_iter" in m:
            m["n_iter"] = 3
    cfg["ensemble"]["logistic_candidates"] = ["lr_l2", "lr_l1", "lr_core"]
    return cfg


# --------------------------------------------------------------------------- helpers


def _metric_block(fold_metrics: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    return summarise_folds(fold_metrics)


def _leaderboard_row(name: str, label: str, tuned: bool, summary: dict[str, dict[str, float]]) -> dict[str, Any]:
    return {
        "model": name,
        "label": label,
        "tuned": tuned,
        "roc_auc_mean": summary["roc_auc"]["mean"],
        "roc_auc_std": summary["roc_auc"]["std"],
        "pr_auc_mean": summary["pr_auc"]["mean"],
        "f1_mean": summary["f1"]["mean"],
        "f1_std": summary["f1"]["std"],
        "accuracy_mean": summary["accuracy"]["mean"],
        "balanced_accuracy_mean": summary["balanced_accuracy"]["mean"],
        "brier_mean": summary["brier"]["mean"],
        "log_loss_mean": summary["log_loss"]["mean"],
    }


def _calibration_summary(y: np.ndarray, p: np.ndarray, n_bins: int) -> dict[str, float]:
    """ECE, calibration-in-the-large and logistic calibration slope/intercept (Cox 1958)."""
    from .ensemble import fit_platt

    lp = np.log(np.clip(p, 1e-12, 1 - 1e-12) / np.clip(1 - p, 1e-12, 1))
    slope, intercept = fit_platt(lp, y)
    return {
        "ece": round_float(expected_calibration_error(y, p, n_bins)),
        "calibration_in_the_large": round_float(float(np.mean(y) - np.mean(p))),
        "calibration_slope": round_float(slope),
        "calibration_intercept": round_float(intercept),
    }


def _paired_delta_auc(y: np.ndarray, p_a: np.ndarray, p_b: np.ndarray, n: int, seed: int) -> dict[str, Any]:
    idx = stratified_bootstrap_indices(y, n, seed + 17)
    deltas = np.array([fast_roc_auc(y[i], p_a[i]) - fast_roc_auc(y[i], p_b[i]) for i in idx])
    point = fast_roc_auc(y, p_a) - fast_roc_auc(y, p_b)
    lo, hi = np.quantile(deltas, [0.025, 0.975])
    return {
        "value": round_float(point),
        "ci": [round_float(lo), round_float(hi)],
        "p_value_one_sided": round_float(float(np.mean(deltas <= 0))),
    }


def _final_fit_task(spec, X, y, seed, final_tuning, inner_seed, inner_repeats, columns):  # noqa: ANN001, ANN202
    return fit_estimator(spec, X, y, seed, final_tuning, inner_seed, inner_repeats=inner_repeats, columns=columns)


# --------------------------------------------------------------------------- pipeline


def run(
    fast: bool = False,
    artifacts_dir: Path = ARTIFACTS_DIR,
    figures_dir: Path | None = FIGURES_DIR,
    reports_dir: Path | None = REPORTS_DIR,
    frontend_dir: Path | None = FRONTEND_MODEL_DIR,
    n_jobs: int = -1,
    dev_only: bool = False,
) -> dict[str, Any]:
    """Run the pipeline. ``dev_only`` stops before the final refit and never touches the test set."""
    t_start = time.perf_counter()
    cfg = load_training_config()
    if fast:
        cfg = fast_config(cfg)
    seed = int(cfg["seed"])
    registry = load_feature_registry()
    targets = load_target_registry()
    check_leakage_config(targets)
    target_ids = targets.ids

    # ---------------------------------------------------------------- data + split
    xlsx = data.ensure_dataset()
    raw = data.load_raw(xlsx)
    values = normalise_frame(raw, registry)
    labels = extract_labels(raw, targets)
    split = holdout_split(labels, cfg["holdout"]["test_size"], seed, cfg["holdout"]["min_stratum_count"])
    dev_idx, test_idx = split.dev_index, split.test_index
    dev_values, test_values = values.loc[dev_idx], values.loc[test_idx]
    constant = find_constant_columns(dev_values)
    for c in constant:
        log.info("dropping constant column %r (single value in the development set)", c)
    used = [f for f in registry.features if f.key not in constant]
    base_encoder = FeatureEncoder(used)
    derived_encoder = base_encoder.with_derived(registry.derived)
    y_dev = {t: labels.loc[dev_idx, t].to_numpy() for t in target_ids}
    y_test = {t: labels.loc[test_idx, t].to_numpy() for t in target_ids}
    folds = {t: make_folds(y_dev[t], cfg["cv"]["n_splits"], cfg["cv"]["n_repeats"], seed) for t in target_ids}
    specs = model_specs(cfg)
    log.info("dev n=%d, test n=%d, encoded columns=%d", len(dev_idx), len(test_idx), len(base_encoder.columns))

    # ---------------------------------------------------------------- ablations (dev only)
    abl_cfg = cfg["ablations"]
    abl_folds = {t: make_folds(y_dev[t], cfg["cv"]["n_splits"], abl_cfg["n_repeats"], seed) for t in target_ids}
    ablations = run_ablations(
        base_encoder.transform(dev_values),
        derived_encoder.transform(dev_values),
        y_dev,
        abl_folds,
        specs["lr_l2"],
        specs[cfg["ensemble"]["tree_component"]],
        abl_cfg,
        seed,
    )
    adopted = {k: v["adopted"] for k, v in ablations["variants"].items()}
    if adopted.get("selection") or adopted.get("chain"):
        raise RuntimeError(
            "An ablation variant that changes the deployed model topology (selection/chain) was adopted. "
            "The portable model format v1 encodes feature-level derivations only; extend export.py and "
            "portable.py before deploying it."
        )
    encoder = derived_encoder if adopted.get("derived") else base_encoder
    assert_no_leakage(encoder.columns)
    X_dev = encoder.transform(dev_values)
    X_test = encoder.transform(test_values)

    log.info("stage done: ablations (%.1f s elapsed)", time.perf_counter() - t_start)
    # ---------------------------------------------------------------- nested-CV leaderboard (dev only)
    bl_name = cfg["baseline"]["model"]
    bl_spec = specs[bl_name]
    columns = encoder.columns
    jobs = [CVJob(f"{m}|{t}", specs[m], t, X_dev, y_dev[t], folds[t], columns=columns) for t in target_ids for m in specs]
    log.info("running %d CV jobs x %d folds", len(jobs), len(folds[target_ids[0]]))
    cv = run_cv_jobs(jobs, seed, cfg["tuning"], n_jobs)

    log.info("stage done: nested-CV leaderboard (%.1f s elapsed)", time.perf_counter() - t_start)
    # ---------------------------------------------------------------- ensemble on OOF margins (dev only)
    ens_cfg = cfg["ensemble"]
    tree_name = ens_cfg["tree_component"]
    per_target: dict[str, dict[str, Any]] = {}
    for t in target_ids:
        y = y_dev[t]
        cands = ens_cfg["logistic_candidates"]
        cand_auc = {c: cv[f"{c}|{t}"].summary()["roc_auc"]["mean"] for c in cands}
        lr_name = max(cands, key=lambda c: (cand_auc[c], -cands.index(c)))
        m_lr, m_xgb = cv[f"{lr_name}|{t}"].margin, cv[f"{tree_name}|{t}"].margin
        assert m_lr is not None and m_xgb is not None
        fit = choose_weight(m_lr, m_xgb, y, ens_cfg["weight_grid_step"])
        oof_margin = fit.weight * m_lr + (1 - fit.weight) * m_xgb
        oof_p = np.asarray(sigmoid(fit.platt_a * oof_margin + fit.platt_b))
        thr = choose_thresholds(y, oof_p)
        fold_at_thr = [binary_metrics(y[f.test], oof_p[f.repeat, f.test], thr.youden) for f in folds[t]]
        fold_at_half = [binary_metrics(y[f.test], oof_p[f.repeat, f.test], 0.5) for f in folds[t]]
        leaderboard = [
            _leaderboard_row(m, specs[m].label, specs[m].tuned, cv[f"{m}|{t}"].summary()) for m in specs
        ]
        leaderboard.append(
            _leaderboard_row(
                "ensemble", f"LR ({lr_name}) + XGBoost margin ensemble, Platt-calibrated", True, _metric_block(fold_at_half)
            )
        )
        leaderboard.sort(key=lambda r: (-r["roc_auc_mean"], r["model"]))
        per_target[t] = {
            "lr_name": lr_name,
            "candidate_auc": cand_auc,
            "fit": fit,
            "thresholds": thr,
            "oof_p": oof_p,
            "cv": _metric_block(fold_at_thr),
            "leaderboard": leaderboard,
        }
        log.info(
            "%s: logistic=%s w=%.2f platt=(%.3f, %.3f) youden=%.3f OOF AUC=%.3f",
            t, lr_name, fit.weight, fit.platt_a, fit.platt_b, thr.youden, fit.oof_auc,
        )

    if dev_only:
        summary = {
            "fast_mode": fast,
            "ablations": ablations,
            "targets": {
                t: {
                    "logistic": per_target[t]["lr_name"],
                    "weight_lr": per_target[t]["fit"].weight,
                    "oof_auc_pooled": per_target[t]["fit"].oof_auc,
                    "cv": per_target[t]["cv"],
                    "leaderboard": per_target[t]["leaderboard"],
                    "baseline_cv_auc": cv[f"{bl_name}|{t}"].summary()["roc_auc"],
                }
                for t in target_ids
            },
        }
        export.write_json(artifacts_dir / "dev_summary.json", summary)
        log.info("dev-only run: test set untouched; summary written to %s", artifacts_dir / "dev_summary.json")
        return summary
    # ---------------------------------------------------------------- final refit on the full dev set
    final_tuning = {"inner_splits": cfg["final_tuning"]["inner_splits"], "scoring": cfg["tuning"]["scoring"]}
    inner_repeats = int(cfg["final_tuning"]["inner_repeats"])
    fit_keys = []
    tasks = []
    for t in target_ids:
        for comp in dict.fromkeys((per_target[t]["lr_name"], tree_name, bl_name)):
            fit_keys.append((t, comp))
            tasks.append(
                delayed(_final_fit_task)(specs[comp], X_dev, y_dev[t], seed, final_tuning, seed + 7, inner_repeats, columns)
            )
    fitted = dict(zip(fit_keys, Parallel(n_jobs=n_jobs, backend="loky", batch_size=1)(tasks), strict=True))

    models: dict[str, TargetModel] = {}
    for t in target_ids:
        info = per_target[t]
        lr_pipe, lr_params = fitted[(t, info["lr_name"])]
        xgb_pipe, xgb_params = fitted[(t, tree_name)]
        lr_comp = LogisticComponent.from_pipeline(info["lr_name"], lr_pipe, X_dev, clean_params(lr_params))
        xgb_comp = XGBComponent.from_model(xgb_pipe.named_steps[STEP], encoder.columns, clean_params(xgb_params))
        # Closed-form logistic margin must equal the fitted pipeline's decision function.
        assert np.allclose(lr_comp.margin(X_dev), lr_pipe.decision_function(X_dev), atol=1e-9)
        fit = info["fit"]
        models[t] = TargetModel(
            target=t,
            columns=encoder.columns,
            logistic=lr_comp,
            xgb=xgb_comp,
            weight=fit.weight,
            platt_a=fit.platt_a,
            platt_b=fit.platt_b,
            threshold=info["thresholds"].youden,
            threshold_f1=info["thresholds"].f1,
        )

    log.info("stage done: final refit (%.1f s elapsed)", time.perf_counter() - t_start)
    # ---------------------------------------------------------------- the ONE evaluation on the test set
    boot = cfg["bootstrap"]
    curves_cfg = cfg["curves"]
    target_reports: dict[str, Any] = {}
    for k, t in enumerate(target_ids):
        tm = models[t]
        info = per_target[t]
        yt = y_test[t]
        p_test = tm.predict_proba(X_test)
        bl_pipe, bl_params = fitted[(t, bl_name)]
        p_bl_test = bl_pipe.predict_proba(X_test)[:, 1]
        bl_cv = cv[f"{bl_name}|{t}"]
        bl_thr = youden_threshold(np.tile(y_dev[t], bl_cv.n_repeats), bl_cv.proba.ravel())
        bl_fold = [binary_metrics(y_dev[t][f.test], bl_cv.proba[f.repeat, f.test], bl_thr) for f in folds[t]]
        s = seed + 101 * (k + 1)
        target_reports[t] = {
            "selected_model": f"LR ({info['lr_name']}) + XGBoost margin ensemble (Platt-calibrated)",
            "components": {
                "logistic": {"name": info["lr_name"], "params": tm.logistic.params, "weight": round_float(tm.weight)},
                "xgboost": {"params": tm.xgb.params, "n_trees": len(tm.xgb.trees), "weight": round_float(1 - tm.weight)},
                "platt": {"a": round_float(tm.platt_a), "b": round_float(tm.platt_b)},
                "logistic_candidates_cv_auc": {c: round_float(v) for c, v in info["candidate_auc"].items()},
                "weight_grid": info["fit"].grid,
            },
            "cv": info["cv"],
            "cv_oof": {
                "roc_auc_pooled": round_float(info["fit"].oof_auc),
                "log_loss_pooled": round_float(info["fit"].oof_log_loss),
            },
            "test": bootstrap_metrics(yt, p_test, tm.threshold, boot["n_resamples"], s, boot["confidence"]),
            "threshold": round_float(tm.threshold),
            "threshold_rule": "youden_j_on_oof",
            "threshold_f1": round_float(tm.threshold_f1),
            "test_at_threshold_f1": bootstrap_metrics(yt, p_test, tm.threshold_f1, boot["n_resamples"], s, boot["confidence"]),
            "confusion_matrix": confusion(yt, p_test, tm.threshold),
            "confusion_matrix_f1": confusion(yt, p_test, tm.threshold_f1),
            "calibration_summary": _calibration_summary(yt, p_test, curves_cfg["calibration_bins"]),
            "curves": {
                "roc": roc_points(yt, p_test),
                "roc_band": roc_band(yt, p_test, boot["n_resamples"], s, curves_cfg["roc_band_points"], boot["confidence"]),
                "pr": pr_points(yt, p_test),
                "calibration": calibration_points(yt, p_test, curves_cfg["calibration_bins"]),
                "dca": decision_curve(yt, p_test, curves_cfg["dca_start"], curves_cfg["dca_stop"], curves_cfg["dca_step"]),
            },
            "leaderboard": info["leaderboard"],
            "baseline": {
                "model": bl_name,
                "features": list(bl_spec.features or ()),
                "params": clean_params(bl_params),
                "threshold": round_float(bl_thr),
                "cv": _metric_block(bl_fold),
                "test": bootstrap_metrics(yt, p_bl_test, bl_thr, boot["n_resamples"], s, boot["confidence"]),
                "curves": {"roc": roc_points(yt, p_bl_test)},
                "delta_roc_auc_test": _paired_delta_auc(yt, p_test, p_bl_test, boot["n_resamples"], s),
            },
            "_p_test": p_test,
        }

    log.info("stage done: test evaluation (%.1f s elapsed)", time.perf_counter() - t_start)
    # ---------------------------------------------------------------- explanations
    dev_records = dev_values.to_dict(orient="records")
    num_view, _ = explain.numeric_view(encoder, dev_records)
    checks: dict[str, Any] = {}
    for t in target_ids:
        agg, _, base, names = explain.explain_rows(models[t], encoder, X_dev)
        target_reports[t]["global_importance"] = explain.global_importance(agg, names)
        target_reports[t]["beeswarm"] = explain.beeswarm(agg, num_view, names, cfg["explain"]["beeswarm_top"])
        target_reports[t]["base_value"] = round_float(base, 10)
        cross = explain.shap_library_crosscheck(models[t], X_dev)
        _, m_test, _, _ = explain.explain_rows(models[t], encoder, X_test)
        cross["ensemble_additivity_max_error"] = float(
            np.max(np.abs(models[t].base_value() + models[t].shap(X_test).sum(axis=1) - m_test))
        )
        checks[t] = {k: (round_float(v, 3) if isinstance(v, float) else v) for k, v in cross.items()}

    log.info("stage done: explanations (%.1f s elapsed)", time.perf_counter() - t_start)
    # ---------------------------------------------------------------- artifacts
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    defaults = export.compute_defaults(encoder, dev_values)
    schema = export.build_schema(registry, targets, encoder, defaults, values, models, constant)
    portable = export.build_portable_model(encoder, defaults, targets, models)
    bundle = {
        "version": MODEL_VERSION,
        "encoder": encoder,
        "models": models,
        "targets": target_ids,
        "vessel_targets": targets.vessel_ids,
        "defaults": defaults,
        "risk_bands": [dict(b) for b in targets.risk_bands],
        "columns": encoder.columns,
        "library_versions": {"scikit-learn": sklearn.__version__, "xgboost": xgboost.__version__, "numpy": np.__version__},
    }
    export.write_json(artifacts_dir / "schema.json", schema)
    export.write_json(artifacts_dir / "model.json", portable, compact=True)
    export.save_bundle(artifacts_dir / "cardiotwin_models.joblib", bundle)

    demo_strata = split.strata.loc[dev_idx].to_numpy()
    dev_demo, _ = train_test_split(dev_idx, train_size=20, random_state=seed, stratify=demo_strata)
    cohort = export.build_cohort(values, labels, test_idx, np.asarray(dev_demo), encoder)
    export.write_json(artifacts_dir / "cohort.json", cohort)

    predictor = CardioTwinPredictor(bundle, artifacts_dir)
    from .fixtures import build_fixtures  # noqa: PLC0415 - avoids an import cycle at module load

    fixtures = build_fixtures(predictor, cohort, schema, portable, n_test_cases=20)
    export.write_json(artifacts_dir / "fixtures.json", fixtures)

    # The online predictor (scalar path) must reproduce the vectorised test-set evaluation exactly.
    api = [predictor.predict(pt["features"])["predictions"] for pt in cohort["patients"] if pt["split"] == "test"]
    for t in target_ids:
        assert np.allclose([r[t]["probability"] for r in api], target_reports[t].pop("_p_test"), atol=1e-12)

    patterns = joint_patterns(labels)
    co = labels.T.dot(labels)
    metrics = {
        "version": "1.0.0",
        "model_version": MODEL_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "fast_mode": fast,
        "dataset": {
            "name": "Extension of Z-Alizadeh Sani",
            "source": data.UCI_PAGE,
            "doi": data.UCI_DOI,
            "sha256": data.XLSX_SHA256,
            "n": int(len(values)),
            "n_dev": int(len(dev_idx)),
            "n_test": int(len(test_idx)),
            "n_features_raw": len(registry.features),
            "n_features_used": len(encoder.features),
            "n_columns_encoded": len(encoder.columns),
            "dropped_constant": constant,
            "feature_groups": {f.key: f.group for f in encoder.features} | {d.key: "derived" for d in encoder.derived},
            "prevalence": {t: round_float(labels[t].mean(), 4) for t in target_ids},
            "prevalence_dev": {t: round_float(y_dev[t].mean(), 4) for t in target_ids},
            "prevalence_test": {t: round_float(y_test[t].mean(), 4) for t in target_ids},
            "split": split.describe(),
            "label_patterns": {str(k): int(v) for k, v in patterns.value_counts().sort_index().items()},
            "label_cooccurrence": {"targets": target_ids, "counts": co.loc[target_ids, target_ids].astype(int).values.tolist()},
        },
        "protocol": _protocol(cfg, fast),
        "ablations": ablations,
        "explainability_checks": checks,
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit-learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
        },
        "targets": target_reports,
    }
    export.write_json(artifacts_dir / "metrics.json", metrics)

    if figures_dir is not None or reports_dir is not None:
        from . import report  # noqa: PLC0415 - matplotlib only needed here

        if figures_dir is not None:
            report.make_figures(metrics, figures_dir)
        if reports_dir is not None:
            report.write_results_md(metrics, reports_dir / "results.md")
    if frontend_dir is not None:
        export.mirror_to_frontend(artifacts_dir, frontend_dir)
    log.info("pipeline finished in %.1f s", time.perf_counter() - t_start)
    return metrics


def _protocol(cfg: dict[str, Any], fast: bool) -> dict[str, Any]:
    cv, tun, fin, boot = cfg["cv"], cfg["tuning"], cfg["final_tuning"], cfg["bootstrap"]
    tuned = [m for m, v in cfg["models"].items() if v.get("search")]
    return {
        "seed": cfg["seed"],
        "cv_splits": cv["n_splits"],
        "cv_repeats": cv["n_repeats"],
        "n_bootstrap": boot["n_resamples"],
        "holdout": (
            f"Locked {cfg['holdout']['test_size']:.0%} test set (seed {cfg['seed']}), stratified on the joint "
            f"CAD/LAD/LCX/RCA label pattern; patterns with < {cfg['holdout']['min_stratum_count']} patients merged into "
            "the nearest frequent pattern (Hamming distance). The test set is evaluated exactly once, after every "
            "modelling decision (features, models, hyper-parameters, weights, calibration, thresholds) was frozen on "
            "the development set. Only the deployed ensemble and the pre-specified clinical baseline are scored on it."
        ),
        "cv": (
            f"Development set: repeated stratified {cv['n_splits']}-fold x {cv['n_repeats']} cross-validation per target "
            f"({cv['n_splits'] * cv['n_repeats']} outer folds), identical folds for all models (paired comparisons). "
            "Imputation and scaling are fitted inside each training fold (scikit-learn pipelines)."
        ),
        "tuning": (
            f"Nested CV for {', '.join(tuned)}: RandomizedSearchCV (fixed seed, {tun['scoring']}) over an inner "
            f"stratified {tun['inner_splits']}-fold split inside every outer training fold. Final component "
            f"hyper-parameters searched on the whole development set with repeated stratified {fin['inner_splits']}-fold "
            f"x {fin['inner_repeats']}; untuned models use literature defaults from training.yaml."
        ),
        "ensemble": (
            "m = w*m_LR + (1-w)*m_XGB in log-odds space; the logistic variant (L2/L1/elastic net) with the best nested-CV "
            f"ROC-AUC is used; w chosen on a {cfg['ensemble']['weight_grid_step']} grid by pooled out-of-fold log-loss "
            "after Platt calibration."
        ),
        "calibration": "Platt scaling p = sigmoid(a*m + b) fitted by maximum likelihood on pooled out-of-fold ensemble margins.",
        "threshold": (
            "Decision threshold = Youden's J maximiser on pooled out-of-fold calibrated probabilities "
            "(F1-optimal threshold also reported). Leaderboard F1/accuracy use a fixed 0.5 threshold for comparability."
        ),
        "final_model": "Components refitted on the full development set; the deployed models never saw the test set.",
        "bootstrap": (
            f"Test-set 95% CIs: {boot['n_resamples']} stratified bootstrap resamples (percentile method), "
            "threshold held fixed at its development-set value."
        ),
        "baseline": (
            f"Pre-specified clinical baseline: {cfg['baseline']['model']} on "
            f"{', '.join(cfg['models'][cfg['baseline']['model']]['features'])} "
            "(nested-CV tuned, Youden threshold on OOF), to quantify what the full clinical/ECG/lab/echo panel adds."
        ),
        "explainability": (
            "Exact SHAP in the ensemble's log-odds space: linear SHAP (w.r.t. the dev mean) for the logistic component, "
            "float64 path-dependent TreeSHAP (node cover) for XGBoost, combined linearly; additivity asserted to 1e-6."
        ),
        "fast_mode": fast,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fast", action="store_true", help="reduced CV/search/bootstrap smoke run")
    parser.add_argument("--out", type=Path, default=None, help="artifact directory (default ml/artifacts)")
    parser.add_argument("--no-figures", action="store_true", help="skip figures and results.md")
    parser.add_argument("--no-mirror", action="store_true", help="do not copy artifacts to frontend/public/model")
    parser.add_argument("--jobs", type=int, default=-1, help="parallel workers (default: all cores)")
    parser.add_argument(
        "--dev-only", action="store_true", help="development-set CV only (writes dev_summary.json; never touches the test set)"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    custom_out = args.out is not None
    run(
        fast=args.fast,
        artifacts_dir=args.out or ARTIFACTS_DIR,
        figures_dir=None if (args.no_figures or custom_out) else FIGURES_DIR,
        reports_dir=None if (args.no_figures or custom_out) else REPORTS_DIR,
        frontend_dir=None if (args.no_mirror or custom_out) else FRONTEND_MODEL_DIR,
        n_jobs=args.jobs,
        dev_only=args.dev_only,
    )


if __name__ == "__main__":
    main()
