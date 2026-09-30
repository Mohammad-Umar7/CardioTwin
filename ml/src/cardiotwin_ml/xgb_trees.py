"""Exact float64 evaluation and path-dependent TreeSHAP for XGBoost boosters.

Why not just ``booster.predict(..., pred_contribs=True)``? XGBoost accumulates margins and SHAP values in
float32, which breaks the ``|base + sum(shap) - margin| < 1e-6`` additivity contract by up to ~1e-5.
CardioTwin therefore defines the XGBoost margin as the **float64 sum of the float32 leaf values** of the
leaves XGBoost itself routes a patient to (``pred_leaf=True``), and computes SHAP with a float64,
sample-vectorised implementation of path-dependent TreeSHAP (Lundberg, Erion & Lee 2018, Algorithm 2;
same recursion as ``shap``'s ``tree_shap_recursive``) using the node cover (sum of hessians) that
XGBoost stores. Agreement with XGBoost's own float32 ``pred_contribs`` is verified by the tests.

Routing semantics (mirrored by ``portable.py`` and the browser engine): feature values and thresholds
are compared as float32, ``x < split_condition`` goes to ``yes``, a missing value (NaN) goes to
``missing``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import xgboost as xgb


@dataclass
class FlatTree:
    """Array form of one regression tree, indexed by XGBoost ``nodeid``."""

    left: np.ndarray  # int, -1 for leaves ("yes" child)
    right: np.ndarray  # int, -1 for leaves ("no" child)
    missing: np.ndarray  # int, -1 for leaves
    feature: np.ndarray  # int column index, -1 for leaves
    threshold: np.ndarray  # float32 split condition stored as float64 (exact)
    value: np.ndarray  # leaf value (float32-exact), 0 for internal nodes
    cover: np.ndarray  # node cover / sum of hessians (float32-exact)

    @property
    def is_leaf(self) -> np.ndarray:
        return self.left < 0

    def expected_value(self) -> float:
        """Cover-weighted mean leaf value (the tree's contribution to the SHAP base value)."""
        return float(self._mean(0))

    def _mean(self, node: int) -> float:
        if self.left[node] < 0:
            return float(self.value[node])
        lft, rgt = int(self.left[node]), int(self.right[node])
        return (self._mean(lft) * self.cover[lft] + self._mean(rgt) * self.cover[rgt]) / self.cover[node]


def f32(x: float) -> float:
    """Round a Python float to the nearest float32 and return it as float64 (exact)."""
    return float(np.float32(x))


def parse_dump(booster: xgb.Booster, column_names: list[str]) -> tuple[list[FlatTree], list[dict[str, Any]]]:
    """Parse ``get_dump(json, with_stats)`` into flat trees + a portable nested JSON copy.

    The nested copy keeps XGBoost's JSON-dump shape (``nodeid``, ``split``, ``split_condition``, ``yes``,
    ``no``, ``missing``, ``cover``, ``leaf``, ``children``) and adds ``split_index`` (column position).
    All numbers are float32-exact doubles so that every consumer parses identical values.
    """
    flats: list[FlatTree] = []
    nested: list[dict[str, Any]] = []
    for text in booster.get_dump(dump_format="json", with_stats=True):
        nodes: dict[int, dict[str, Any]] = {}
        nested.append(_portable_node(json.loads(text), nodes, column_names))
        size = max(nodes) + 1
        left = np.full(size, -1, dtype=np.int64)
        right = np.full(size, -1, dtype=np.int64)
        missing = np.full(size, -1, dtype=np.int64)
        feature = np.full(size, -1, dtype=np.int64)
        threshold = np.zeros(size)
        value = np.zeros(size)
        cover = np.zeros(size)
        for nid, n in nodes.items():
            cover[nid] = f32(n["cover"])
            if "leaf" in n:
                value[nid] = f32(n["leaf"])
                continue
            feature[nid] = _split_index(str(n["split"]), column_names)
            threshold[nid] = f32(n["split_condition"])
            left[nid], right[nid], missing[nid] = int(n["yes"]), int(n["no"]), int(n["missing"])
        flats.append(FlatTree(left, right, missing, feature, threshold, value, cover))
    return flats, nested


def _split_index(split: str, column_names: list[str]) -> int:
    return int(split[1:]) if split.startswith("f") and split[1:].isdigit() else column_names.index(split)


def _portable_node(n: dict[str, Any], nodes: dict[int, dict[str, Any]], column_names: list[str]) -> dict[str, Any]:
    """Copy one dump node (recursively) into portable form; records raw nodes by id in ``nodes``."""
    nid = int(n["nodeid"])
    nodes[nid] = n
    if "leaf" in n:
        return {"nodeid": nid, "leaf": f32(n["leaf"]), "cover": f32(n["cover"])}
    idx = _split_index(str(n["split"]), column_names)
    return {
        "nodeid": nid,
        "split": column_names[idx],
        "split_index": idx,
        "split_condition": f32(n["split_condition"]),
        "yes": int(n["yes"]),
        "no": int(n["no"]),
        "missing": int(n["missing"]),
        "cover": f32(n["cover"]),
        "children": [_portable_node(c, nodes, column_names) for c in n["children"]],
    }


def base_score(booster: xgb.Booster) -> float:
    """Probability-space ``base_score`` (XGBoost 3.x stores it as e.g. ``"[4.9166667E-1]"``)."""
    params = json.loads(booster.save_config())["learner"]["learner_model_param"]
    raw = str(params["base_score"]).strip().strip("[]").split(",")[0]
    return float(raw)


def logit(p: float) -> float:
    return math.log(p / (1.0 - p))


def leaf_indices(booster: xgb.Booster, X: np.ndarray) -> np.ndarray:
    """``(n, n_trees)`` node ids XGBoost routes each row to (its own float32 comparisons)."""
    return np.asarray(booster.predict(xgb.DMatrix(X), pred_leaf=True), dtype=np.int64).reshape(len(X), -1)


def margin_from_leaves(trees: list[FlatTree], leaves: np.ndarray, base_margin: float) -> np.ndarray:
    out = np.full(leaves.shape[0], base_margin, dtype=np.float64)
    for t, tree in enumerate(trees):
        out = out + tree.value[leaves[:, t]]
    return out


def route_left(tree: FlatTree, node: int, X32: np.ndarray) -> np.ndarray:
    """Boolean mask of rows going to the ``yes`` child (float32 compare; NaN -> ``missing`` child)."""
    col = X32[:, tree.feature[node]]
    thr = np.float32(tree.threshold[node])
    goes_yes = col < thr
    nan = np.isnan(col)
    if nan.any():
        goes_yes = np.where(nan, tree.missing[node] == tree.left[node], goes_yes)
    return goes_yes


def tree_shap(trees: list[FlatTree], X: np.ndarray, n_features: int) -> np.ndarray:
    """Exact path-dependent TreeSHAP, float64, vectorised over rows -> ``(n, n_features)``."""
    X32 = np.asarray(X, dtype=np.float32)
    n = X32.shape[0]
    phi = np.zeros((n, n_features), dtype=np.float64)
    for tree in trees:
        _recurse(tree, X32, phi, node=0, path=[], zero_fraction=1.0, one_fraction=np.ones(n), feature=-1)
    return phi


def expected_value(trees: list[FlatTree], base_margin: float) -> float:
    return base_margin + sum(t.expected_value() for t in trees)


# Path elements are tuples (feature, zero_fraction: float, one_fraction: array, pweight: array).


def _extend(path: list[list[Any]], zero_fraction: float, one_fraction: np.ndarray, feature: int) -> list[list[Any]]:
    depth = len(path)
    new = [[e[0], e[1], e[2], e[3].copy()] for e in path]
    new.append([feature, zero_fraction, one_fraction, np.ones_like(one_fraction) if depth == 0 else np.zeros_like(one_fraction)])
    for i in range(depth - 1, -1, -1):
        new[i + 1][3] = new[i + 1][3] + one_fraction * new[i][3] * (i + 1) / (depth + 1)
        new[i][3] = zero_fraction * new[i][3] * (depth - i) / (depth + 1)
    return new


def _unwind(path: list[list[Any]], index: int) -> list[list[Any]]:
    depth = len(path) - 1
    one = path[index][2]
    zero = path[index][1]
    nz = one != 0
    safe_one = np.where(nz, one, 1.0)
    next_one = path[depth][3].copy()
    weights = [e[3].copy() for e in path]
    for i in range(depth - 1, -1, -1):
        tmp = weights[i]
        w_hot = next_one * (depth + 1) / ((i + 1) * safe_one)
        w_cold = tmp * (depth + 1) / (zero * (depth - i))
        new_w = np.where(nz, w_hot, w_cold)
        next_one = np.where(nz, tmp - new_w * zero * (depth - i) / (depth + 1), next_one)
        weights[i] = new_w
    out = []
    for i in range(depth):
        src = path[i + 1] if i >= index else path[i]
        out.append([src[0], src[1], src[2], weights[i]])
    return out


def _unwound_sum(path: list[list[Any]], index: int) -> np.ndarray:
    depth = len(path) - 1
    one = path[index][2]
    zero = path[index][1]
    nz = one != 0
    safe_one = np.where(nz, one, 1.0)
    next_one = path[depth][3]
    total_hot = np.zeros_like(next_one)
    total_cold = np.zeros_like(next_one)
    for i in range(depth - 1, -1, -1):
        tmp = next_one / ((i + 1) * safe_one)
        total_hot = total_hot + tmp
        next_one = path[i][3] - tmp * zero * (depth - i)
        total_cold = total_cold + path[i][3] / (zero * (depth - i))
    return np.where(nz, total_hot, total_cold) * (depth + 1)


def _recurse(
    tree: FlatTree,
    X32: np.ndarray,
    phi: np.ndarray,
    node: int,
    path: list[list[Any]],
    zero_fraction: float,
    one_fraction: np.ndarray,
    feature: int,
) -> None:
    path = _extend(path, zero_fraction, one_fraction, feature)
    if tree.left[node] < 0:
        value = tree.value[node]
        for i in range(1, len(path)):
            w = _unwound_sum(path, i)
            el = path[i]
            phi[:, el[0]] += w * (el[2] - el[1]) * value
        return
    split = int(tree.feature[node])
    incoming_zero, incoming_one = 1.0, np.ones(X32.shape[0])
    for k in range(1, len(path)):
        if path[k][0] == split:
            incoming_zero, incoming_one = path[k][1], path[k][2]
            path = _unwind(path, k)
            break
    goes_left = route_left(tree, node, X32)
    lft, rgt = int(tree.left[node]), int(tree.right[node])
    cover = tree.cover[node]
    _recurse(tree, X32, phi, lft, path, incoming_zero * tree.cover[lft] / cover, incoming_one * goes_left, split)
    _recurse(tree, X32, phi, rgt, path, incoming_zero * tree.cover[rgt] / cover, incoming_one * ~goes_left, split)


class ScalarTreeShap:
    """Single-row TreeSHAP on plain Python lists (~10x faster than the vectorised path for n = 1).

    Used by the online predictor. Same float64 recursion as :func:`tree_shap`; the unique path is kept as
    four parallel lists (feature, zero fraction, one fraction, permutation weight) to avoid allocations.
    """

    def __init__(self, trees: list[FlatTree]):
        self._trees = [
            (
                t.left.tolist(),
                t.right.tolist(),
                t.missing.tolist(),
                t.feature.tolist(),
                [float(np.float32(v)) for v in t.threshold],
                t.value.tolist(),
                t.cover.tolist(),
            )
            for t in trees
        ]

    def shap(self, x: np.ndarray, n_features: int) -> list[float]:
        x32 = [float(v) for v in np.asarray(x, dtype=np.float32)]
        phi = [0.0] * n_features
        for tree in self._trees:
            _s_recurse(tree, x32, phi, 0, [], [], [], [], 1.0, 1.0, -1)
        return phi


def _s_recurse(tree, x32, phi, node, feats, zeros, ones, weights, zero, one, feature) -> None:  # noqa: ANN001, PLR0913
    left, right, missing, feat, thr, value, cover = tree
    # extend the path with (feature, zero, one)
    depth = len(feats)
    feats = feats + [feature]
    zeros = zeros + [zero]
    ones = ones + [one]
    weights = weights + [1.0 if depth == 0 else 0.0]
    for i in range(depth - 1, -1, -1):
        weights[i + 1] += one * weights[i] * (i + 1) / (depth + 1)
        weights[i] = zero * weights[i] * (depth - i) / (depth + 1)
    if left[node] < 0:
        v = value[node]
        for i in range(1, len(feats)):
            phi[feats[i]] += _s_unwound_sum(weights, zeros[i], ones[i]) * (ones[i] - zeros[i]) * v
        return
    split = feat[node]
    in_zero, in_one = 1.0, 1.0
    for k in range(1, len(feats)):
        if feats[k] == split:
            in_zero, in_one = zeros[k], ones[k]
            feats, zeros, ones, weights = _s_unwind(feats, zeros, ones, weights, k)
            break
    xv = x32[split]
    goes_left = (missing[node] == left[node]) if xv != xv else xv < thr[node]
    lft, rgt, c = left[node], right[node], cover[node]
    _s_recurse(tree, x32, phi, lft, feats, zeros, ones, weights, in_zero * cover[lft] / c, in_one if goes_left else 0.0, split)
    _s_recurse(tree, x32, phi, rgt, feats, zeros, ones, weights, in_zero * cover[rgt] / c, 0.0 if goes_left else in_one, split)


def _s_unwind(feats, zeros, ones, weights, index):  # noqa: ANN001, ANN202
    depth = len(feats) - 1
    one, zero = ones[index], zeros[index]
    next_one = weights[depth]
    w = list(weights)
    for i in range(depth - 1, -1, -1):
        if one != 0:
            tmp = w[i]
            w[i] = next_one * (depth + 1) / ((i + 1) * one)
            next_one = tmp - w[i] * zero * (depth - i) / (depth + 1)
        else:
            w[i] = w[i] * (depth + 1) / (zero * (depth - i))
    keep = [i for i in range(depth + 1) if i != index]
    return [feats[i] for i in keep], [zeros[i] for i in keep], [ones[i] for i in keep], w[:depth]


def _s_unwound_sum(weights, zero, one):  # noqa: ANN001, ANN202
    depth = len(weights) - 1
    next_one = weights[depth]
    total = 0.0
    if one != 0:
        for i in range(depth - 1, -1, -1):
            tmp = next_one / ((i + 1) * one)
            total += tmp
            next_one = weights[i] - tmp * zero * (depth - i)
    else:
        for i in range(depth - 1, -1, -1):
            total += weights[i] / (zero * (depth - i))
    return total * (depth + 1)
