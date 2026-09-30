"""Command line entry point: ``python -m cardiotwin_ml.analysis``.

    ./.venv/Scripts/python -m cardiotwin_ml.analysis --jobs 8                  # everything (~25 min on 8 workers)
    ./.venv/Scripts/python -m cardiotwin_ml.analysis --only modality subgroups  # the fast analyses (~3 min)
    ./.venv/Scripts/python -m cardiotwin_ml.analysis --fast --out /tmp/x       # smoke run into another directory

Each analysis replaces only its own keys; keys of analyses that are not re-run are kept. By default the updated
``metrics.json`` and the new ``metrics_summary.json`` are written to ``ml/artifacts`` and mirrored to
``frontend/public/model``; figures go to ``docs/figures`` and ``ml/reports/results.md`` is regenerated.
Settings live in ``configs/training.yaml -> analysis``; every run is seeded and independent of ``--jobs``.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any

import joblib

from ..paths import ARTIFACTS_DIR, FIGURES_DIR, FRONTEND_MODEL_DIR, REPORTS_DIR
from .common import AnalysisContext, config_digest, fingerprint, load_context

log = logging.getLogger("cardiotwin_ml.analysis")

ANALYSES = ("robustness", "modality", "subgroups")
DEFAULT_JOBS = min(8, os.cpu_count() or 1)
DEFAULTS: dict[str, Any] = {
    "robustness": {"n_splits": 200, "test_size": 0.2, "split_seed_start": 1000, "hyperparameters": "search", "sensitivity": "frozen"},
    "modality": {"n_repeats": 10, "confidence": 0.95},
    "subgroups": {"age_bands": [50, 65], "small_n": {"min_n": 30, "min_class": 10}, "n_bootstrap": 2000, "confidence": 0.95},
}


def settings_from_config(cfg: dict[str, Any], fast: bool = False) -> dict[str, Any]:
    """``training.yaml -> analysis`` merged over the defaults; ``fast`` shrinks every analysis for smoke runs."""
    out = copy.deepcopy(DEFAULTS)
    for name, block in (cfg.get("analysis") or {}).items():
        out.setdefault(name, {}).update(block or {})
    if fast:
        out["robustness"].update(n_splits=3, hyperparameters="frozen", sensitivity=None)
        out["modality"].update(n_repeats=1)
        out["subgroups"].update(n_bootstrap=200, oof_repeats=1)
    return out


# --------------------------------------------------------------------------- cached computations


def _cached(cache_dir: Path | None, kind: str, key: dict[str, Any], compute: Any) -> Any:
    """Memoise an expensive, deterministic computation on disk (keyed by its inputs)."""
    if cache_dir is None:
        return compute()
    digest = hashlib.sha256(json.dumps(key, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:20]
    path = cache_dir / f"{kind}-{digest}.joblib"
    if path.exists():
        log.info("%s: loaded from cache %s", kind, path)
        return joblib.load(path)
    result = compute()
    cache_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(result, path, compress=3)
    return result


def _cache_key(ctx: AnalysisContext, artifacts_dir: Path, **settings: Any) -> dict[str, Any]:
    fp = fingerprint(artifacts_dir)
    return {"model": fp["model_json_sha256"], "data": fp["dataset_sha256"], "config": config_digest(ctx.cfg), **settings}


def compute_robustness(ctx: AnalysisContext, s: dict[str, Any], n_jobs: int, artifacts_dir: Path,
                       cache_dir: Path | None) -> tuple[dict[str, Any], dict[str, Any]]:
    from .robustness import protocol, run_robustness, summarise

    def run(mode: str) -> Any:
        key = _cache_key(ctx, artifacts_dir, n=s["n_splits"], test_size=s["test_size"], start=s["split_seed_start"], mode=mode)
        return _cached(
            cache_dir, f"robustness-{mode}", key,
            lambda: run_robustness(ctx, s["n_splits"], s["test_size"], s["split_seed_start"], mode, n_jobs),
        )

    primary = run(s["hyperparameters"])
    alt_mode = s.get("sensitivity")
    sensitivity = run(alt_mode) if alt_mode and alt_mode != s["hyperparameters"] else None
    for r in (primary, sensitivity):
        if r is not None and ctx.deployed and r.reproduction_max_abs_diff > 1e-9:
            raise RuntimeError(
                f"robustness harness ({r.hyperparameters}) does not reproduce the deployed model on the locked split "
                f"(max |dp| = {r.reproduction_max_abs_diff:.2e}); the frozen recipe drifted from train.py"
            )
    return summarise(primary, ctx, sensitivity), protocol(primary, s["test_size"], s["split_seed_start"], sensitivity)


def compute_modality(ctx: AnalysisContext, s: dict[str, Any], n_jobs: int) -> tuple[dict[str, Any], dict[str, Any]]:
    from .modality import run_modality_ablation

    return run_modality_ablation(ctx, s["n_repeats"], s["confidence"], n_jobs)


def compute_subgroups(ctx: AnalysisContext, s: dict[str, Any], n_jobs: int, artifacts_dir: Path,
                      cache_dir: Path | None) -> tuple[dict[str, Any], dict[str, Any]]:
    from .subgroups import cross_fitted_oof, run_subgroups

    repeats = s.get("oof_repeats") or ctx.cfg["cv"]["n_repeats"]
    key = _cache_key(ctx, artifacts_dir, analysis="cross_fitted_oof", repeats=repeats)
    oof = _cached(cache_dir, "subgroups-oof", key, lambda: cross_fitted_oof(ctx, n_jobs, repeats))
    for t, v in oof.reproduced_cv.items():
        if repeats != ctx.cfg["cv"]["n_repeats"]:
            break  # smoke run: fewer repeats cannot reproduce the published CV
        published = ctx.metrics["targets"][t]["cv"]
        if abs(v["roc_auc"] - published["roc_auc"]["mean"]) > 1e-6 or abs(v["f1"] - published["f1"]["mean"]) > 1e-6:
            raise RuntimeError(f"{t}: recomputed cross-fitted OOF predictions do not reproduce metrics.json cv ({v})")
    return run_subgroups(ctx, oof, s)


# --------------------------------------------------------------------------- driver


def run(
    only: list[str] | None = None,
    artifacts_dir: Path = ARTIFACTS_DIR,
    out_dir: Path | None = None,
    frontend_dir: Path | None = FRONTEND_MODEL_DIR,
    figures_dir: Path | None = FIGURES_DIR,
    reports_dir: Path | None = REPORTS_DIR,
    n_jobs: int = DEFAULT_JOBS,
    fast: bool = False,
    cache_dir: Path | None = None,
    overrides: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run the selected analyses and publish them; returns the updated metrics dict."""
    from .summary import build_metrics_summary, merge_analysis, read_metrics, write_metrics

    t0 = time.perf_counter()
    selected = list(only or ANALYSES)
    out_dir = out_dir or artifacts_dir
    ctx = load_context(artifacts_dir, with_baseline="robustness" in selected)
    settings = settings_from_config(ctx.cfg, fast)
    for name, block in (overrides or {}).items():
        settings[name].update({k: v for k, v in block.items() if v is not None})

    blocks: dict[str, Any] = {}
    protocols: dict[str, Any] = {}
    if "robustness" in selected:
        blocks["robustness"], protocols["robustness"] = compute_robustness(ctx, settings["robustness"], n_jobs, artifacts_dir, cache_dir)
        log.info("stage done: robustness (%.0f s)", time.perf_counter() - t0)
    if "modality" in selected:
        blocks["modality_ablation"], protocols["modality_ablation"] = compute_modality(ctx, settings["modality"], n_jobs)
        log.info("stage done: modality ablation (%.0f s)", time.perf_counter() - t0)
    if "subgroups" in selected:
        blocks["subgroups"], protocols["subgroups"] = compute_subgroups(ctx, settings["subgroups"], n_jobs, artifacts_dir, cache_dir)
        log.info("stage done: subgroups (%.0f s)", time.perf_counter() - t0)

    metrics, original = read_metrics(artifacts_dir / "metrics.json")
    merged = merge_analysis(metrics, blocks, protocols, fingerprint(artifacts_dir), fast)
    write_metrics(out_dir / "metrics.json", merged, original)
    schema = json.loads((artifacts_dir / "schema.json").read_text(encoding="utf-8"))
    from ..export import write_json

    write_json(out_dir / "metrics_summary.json", build_metrics_summary(merged, schema), compact=True)
    if frontend_dir is not None:
        frontend_dir.mkdir(parents=True, exist_ok=True)
        for name in ("metrics.json", "metrics_summary.json"):
            shutil.copyfile(out_dir / name, frontend_dir / name)
    if figures_dir is not None or reports_dir is not None:
        from .. import report

        if figures_dir is not None:
            report.make_analysis_figures(merged, figures_dir)
        if reports_dir is not None:
            report.write_results_md(merged, reports_dir / "results.md")
    log.info("analysis finished in %.0f s -> %s", time.perf_counter() - t0, out_dir)
    return merged


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="+", choices=ANALYSES, help="run only these analyses (default: all)")
    parser.add_argument("--jobs", type=int, default=DEFAULT_JOBS, help=f"parallel workers (default {DEFAULT_JOBS}; keep <= 8)")
    parser.add_argument("--splits", type=int, default=None, help="Monte-Carlo splits (default: training.yaml)")
    parser.add_argument("--hyperparameters", choices=("search", "frozen"), default=None, help="robustness mode override")
    parser.add_argument("--fast", action="store_true", help="smoke run (3 frozen splits, 1 CV repeat, 200 bootstraps); needs --out")
    parser.add_argument("--out", type=Path, default=None, help="write metrics.json/metrics_summary.json here (no mirror, figures or report)")
    parser.add_argument("--no-figures", action="store_true", help="skip docs/figures and results.md")
    parser.add_argument("--no-mirror", action="store_true", help="do not copy to frontend/public/model")
    parser.add_argument("--cache", type=Path, default=None, help="memoise the expensive runs in this directory")
    args = parser.parse_args(argv)
    if args.fast and args.out is None:
        parser.error("--fast results must not replace the published analyses; pass --out DIR")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    custom = args.out is not None
    if custom and args.out.resolve() != ARTIFACTS_DIR.resolve():
        args.out.mkdir(parents=True, exist_ok=True)
    run(
        only=args.only,
        out_dir=args.out,
        frontend_dir=None if (custom or args.no_mirror) else FRONTEND_MODEL_DIR,
        figures_dir=None if (custom or args.no_figures) else FIGURES_DIR,
        reports_dir=None if (custom or args.no_figures) else REPORTS_DIR,
        n_jobs=args.jobs,
        fast=args.fast,
        cache_dir=args.cache,
        overrides={"robustness": {"n_splits": args.splits, "hyperparameters": args.hyperparameters}},
    )
