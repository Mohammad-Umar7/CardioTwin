"""Shared context for the validation analyses: the cohort, the locked split and the deployed (frozen) recipe.

Everything here is *read* from the published artifacts and configuration; nothing is refitted on the
locked test set and nothing is written back to the deployed model. The context is a plain, picklable
dataclass so it can be shipped to joblib workers.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from .. import data
from ..config import FeatureRegistry, load_feature_registry, load_target_registry, load_training_config
from ..ensemble import TargetModel
from ..evaluate import fit_estimator
from ..models import STEP, ModelSpec, model_specs
from ..paths import ARTIFACTS_DIR, CONFIG_DIR
from ..preprocess import FeatureEncoder, assert_no_leakage, check_leakage_config, extract_labels, normalise_frame
from ..splits import holdout_split

BUNDLE_NAME = "cardiotwin_models.joblib"
CONFIG_FILES = ("training.yaml", "features.yaml", "targets.yaml")


@dataclass(frozen=True)
class FrozenTarget:
    """The deployed recipe of one target: model families, logistic variant and exact hyper-parameters.

    ``*_params`` hold only the searched hyper-parameters (the keys of the model's search space) at full float
    precision, taken from the fitted estimators in the joblib bundle (``metrics.json`` rounds them to 6 s.f.).
    """

    target: str
    logistic: str
    logistic_params: dict[str, Any]
    xgboost_params: dict[str, Any]
    baseline_params: dict[str, Any]


@dataclass
class AnalysisContext:
    """Everything an analysis needs; picklable (no fitted models except the deployed ones in ``deployed``)."""

    cfg: dict[str, Any]
    seed: int
    targets: list[str]
    registry: FeatureRegistry
    values: pd.DataFrame  # API-normalised features of all patients (row order = X)
    labels: pd.DataFrame  # 0/1 label per target (row order = X)
    strata: np.ndarray  # joint label pattern after rare-pattern merging (hold-out stratification)
    dev_pos: np.ndarray  # row positions of the locked development set (sorted)
    test_pos: np.ndarray  # row positions of the locked test set (sorted)
    encoder: FeatureEncoder
    X: np.ndarray  # encoded model matrix of all patients
    specs: dict[str, ModelSpec]
    frozen: dict[str, FrozenTarget]
    metrics: dict[str, Any]  # the published metrics.json (read-only reference values)
    deployed: dict[str, TargetModel] = field(default_factory=dict, repr=False)

    @property
    def columns(self) -> list[str]:
        return self.encoder.columns

    def y(self, target: str) -> np.ndarray:
        return self.labels[target].to_numpy(dtype=int)

    def light(self) -> AnalysisContext:
        """Copy without the deployed models and the metrics dict (cheaper to send to worker processes)."""
        return AnalysisContext(
            self.cfg, self.seed, self.targets, self.registry, self.values, self.labels, self.strata, self.dev_pos,
            self.test_pos, self.encoder, self.X, self.specs, self.frozen, {}, {},
        )


def _searched(estimator: Any, spec: ModelSpec) -> dict[str, Any]:
    params = estimator.get_params()
    return {k: params[k] for k in spec.search}


def final_tuning_settings(cfg: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """The deployed final-tuning procedure (``train.py``): search settings and inner repeats."""
    return (
        {"inner_splits": cfg["final_tuning"]["inner_splits"], "scoring": cfg["tuning"]["scoring"]},
        int(cfg["final_tuning"]["inner_repeats"]),
    )


def tune(spec: ModelSpec, X: np.ndarray, y: np.ndarray, cfg: dict[str, Any], seed: int, columns: list[str]) -> dict[str, Any]:
    """Run the deployed final hyper-parameter search on ``(X, y)``; return the exact winning searched params."""
    settings, inner_repeats = final_tuning_settings(cfg)
    pipe, _ = fit_estimator(spec, X, y, seed, settings, seed + 7, inner_repeats=inner_repeats, columns=columns)
    return _searched(pipe.named_steps[STEP], spec)


def load_context(artifacts_dir: Path = ARTIFACTS_DIR, with_baseline: bool = True) -> AnalysisContext:
    """Rebuild the cohort and locked split and read the frozen recipe from the published artifacts.

    ``with_baseline`` re-runs the (cheap, deterministic) final tuning of the clinical baseline on the locked
    development set to recover its exact hyper-parameters; they are only needed by the robustness analysis.
    """
    cfg = load_training_config()
    seed = int(cfg["seed"])
    registry = load_feature_registry()
    target_reg = load_target_registry()
    check_leakage_config(target_reg)
    raw = data.load_raw(data.ensure_dataset(allow_download=False))
    values = normalise_frame(raw, registry).reset_index(drop=True)
    labels = extract_labels(raw, target_reg).reset_index(drop=True)
    split = holdout_split(labels, cfg["holdout"]["test_size"], seed, cfg["holdout"]["min_stratum_count"])
    dev_pos = np.sort(labels.index.get_indexer(split.dev_index))
    test_pos = np.sort(labels.index.get_indexer(split.test_index))

    bundle = joblib.load(artifacts_dir / BUNDLE_NAME)
    encoder: FeatureEncoder = bundle["encoder"]
    assert_no_leakage(encoder.columns)
    X = encoder.transform(values)
    metrics = json.loads((artifacts_dir / "metrics.json").read_text(encoding="utf-8"))
    if metrics["dataset"]["n_dev"] != len(dev_pos) or metrics["dataset"]["n_test"] != len(test_pos):
        raise RuntimeError("the rebuilt locked split does not match metrics.json; rerun python -m cardiotwin_ml.train")

    specs = model_specs(cfg)
    tree = cfg["ensemble"]["tree_component"]
    bl_name = cfg["baseline"]["model"]
    frozen: dict[str, FrozenTarget] = {}
    models: dict[str, TargetModel] = bundle["models"]
    for t in target_reg.ids:
        tm = models[t]
        lr_name = tm.logistic.name
        lr_params = _searched(tm.logistic.pipeline.named_steps[STEP], specs[lr_name])
        xgb_params = _searched(tm.xgb.model, specs[tree])
        if lr_name == bl_name:
            bl_params = dict(lr_params)
        elif with_baseline:
            y_dev = labels[t].to_numpy(dtype=int)[dev_pos]
            bl_params = tune(specs[bl_name], X[dev_pos], y_dev, cfg, seed, encoder.columns)
        else:
            bl_params = {}
        frozen[t] = FrozenTarget(t, lr_name, lr_params, xgb_params, bl_params)
    return AnalysisContext(
        cfg=cfg,
        seed=seed,
        targets=list(target_reg.ids),
        registry=registry,
        values=values,
        labels=labels,
        strata=split.strata.to_numpy(),
        dev_pos=dev_pos,
        test_pos=test_pos,
        encoder=encoder,
        X=X,
        specs=specs,
        frozen=frozen,
        metrics=metrics,
        deployed=models,
    )


# --------------------------------------------------------------------------- provenance


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def fingerprint(artifacts_dir: Path = ARTIFACTS_DIR, config_dir: Path = CONFIG_DIR) -> dict[str, str]:
    """Digests of everything the analyses depend on (deployed model, dataset, configuration).

    ``train.py`` keeps the analysis keys of an existing ``metrics.json`` only when this fingerprint is unchanged,
    so a retrained model can never be published next to analyses of its predecessor.
    """
    out = {"model_json_sha256": sha256_file(artifacts_dir / "model.json"), "dataset_sha256": data.XLSX_SHA256}
    for name in CONFIG_FILES:
        out[f"{name.replace('.', '_')}_sha256"] = sha256_file(config_dir / name)
    return out
