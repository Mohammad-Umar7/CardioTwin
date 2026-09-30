"""Dependency-free reference evaluator for the portable model (``model.json``).

This file is the *specification by example* for the browser (TypeScript) edge engine: it reads ONLY
``model.json`` and reproduces the native Python predictions and SHAP explanations to < 1e-9. It uses the
standard library only (``json``, ``math``, ``struct``) and plain lists/dicts, so it can be ported line by
line. The format is documented field-by-field in ``ml/README.md`` ("Portable model format").

Pipeline for one patient::

    features (dict, may be partial)
      -> normalise + impute defaults            normalise_features()
      -> encoded float64 vector                 encode()
      -> per target, per component margin       logistic_margin() / xgboost_margin()
      -> ensemble margin m = sum(weight_k * m_k)
      -> probability p = 1 / (1 + exp(-(a*m + b)))   (Platt)
      -> SHAP: sum(weight_k * shap_k), one-hot columns summed per raw feature
      -> calibrated scale: shap_calibrated = a * shap, calibrated_base_value = a * base + b

Numerical rules that MUST be mirrored exactly:

* all arithmetic in float64 (JS ``number``), summing in the order written here;
* XGBoost splits compare ``fround(x) < fround(split_condition)`` (float32, like XGBoost); a missing value
  (NaN) follows the ``missing`` child;
* XGBoost margin = ``logit(base_score) + sum(leaf values)`` with leaves summed in tree order.

Usage::

    python -m cardiotwin_ml.portable ml/artifacts/model.json '{"Age": 63, "Typical Chest Pain": 1}'
"""

from __future__ import annotations

import json
import math
import struct
import sys
from typing import Any

FLOAT32_MAX = 3.4028234663852886e38


# --------------------------------------------------------------------------- numeric helpers


def fround(x: float) -> float:
    """Round to the nearest float32 (round-half-even) and return as float64 - JS ``Math.fround``."""
    if x != x:  # NaN
        return x
    if x > FLOAT32_MAX or x < -FLOAT32_MAX:
        # Values beyond float32 range become +/-inf, exactly like Math.fround.
        return math.copysign(math.inf, x) if abs(x) >= 3.4028235677973366e38 else math.copysign(FLOAT32_MAX, x)
    return struct.unpack("<f", struct.pack("<f", x))[0]


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def logit(p: float) -> float:
    return math.log(p / (1.0 - p))


# --------------------------------------------------------------------------- input normalisation

_TRUE = {"1", "y", "yes", "true", "t"}
_FALSE = {"0", "n", "no", "false", "f"}


def normalise_value(feature: dict[str, Any], value: Any) -> Any:
    """Coerce one API value to its canonical form (binary -> 0/1, categorical -> option, numeric -> float)."""
    key, ftype = feature["key"], feature["type"]
    if ftype == "binary":
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float)) and value in (0, 1):
            return int(value)
        if isinstance(value, str) and value.strip().lower() in _TRUE:
            return 1
        if isinstance(value, str) and value.strip().lower() in _FALSE:
            return 0
        raise ValueError(f"{key}: expected a binary value, got {value!r}")
    if ftype == "categorical":
        if isinstance(value, str):
            s = value.strip()
            for alias, target in feature.get("aliases", {}).items():
                if s.lower() == alias.lower():
                    s = target
                    break
            for option in feature["options"]:
                if s.lower() == option.lower():
                    return option
        raise ValueError(f"{key}: expected one of {feature['options']}, got {value!r}")
    if isinstance(value, bool):
        raise ValueError(f"{key}: expected a number, got a boolean")
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key}: expected a number, got {value!r}") from None
    if math.isnan(out) or math.isinf(out):
        raise ValueError(f"{key}: value must be finite")
    return out


