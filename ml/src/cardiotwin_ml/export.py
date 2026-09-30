"""Artifact export: schema.json, model.json, cohort.json, fixtures.json, metrics.json(+ summary), joblib bundle.

All JSON is written deterministically (stable key order, no timestamps except ``metrics.generated_at``)
so a rerun of the pipeline produces byte-identical artifacts. Files are written to ``ml/artifacts`` and
mirrored to ``frontend/public/model`` (``docs/CONTRACTS.md`` §1).
"""

from __future__ import annotations

import json
import math
import shutil
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from . import MODEL_VERSION
from .config import FeatureRegistry, TargetRegistry
from .ensemble import TargetModel
from .preprocess import CKD_EPI_MIN_CREATININE, RATIO_MIN_DENOMINATOR, FeatureEncoder

SCHEMA_VERSION = "1.0.0"
PORTABLE_FORMAT = "cardiotwin-portable-model"
PORTABLE_FORMAT_VERSION = "1.0.0"
ARTIFACT_FILES = (
    "schema.json",
    "model.json",
    "metrics.json",
    "metrics_summary.json",
    "cohort.json",
    "fixtures.json",
    "cardiotwin_models.joblib",
)


# --------------------------------------------------------------------------- helpers


def to_jsonable(obj: Any) -> Any:
    if isinstance(obj, Mapping):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [to_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        if not math.isfinite(f):
            return None
        return f
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def write_json(path: Path, obj: Any, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = to_jsonable(obj)
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def feature_default(spec_type: str, series: pd.Series) -> Any:
    """Imputation default from the development set: median (numeric) or mode (binary/categorical)."""
    if spec_type == "numeric":
        return float(series.median())
    counts = series.value_counts()
    top = counts[counts == counts.max()].index
    value = sorted(top, key=str)[0]
    return int(value) if spec_type == "binary" else str(value)


def compute_defaults(encoder: FeatureEncoder, dev_values: pd.DataFrame) -> dict[str, Any]:
    return {f.key: feature_default(f.type, dev_values[f.key]) for f in encoder.features}


# --------------------------------------------------------------------------- schema.json


def build_schema(
    registry: FeatureRegistry,
    targets: TargetRegistry,
    encoder: FeatureEncoder,
    defaults: Mapping[str, Any],
    all_values: pd.DataFrame,
    models: Mapping[str, TargetModel],
    dropped: Sequence[str],
) -> dict[str, Any]:
    features = []
    for f in encoder.features:
        item: dict[str, Any] = {
            "key": f.key,
            "label": f.label,
            "group": f.group,
            "type": f.type,
            "unit": f.unit,
            "min": None,
            "max": None,
            "step": None,
            "default": defaults[f.key],
            "normal": {"low": f.normal.get("low"), "high": f.normal.get("high")},
            "description": f.description,
            "options": None,
        }
        if f.type == "numeric":
            col = all_values[f.key].astype(float)
            item["min"] = _clean_number(col.min())
            item["max"] = _clean_number(col.max())
            item["step"] = f.step if f.step is not None else 1
        elif f.type == "binary":
            item.update({"min": 0, "max": 1, "step": 1})
        else:
            item["options"] = [dict(o) for o in f.options or ()]
        features.append(item)
    return {
        "version": SCHEMA_VERSION,
        "model_version": MODEL_VERSION,
        "groups": [dict(g) for g in registry.groups],
        "features": features,
        "derived_features": [
            {"key": d.key, "label": d.label, "op": d.op, "inputs": list(d.inputs), "unit": d.unit, "description": d.description}
            for d in encoder.derived
        ],
        "dropped_features": list(dropped),
        "targets": [
            {
                "id": t.id,
                "label": t.label,
                "short": t.short,
                "kind": t.kind,
                "anatomy": list(t.anatomy),
                "territory": t.territory,
                "description": t.description,
                "threshold": models[t.id].threshold,
            }
            for t in targets.targets
        ],
        "risk_bands": [{"id": b["id"], "label": b.get("label", b["id"]), "max": b["max"]} for b in targets.risk_bands],
    }


def _clean_number(x: float) -> int | float:
    x = float(x)
    return int(x) if x.is_integer() else round(x, 4)


# --------------------------------------------------------------------------- model.json


def build_portable_model(
    encoder: FeatureEncoder,
    defaults: Mapping[str, Any],
    targets: TargetRegistry,
    models: Mapping[str, TargetModel],
) -> dict[str, Any]:
    enc = encoder.to_json()
    features = []
    for f in encoder.features:
        item: dict[str, Any] = {"key": f.key, "type": f.type, "default": defaults[f.key]}
        if f.type == "categorical":
            item["options"] = list(f.option_values)
            if f.raw_map:
                item["aliases"] = dict(f.raw_map)
        features.append(item)
    groups = encoder.attribution_groups()
    derived = {d.key: list(d.inputs) for d in encoder.derived}
    attribution = []
    for name, idx in groups.items():
        row: dict[str, Any] = {"feature": name, "columns": [encoder.columns[i] for i in idx], "column_indices": idx}
        if name in derived:
            row["derived_from"] = derived[name]
        attribution.append(row)
    out_models = {}
    for t in targets.ids:
        tm = models[t]
        lr, xg = tm.logistic, tm.xgb
        out_models[t] = {
            "components": [
                {
                    "type": "logistic",
                    "name": lr.name,
                    "weight": tm.weight,
                    "intercept": lr.intercept,
                    "coef": lr.coef.tolist(),
                    "scaler": {"mean": lr.mean.tolist(), "scale": lr.scale.tolist()},
                    "background_mean": lr.background.tolist(),
                    "base_value": lr.expected_value(),
                },
                {
                    "type": "xgboost",
                    "name": "xgboost",
                    "weight": 1.0 - tm.weight,
                    "objective": "binary:logistic",
                    "base_score": xg.base_score,
                    "n_trees": len(xg.nested),
                    "base_value": xg.expected_value(),
                    "trees": xg.nested,
                },
            ],
            "calibration": {"method": "platt", "a": tm.platt_a, "b": tm.platt_b},
            "threshold": tm.threshold,
            "threshold_f1": tm.threshold_f1,
            "base_value": tm.base_value(),
        }
    return {
        "format": PORTABLE_FORMAT,
        "format_version": PORTABLE_FORMAT_VERSION,
        "model_version": MODEL_VERSION,
        "margin_space": "log-odds",
        "targets": targets.ids,
        "vessel_targets": targets.vessel_ids,
        "features": features,
        "columns": enc["columns"],
        "encoding": enc["encoding"],
        "derived": enc["derived"],
        "constants": {"ratio_min_denominator": RATIO_MIN_DENOMINATOR, "ckd_epi_min_creatinine": CKD_EPI_MIN_CREATININE},
        "attribution": attribution,
        "risk_bands": [{"id": b["id"], "max": b["max"]} for b in targets.risk_bands],
        "models": out_models,
    }


# --------------------------------------------------------------------------- cohort.json


_RF_LABELS = (("DM", "DM"), ("HTN", "HTN"), ("DLP", "DLP"), ("Current Smoker", "smoker"), ("FH", "FH"))


def patient_summary(values: Mapping[str, Any]) -> str:
    """e.g. ``"62 y · Male · typical angina · DM, HTN"``."""
    age = int(round(float(values["Age"])))
    if int(values.get("Typical Chest Pain", 0)) == 1:
        pain = "typical angina"
    elif int(values.get("Atypical", 0)) == 1:
        pain = "atypical angina"
    elif int(values.get("Nonanginal", 0)) == 1:
        pain = "non-anginal pain"
    else:
        pain = "no chest pain"
    rfs = [label for key, label in _RF_LABELS if key in values and int(values[key]) == 1]
    return f"{age} y · {values['Sex']} · {pain} · {', '.join(rfs) if rfs else 'no major risk factors'}"


def patient_id(index: int) -> str:
    return f"P-{index + 1:03d}"


def api_record(values: Mapping[str, Any], encoder: FeatureEncoder) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in encoder.features:
        v = values[f.key]
        if f.type == "binary":
            out[f.key] = int(v)
        elif f.type == "numeric":
            fv = float(v)
            out[f.key] = int(fv) if fv.is_integer() else fv
        else:
            out[f.key] = str(v)
    return out


def build_cohort(
    values: pd.DataFrame,
    labels: pd.DataFrame,
    test_index: np.ndarray,
    dev_demo_index: np.ndarray,
    encoder: FeatureEncoder,
) -> dict[str, Any]:
    patients = []
    for split, idx in (("test", test_index), ("dev", dev_demo_index)):
        for i in sorted(int(v) for v in idx):
            rec = api_record(values.loc[i].to_dict(), encoder)
            lab = {t: int(labels.loc[i, t]) for t in labels.columns}
            patients.append(
                {
                    "id": patient_id(i),
                    "split": split,
                    "summary": patient_summary(rec),
                    "features": rec,
                    "labels": lab,
                }
            )
    return {
        "version": SCHEMA_VERSION,
        "note": (
            "Test patients were never used for training, tuning, calibration or threshold selection. "
            "Dev patients were part of model development and are included only as additional demo cases."
        ),
        "patients": patients,
    }


# --------------------------------------------------------------------------- bundle + mirror


def save_bundle(path: Path, bundle: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(dict(bundle), path, compress=3)


def mirror_to_frontend(artifacts_dir: Path, frontend_dir: Path) -> list[str]:
    """Mirror every artifact to the frontend (JSON for the edge engine; joblib as downloadable weights)."""
    frontend_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ARTIFACT_FILES:
        shutil.copyfile(artifacts_dir / name, frontend_dir / name)
        copied.append(name)
    return copied
