"""Locked hold-out split stratified on the joint (CAD, LAD, LCX, RCA) label pattern.

Stratifying on the *joint* pattern keeps the prevalence of every target *and* their co-occurrence
structure (e.g. three-vessel disease) the same in the development and test sets. Patterns rarer than
``min_count`` cannot be stratified reliably, so each is merged into the nearest frequent pattern
(Hamming distance over the label bits; ties -> the more frequent pattern, then lexicographic order).
On this dataset only the single ``0100`` patient (Cath=Normal but LAD stenotic) is merged, into ``0000``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split


def joint_patterns(labels: pd.DataFrame) -> pd.Series:
    """One string per patient, e.g. ``"1101"`` for (CAD, LAD, LCX, RCA)."""
    return labels.astype(int).astype(str).agg("".join, axis=1)


def merge_rare_patterns(patterns: pd.Series, min_count: int) -> tuple[pd.Series, dict[str, str]]:
    """Map patterns with fewer than ``min_count`` members onto their nearest frequent pattern."""
    counts = patterns.value_counts()
    frequent = counts[counts >= min_count]
    if frequent.empty:
        raise ValueError("no label pattern reaches min_count; lower it")
    mapping: dict[str, str] = {}
    for pat in counts.index:
        if pat in frequent.index:
            continue
        candidates = sorted(
            frequent.index,
            key=lambda f: (sum(a != b for a, b in zip(pat, f, strict=True)), -int(frequent[f]), f),
        )
        mapping[str(pat)] = str(candidates[0])
    return patterns.map(lambda p: mapping.get(p, p)), mapping


@dataclass(frozen=True)
class HoldoutSplit:
    dev_index: np.ndarray
    test_index: np.ndarray
    strata: pd.Series
    merged: dict[str, str]

    def describe(self) -> dict[str, object]:
        dev_counts = self.strata.loc[self.dev_index].value_counts().sort_index()
        test_counts = self.strata.loc[self.test_index].value_counts().sort_index()
        return {
            "n_dev": int(len(self.dev_index)),
            "n_test": int(len(self.test_index)),
            "merged_patterns": dict(self.merged),
            "strata_dev": {str(k): int(v) for k, v in dev_counts.items()},
            "strata_test": {str(k): int(v) for k, v in test_counts.items()},
        }


def holdout_split(labels: pd.DataFrame, test_size: float, seed: int, min_count: int) -> HoldoutSplit:
    """Deterministic stratified hold-out split; indices refer to ``labels.index``."""
    patterns = joint_patterns(labels)
    strata, merged = merge_rare_patterns(patterns, min_count)
    dev_idx, test_idx = train_test_split(
        labels.index.to_numpy(), test_size=test_size, random_state=seed, shuffle=True, stratify=strata.to_numpy()
    )
    return HoldoutSplit(np.sort(dev_idx), np.sort(test_idx), strata, merged)