def normalise_features(model: dict[str, Any], features: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Validate keys, normalise values and fill missing features with their defaults."""
    known = {f["key"]: f for f in model["features"]}
    unknown = [k for k in features if k not in known]
    if unknown:
        raise ValueError(f"unknown feature(s): {unknown}")
    values: dict[str, Any] = {}
    imputed: list[str] = []
    for f in model["features"]:
        key = f["key"]
        if key in features and features[key] is not None:
            values[key] = normalise_value(f, features[key])
        else:
            values[key] = f["default"]
            imputed.append(key)
    return values, imputed


# --------------------------------------------------------------------------- encoding


def derived_value(spec: dict[str, Any], values: dict[str, Any], constants: dict[str, float]) -> float:
    op, inputs = spec["op"], spec["inputs"]
    if op == "ratio":
        return float(values[inputs[0]]) / max(float(values[inputs[1]]), constants["ratio_min_denominator"])
    if op == "sum":
        total = 0.0
        for key in inputs:
            total += float(values[key])
        return total
    if op == "ckd_epi_2021":
        scr = max(float(values[inputs[0]]), constants["ckd_epi_min_creatinine"])
        age = float(values[inputs[1]])
        female = values[inputs[2]] == "Female"
        kappa = 0.7 if female else 0.9
        alpha = -0.241 if female else -0.302
        ratio = scr / kappa
        egfr = 142.0 * (min(ratio, 1.0) ** alpha) * (max(ratio, 1.0) ** -1.200) * (0.9938**age)
        return egfr * 1.012 if female else egfr
    raise ValueError(f"unknown derived op {op!r}")


def encode(model: dict[str, Any], values: dict[str, Any]) -> tuple[list[float], dict[str, float]]:
    """API-normalised values -> encoded float64 vector in ``model['columns']`` order."""
    row: list[float] = []
    for enc in model["encoding"]:
        v = values[enc["feature"]]
        kind = enc["kind"]
        if kind in ("numeric", "binary"):
            row.append(float(v))
        elif kind == "ordinal":
            row.append(float(enc["map"][v]))
        elif kind == "onehot":
            for category in enc["categories"]:
                row.append(1.0 if v == category else 0.0)
        else:
            raise ValueError(f"unknown encoding kind {kind!r}")
    derived: dict[str, float] = {}
    for spec in model["derived"]:
        d = derived_value(spec, values, model["constants"])
        derived[spec["feature"]] = d
        row.append(d)
    if len(row) != len(model["columns"]):
        raise ValueError("encoded row length does not match model columns")
    return row, derived


# --------------------------------------------------------------------------- logistic component


def logistic_margin(comp: dict[str, Any], x: list[float]) -> float:
    """m = intercept + sum_j coef_j * (x_j - mean_j) / scale_j."""
    m = comp["intercept"]
    coef, mean, scale = comp["coef"], comp["scaler"]["mean"], comp["scaler"]["scale"]
    for j in range(len(x)):
        m += coef[j] * ((x[j] - mean[j]) / scale[j])
    return m


def logistic_shap(comp: dict[str, Any], x: list[float]) -> list[float]:
    """Exact linear SHAP w.r.t. the background (dev-set) mean: coef_j / scale_j * (x_j - bg_j)."""
    coef, scale, bg = comp["coef"], comp["scaler"]["scale"], comp["background_mean"]
    return [(x[j] - bg[j]) * (coef[j] / scale[j]) for j in range(len(x))]


# --------------------------------------------------------------------------- xgboost component


def index_tree(tree: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """Flatten a nested XGBoost JSON-dump tree into ``{nodeid: node}``."""
    nodes: dict[int, dict[str, Any]] = {}
    stack = [tree]
    while stack:
        node = stack.pop()
        nodes[node["nodeid"]] = node
        stack.extend(node.get("children", []))
    return nodes


def goes_yes(node: dict[str, Any], x: list[float]) -> bool:
    """XGBoost routing: float32 comparison ``x < split_condition``; NaN follows ``missing``."""
    v = x[node["split_index"]]
    if v != v:
        return node["missing"] == node["yes"]
    return fround(v) < fround(node["split_condition"])


def xgboost_margin(comp: dict[str, Any], x: list[float]) -> float:
    m = logit(comp["base_score"])
    for nodes in comp["_index"]:
        node = nodes[0]
        while "leaf" not in node:
            node = nodes[node["yes"] if goes_yes(node, x) else node["no"]]
        m += node["leaf"]
    return m


def xgboost_shap(comp: dict[str, Any], x: list[float], n_columns: int) -> list[float]:
    """Exact path-dependent TreeSHAP (Lundberg et al. 2018, Algorithm 2) using node ``cover``."""
    phi = [0.0] * n_columns
    for nodes in comp["_index"]:
        _tree_shap_recurse(nodes, x, phi, 0, [], 1.0, 1.0, -1)
    return phi


# A path element is [feature_index, zero_fraction, one_fraction, permutation_weight].


def _extend_path(path: list[list[float]], zero: float, one: float, feature: int) -> list[list[float]]:
    depth = len(path)
    out = [list(e) for e in path]
    out.append([feature, zero, one, 1.0 if depth == 0 else 0.0])
    for i in range(depth - 1, -1, -1):
        out[i + 1][3] += one * out[i][3] * (i + 1) / (depth + 1)
        out[i][3] = zero * out[i][3] * (depth - i) / (depth + 1)
    return out


def _unwind_path(path: list[list[float]], index: int) -> list[list[float]]:
    depth = len(path) - 1
    one, zero = path[index][2], path[index][1]
    next_one = path[depth][3]
    weights = [e[3] for e in path]
    for i in range(depth - 1, -1, -1):
        if one != 0:
            tmp = weights[i]
            weights[i] = next_one * (depth + 1) / ((i + 1) * one)
            next_one = tmp - weights[i] * zero * (depth - i) / (depth + 1)
        else:
            weights[i] = weights[i] * (depth + 1) / (zero * (depth - i))
    out = []
    for i in range(depth):
        src = path[i + 1] if i >= index else path[i]
        out.append([src[0], src[1], src[2], weights[i]])
    return out


def _unwound_path_sum(path: list[list[float]], index: int) -> float:
    depth = len(path) - 1
    one, zero = path[index][2], path[index][1]
    next_one = path[depth][3]
    total = 0.0
    if one != 0:
        for i in range(depth - 1, -1, -1):
            tmp = next_one / ((i + 1) * one)
            total += tmp
            next_one = path[i][3] - tmp * zero * (depth - i)
    else:
        for i in range(depth - 1, -1, -1):
            total += path[i][3] / (zero * (depth - i))
    return total * (depth + 1)


def _tree_shap_recurse(
    nodes: dict[int, dict[str, Any]],
    x: list[float],
    phi: list[float],
    node_id: int,
    path: list[list[float]],
    zero: float,
    one: float,
    feature: int,
) -> None:
    path = _extend_path(path, zero, one, feature)
    node = nodes[node_id]
    if "leaf" in node:
        for i in range(1, len(path)):
            el = path[i]
            phi[int(el[0])] += _unwound_path_sum(path, i) * (el[2] - el[1]) * node["leaf"]
        return
    split = node["split_index"]
    incoming_zero, incoming_one = 1.0, 1.0
    for k in range(1, len(path)):
        if path[k][0] == split:  # feature already on the path: undo that split first
            incoming_zero, incoming_one = path[k][1], path[k][2]
            path = _unwind_path(path, k)
            break
    yes, no = nodes[node["yes"]], nodes[node["no"]]
    hot_yes = goes_yes(node, x)
    cover = node["cover"]
    _tree_shap_recurse(nodes, x, phi, node["yes"], path, incoming_zero * yes["cover"] / cover, incoming_one if hot_yes else 0.0, split)
    _tree_shap_recurse(nodes, x, phi, node["no"], path, incoming_zero * no["cover"] / cover, 0.0 if hot_yes else incoming_one, split)


# --------------------------------------------------------------------------- model


def risk_band(bands: list[dict[str, Any]], p: float) -> str:
    for band in bands:
        if p < band["max"]:
            return band["id"]
    return bands[-1]["id"]


class PortableModel:
    """Evaluate ``model.json`` exactly like the native Python predictor."""

    def __init__(self, spec: dict[str, Any]):
        self.spec = spec
        for target in spec["targets"]:
            for comp in spec["models"][target]["components"]:
                if comp["type"] == "xgboost":
                    comp["_index"] = [index_tree(t) for t in comp["trees"]]

    @classmethod
    def load(cls, path: str) -> PortableModel:
        with open(path, encoding="utf-8") as fh:
            return cls(json.load(fh))

    def component_outputs(self, comp: dict[str, Any], x: list[float]) -> tuple[float, list[float]]:
        n = len(x)
        if comp["type"] == "logistic":
            return logistic_margin(comp, x), logistic_shap(comp, x)
        if comp["type"] == "xgboost":
            return xgboost_margin(comp, x), xgboost_shap(comp, x, n)
        raise ValueError(f"unknown component type {comp['type']!r}")

    def predict(self, features: dict[str, Any]) -> dict[str, Any]:
        """Return the ``docs/CONTRACTS.md`` §3.2 response body (``engine = "edge"``)."""
        spec = self.spec
        values, imputed = normalise_features(spec, features)
        x, derived = encode(spec, values)
        predictions: dict[str, Any] = {}
        explanations: dict[str, Any] = {}
        for target in spec["targets"]:
            tm = spec["models"][target]
            margin = 0.0
            base = 0.0
            shap_cols = [0.0] * len(x)
            for comp in tm["components"]:
                m, s = self.component_outputs(comp, x)
                w = comp["weight"]
                margin += w * m
                base += w * comp["base_value"]
                for j in range(len(x)):
                    shap_cols[j] += w * s[j]
            cal = tm["calibration"]
            calibrated = cal["a"] * margin + cal["b"]
            p = sigmoid(calibrated)
            predictions[target] = {
                "probability": p,
                "label": 1 if p >= tm["threshold"] else 0,
                "threshold": tm["threshold"],
                "risk_band": risk_band(spec["risk_bands"], p),
                "logit": margin,
            }
            explanations[target] = {
                "space": "log-odds",
                "base_value": base,
                "output_value": margin,
                "contributions": self._contributions(values, derived, shap_cols, cal["a"]),
                "calibrated_base_value": cal["a"] * base + cal["b"],
                "calibrated_output_value": calibrated,
            }
        vessels = spec["vessel_targets"]
        expected = 0.0
        for v in vessels:
            expected += predictions[v]["probability"]
        highest = max(vessels, key=lambda v: predictions[v]["probability"]) if vessels else None
        return {
            "model_version": spec["model_version"],
            "engine": "edge",
            "imputed": imputed,
            "predictions": predictions,
            "explanations": explanations,
            "summary": {"expected_diseased_vessels": expected, "highest_risk_vessel": highest},
        }

    def _contributions(
        self, values: dict[str, Any], derived: dict[str, float], shap_cols: list[float], slope: float
    ) -> list[dict[str, Any]]:
        rows = []
        for group in self.spec["attribution"]:
            s = 0.0
            for j in group["column_indices"]:
                s += shap_cols[j]
            name = group["feature"]
            if group.get("derived_from"):
                rows.append(
                    {
                        "feature": name,
                        "value": derived[name],
                        "shap": s,
                        "shap_calibrated": slope * s,
                        "derived_from": group["derived_from"],
                    }
                )
            else:
                v = values[name]
                if not isinstance(v, str):
                    v = int(v) if float(v).is_integer() else float(v)
                rows.append({"feature": name, "value": v, "shap": s, "shap_calibrated": slope * s})
        rows.sort(key=lambda r: (-abs(r["shap"]), r["feature"]))
        return rows


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print(__doc__)
        raise SystemExit(2)
    model = PortableModel.load(args[0])
    features = json.loads(args[1]) if len(args) > 1 else {}
    print(json.dumps(model.predict(features), indent=2))


if __name__ == "__main__":
    main()
