"""Cross-engine parity fixtures (``fixtures.json``).

Each case is ``{id, description, features, encoded, expected}`` where ``features`` is exactly what a client
would POST (sometimes partial, sometimes using ``"Y"``/``true``/alias spellings), ``encoded`` is the model
input vector (for debugging a port) and ``expected`` is the native server response (§3.2). The browser
engine must reproduce ``expected`` to ``tolerance``.

Cases cover real held-out test patients, imputation of every feature, schema minima/maxima, every
categorical level, input-spelling variants, out-of-range values, and values placed exactly on XGBoost
split thresholds (the float32 comparison edge case).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from . import MODEL_VERSION
from .inference import CardioTwinPredictor

TOLERANCE = {"probability": 1e-6, "logit": 1e-6, "base_value": 1e-6, "shap": 1e-5}


def _thresholds_by_column(portable: Mapping[str, Any]) -> dict[int, list[float]]:
    """All distinct split conditions per encoded column across every target's XGBoost trees."""
    found: dict[int, set[float]] = {}
    for target in portable["targets"]:
        for comp in portable["models"][target]["components"]:
            if comp["type"] != "xgboost":
                continue
            stack = list(comp["trees"])
            while stack:
                node = stack.pop()
                if "leaf" in node:
                    continue
                found.setdefault(node["split_index"], set()).add(node["split_condition"])
                stack.extend(node["children"])
    return {k: sorted(v) for k, v in found.items()}


def _synthetic_cases(schema: Mapping[str, Any], portable: Mapping[str, Any]) -> list[dict[str, Any]]:
    feats = schema["features"]
    numeric = [f for f in feats if f["type"] == "numeric"]
    binary = [f for f in feats if f["type"] == "binary"]
    categorical = [f for f in feats if f["type"] == "categorical"]
    cases: list[dict[str, Any]] = []

    cases.append({"id": "all-defaults", "description": "Empty request: every feature imputed with its default", "features": {}})
    lo = {f["key"]: f["min"] for f in numeric} | {f["key"]: 0 for f in binary}
    lo |= {f["key"]: f["options"][0]["value"] for f in categorical}
    hi = {f["key"]: f["max"] for f in numeric} | {f["key"]: 1 for f in binary}
    hi |= {f["key"]: f["options"][-1]["value"] for f in categorical}
    cases.append({"id": "schema-minima", "description": "Numeric at schema min, binaries 0, first category", "features": lo})
    cases.append({"id": "schema-maxima", "description": "Numeric at schema max, binaries 1, last category", "features": hi})
    for f in categorical:
        for opt in f["options"]:
            cases.append(
                {
                    "id": f"category-{f['key']}-{opt['value']}".replace(" ", "_"),
                    "description": f"Only {f['key']} = {opt['value']} (everything else imputed)",
                    "features": {f["key"]: opt["value"]},
                }
            )
    cases.append(
        {
            "id": "input-spellings",
            "description": "Binary as 'Y'/'N'/true/'yes', categorical aliases and case ('fmale', 'lbbb', 'MODERATE')",
            "features": {
                "DM": "Y",
                "HTN": True,
                "Obesity": "N",
                "Typical Chest Pain": "yes",
                "Current Smoker": False,
                "Sex": "fmale",
                "BBB": "lbbb",
                "VHD": "MODERATE",
                "Age": "67",
            },
        }
    )
    cases.append(
        {
            "id": "out-of-range",
            "description": "Values outside the training range (trees extrapolate flat, logistic linearly)",
            "features": {"Age": 95, "FBS": 450, "TG": 1500, "LDL": 260, "HDL": 12, "EF-TTE": 10, "BP": 210, "CR": 3.5, "ESR": 120},
        }
    )
    cases.append(
        {
            "id": "partial-input",
            "description": "Three features only",
            "features": {"Age": 70, "Typical Chest Pain": 1, "DM": 1},
        }
    )
    cases.append(
        {
            "id": "high-risk-archetype",
            "description": "Older diabetic hypertensive man with typical angina, ischaemic ECG and reduced EF",
            "features": {
                "Age": 72, "Sex": "Male", "DM": 1, "HTN": 1, "DLP": 1, "Current Smoker": 1, "Typical Chest Pain": 1,
                "St Depression": 1, "Tinversion": 1, "Q Wave": 1, "Region RWMA": 3, "EF-TTE": 35, "FBS": 180,
            },
        }
    )
    cases.append(
        {
            "id": "low-risk-archetype",
            "description": "Young woman without chest pain or risk factors, normal ECG and echo",
            "features": {
                "Age": 36, "Sex": "Female", "DM": 0, "HTN": 0, "DLP": 0, "Typical Chest Pain": 0, "Atypical": 0,
                "Nonanginal": 1, "Region RWMA": 0, "EF-TTE": 60, "FBS": 85, "BMI": 22.5, "Obesity": 0,
            },
        }
    )
    # Values exactly on XGBoost split thresholds: x == split_condition must go to "no" (strict <).
    cols = portable["columns"]
    thr = _thresholds_by_column(portable)
    numeric_keys = {f["key"] for f in numeric}
    on_split: dict[str, float] = {}
    near_split: dict[str, float] = {}
    for idx, values in thr.items():
        key = cols[idx]
        if key in numeric_keys and values:
            mid = values[len(values) // 2]
            on_split[key] = mid
            near_split[key] = round(mid, 2)  # decimal close to a float32 boundary -> exercises fround
    if on_split:
        cases.append(
            {
                "id": "exactly-on-split-thresholds",
                "description": "Numeric features set exactly to float32 XGBoost split conditions",
                "features": on_split,
            }
        )
        cases.append(
            {
                "id": "near-split-thresholds",
                "description": "Numeric features set to 2-decimal roundings of split conditions",
                "features": near_split,
            }
        )
    return cases


def build_fixtures(
    predictor: CardioTwinPredictor,
    cohort: Mapping[str, Any],
    schema: Mapping[str, Any],
    portable: Mapping[str, Any],
    n_test_cases: int = 20,
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    test_patients = [p for p in cohort["patients"] if p["split"] == "test"][:n_test_cases]
    for p in test_patients:
        cases.append(
            {"id": p["id"], "description": f"Held-out test patient ({p['summary']})", "features": dict(p["features"])}
        )
    cases.extend(_synthetic_cases(schema, portable))
    out = []
    for case in cases:
        values, _ = predictor.normalise(case["features"])
        encoded = predictor.encoder.encode_row(values)
        out.append({**case, "encoded": encoded, "expected": predictor.predict(case["features"])})
    return {
        "version": "1.0.0",
        "model_version": MODEL_VERSION,
        "tolerance": TOLERANCE,
        "columns": list(predictor.encoder.columns),
        "n_cases": len(out),
        "cases": out,
    }
