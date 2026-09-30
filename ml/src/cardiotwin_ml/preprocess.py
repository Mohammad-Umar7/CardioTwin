"""Encoding normalisation, leakage guard and the feature encoder shared by training and inference.

Three representations of a patient exist in CardioTwin:

1. **raw spreadsheet row** - mixed ``"Y"/"N"`` strings and ``0/1`` integers, ``Sex = "Fmale"`` typo, ...
2. **API-normalised features** (``docs/CONTRACTS.md`` §0) - binary as ``0/1`` ints, categorical as schema
   option strings, numeric as floats, keyed by the exact dataset column name.
3. **encoded model matrix** - float64 columns produced by :class:`FeatureEncoder`: numeric & binary
   identity, one-hot or ordinal categories, then optional derived features.

Only (2) crosses the API boundary. (2) -> (3) is deterministic and has no fitted state, so it is
mirrored exactly by ``portable.py`` and the browser engine. Everything that *is* fitted (imputation,
scaling) lives inside scikit-learn pipelines and is fitted within cross-validation folds only.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .config import DerivedSpec, FeatureRegistry, FeatureSpec, TargetRegistry

log = logging.getLogger(__name__)

#: Angiography results - NEVER model inputs (target leakage). Hard-coded on purpose so that a config
#: edit cannot silently re-introduce them; ``targets.yaml`` must agree (checked at runtime).
LEAKAGE_COLUMNS: frozenset[str] = frozenset({"LAD", "LCX", "RCA", "Cath"})

#: Smallest denominator used by ``ratio`` derived features (guards against division by zero for
#: out-of-distribution API inputs; never reached on the dataset, whose minima are Lymph=7, HDL=15.9).
RATIO_MIN_DENOMINATOR = 1e-3
#: Creatinine floor (mg/dL) for the CKD-EPI equation, again only relevant for invalid API inputs.
CKD_EPI_MIN_CREATININE = 0.1

_TRUE_STRINGS = {"1", "y", "yes", "true", "t"}
_FALSE_STRINGS = {"0", "n", "no", "false", "f"}


class LeakageError(AssertionError):
    """A label-derived column reached the model inputs."""


def assert_no_leakage(columns: Iterable[str]) -> None:
    """Raise :class:`LeakageError` if any leakage column (or a derivative of one) is present."""
    cols = list(columns)
    bad = [c for c in cols if c in LEAKAGE_COLUMNS or c.split("=")[0] in LEAKAGE_COLUMNS]
    if bad:
        raise LeakageError(f"target-leakage columns in model inputs: {bad}")


def check_leakage_config(targets: TargetRegistry) -> None:
    """``targets.yaml`` must list at least the hard-coded leakage columns."""
    missing = LEAKAGE_COLUMNS - set(targets.leakage_columns)
    if missing:
        raise LeakageError(f"targets.yaml leakage_columns is missing {sorted(missing)}")


# --------------------------------------------------------------------------- value normalisation


def normalise_binary(value: Any, key: str = "") -> int:
    """Accept 0/1, bools, and ``Y``/``N``/``yes``/``no``/``true``/``false`` strings -> 0/1."""
    if isinstance(value, (bool, np.bool_)):
        return int(value)
    if isinstance(value, (int, np.integer)) and int(value) in (0, 1):
        return int(value)
    if isinstance(value, (float, np.floating)) and float(value) in (0.0, 1.0):
        return int(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s in _TRUE_STRINGS:
            return 1
        if s in _FALSE_STRINGS:
            return 0
    raise ValueError(f"{key}: expected a binary value (0/1, true/false, 'Y'/'N'), got {value!r}")


def normalise_categorical(value: Any, spec: FeatureSpec) -> str:
    """Map a categorical value to its canonical schema option (case-insensitive, honours raw_map)."""
    if not isinstance(value, str):
        raise ValueError(f"{spec.key}: expected one of {list(spec.option_values)}, got {value!r}")
    s = value.strip()
    for alias, target in (spec.raw_map or {}).items():
        if s.lower() == alias.lower():
            s = target
            break
    for option in spec.option_values:
        if s == option or s.lower() == option.lower():
            return option
    raise ValueError(f"{spec.key}: expected one of {list(spec.option_values)}, got {value!r}")


def normalise_numeric(value: Any, key: str = "") -> float:
    if isinstance(value, (bool, np.bool_)):
        raise ValueError(f"{key}: expected a number, got a boolean")
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key}: expected a number, got {value!r}") from None
    if not math.isfinite(out):
        raise ValueError(f"{key}: value must be finite, got {value!r}")
    return out


def normalise_value(spec: FeatureSpec, value: Any) -> int | float | str:
    """Normalise a single API/raw value to its API-normalised form (see module docstring)."""
    if spec.type == "binary":
        return normalise_binary(value, spec.key)
    if spec.type == "categorical":
        return normalise_categorical(value, spec)
    return normalise_numeric(value, spec.key)


def normalise_frame(raw: pd.DataFrame, registry: FeatureRegistry) -> pd.DataFrame:
    """Raw spreadsheet -> API-normalised feature frame (registered features only, leakage-free)."""
    out: dict[str, list[Any]] = {}
    for spec in registry.features:
        if spec.key not in raw.columns:
            raise KeyError(f"feature {spec.key!r} declared in features.yaml is missing from the dataset")
        out[spec.key] = [normalise_value(spec, v) for v in raw[spec.key].tolist()]
    frame = pd.DataFrame(out, index=raw.index)
    for spec in registry.features:
        if spec.type == "binary":
            frame[spec.key] = frame[spec.key].astype("int64")
        elif spec.type == "numeric":
            frame[spec.key] = frame[spec.key].astype("float64")
        else:
            frame[spec.key] = frame[spec.key].astype(object)
    assert_no_leakage(frame.columns)
    return frame


def extract_labels(raw: pd.DataFrame, targets: TargetRegistry) -> pd.DataFrame:
    """Binary 0/1 label frame with one column per target id (positive = ``positive_values``)."""
    labels = {}
    for t in targets.targets:
        col = raw[t.source_column].astype(str).str.strip()
        labels[t.id] = col.isin(t.positive_values).astype("int64")
    return pd.DataFrame(labels, index=raw.index)


def find_constant_columns(frame: pd.DataFrame) -> list[str]:
    """Columns with a single distinct value (they carry no information)."""
    return [c for c in frame.columns if frame[c].nunique(dropna=False) <= 1]


# --------------------------------------------------------------------------- derived features


def compute_derived(spec: DerivedSpec, values: Mapping[str, Any]) -> float:
    """Evaluate one derived feature from API-normalised raw values (float64 arithmetic).

    The exact same arithmetic is implemented in ``portable.py`` and the TypeScript edge engine.
    """
    if spec.op == "ratio":
        num = float(values[spec.inputs[0]])
        den = max(float(values[spec.inputs[1]]), RATIO_MIN_DENOMINATOR)
        return num / den
    if spec.op == "sum":
        total = 0.0
        for key in spec.inputs:
            total += float(values[key])
        return total
    if spec.op == "ckd_epi_2021":
        return ckd_epi_2021(float(values[spec.inputs[0]]), float(values[spec.inputs[1]]), str(values[spec.inputs[2]]))
    raise ValueError(f"unknown derived op {spec.op!r}")


def ckd_epi_2021(creatinine_mg_dl: float, age_years: float, sex: str) -> float:
    """Race-free CKD-EPI 2021 creatinine equation (Inker et al., NEJM 2021) in mL/min/1.73 m²."""
    scr = max(creatinine_mg_dl, CKD_EPI_MIN_CREATININE)
    female = sex == "Female"
    kappa = 0.7 if female else 0.9
    alpha = -0.241 if female else -0.302
    ratio = scr / kappa
    egfr = 142.0 * (min(ratio, 1.0) ** alpha) * (max(ratio, 1.0) ** -1.200) * (0.9938**age_years)
    if female:
        egfr *= 1.012
    return egfr


# --------------------------------------------------------------------------- encoder


@dataclass
class EncodedColumn:
    """Provenance of one encoded model column."""

    name: str
    source: str  # raw feature key, or derived feature key
    kind: str  # numeric | binary | ordinal | onehot | derived
    category: str | None = None
    derived_from: tuple[str, ...] = ()


@dataclass
class FeatureEncoder:
    """Deterministic API-normalised features -> float64 model matrix.

    Parameters
    ----------
    features:
        Feature specs actually used by the model (registry order, constants removed).
    derived:
        Derived feature specs appended after the raw columns (may be empty).
    """

    features: list[FeatureSpec]
    derived: list[DerivedSpec] = field(default_factory=list)

    def __post_init__(self) -> None:
        assert_no_leakage([f.key for f in self.features])
        cols: list[EncodedColumn] = []
        for spec in self.features:
            kind = spec.encoding_kind
            if kind == "onehot":
                for option in spec.option_values:
                    cols.append(EncodedColumn(f"{spec.key}={option}", spec.key, "onehot", category=option))
            else:
                cols.append(EncodedColumn(spec.key, spec.key, kind))
        for d in self.derived:
            cols.append(EncodedColumn(d.key, d.key, "derived", derived_from=d.inputs))
        self.encoded_columns = cols
        assert_no_leakage(c.name for c in cols)

    # ---- introspection
    @property
    def columns(self) -> list[str]:
        return [c.name for c in self.encoded_columns]

    @property
    def raw_keys(self) -> list[str]:
        return [f.key for f in self.features]

    @property
    def specs(self) -> dict[str, FeatureSpec]:
        return {f.key: f for f in self.features}

    def attribution_groups(self) -> dict[str, list[int]]:
        """Encoded column indices grouped by the contribution row they are reported under.

        One-hot columns sum back into their raw feature; each derived feature is its own row.
        """
        groups: dict[str, list[int]] = {}
        for i, c in enumerate(self.encoded_columns):
            groups.setdefault(c.source, []).append(i)
        return groups

    def with_derived(self, derived: Sequence[DerivedSpec]) -> FeatureEncoder:
        return FeatureEncoder(list(self.features), list(derived))

    # ---- transforms
    def encode_row(self, values: Mapping[str, Any]) -> list[float]:
        """Encode one complete, API-normalised feature dict."""
        row: list[float] = []
        for spec in self.features:
            v = values[spec.key]
            kind = spec.encoding_kind
            if kind in ("numeric", "binary"):
                row.append(float(v))
            elif kind == "ordinal":
                assert spec.encoding is not None
                row.append(float(spec.encoding["map"][v]))
            else:  # onehot
                for option in spec.option_values:
                    row.append(1.0 if v == option else 0.0)
        for d in self.derived:
            row.append(compute_derived(d, values))
        return row

    def transform(self, frame: pd.DataFrame | Sequence[Mapping[str, Any]]) -> np.ndarray:
        """Encode many patients -> ``(n, n_columns)`` float64 matrix."""
        records = frame.to_dict(orient="records") if isinstance(frame, pd.DataFrame) else list(frame)
        if not records:
            return np.zeros((0, len(self.encoded_columns)), dtype=np.float64)
        return np.asarray([self.encode_row(r) for r in records], dtype=np.float64)

    def to_json(self) -> dict[str, Any]:
        """Portable description of the encoding (``model.json`` -> ``encoding``)."""
        enc: list[dict[str, Any]] = []
        for spec in self.features:
            kind = spec.encoding_kind
            item: dict[str, Any] = {"feature": spec.key, "kind": kind}
            if kind == "onehot":
                item["categories"] = list(spec.option_values)
                item["columns"] = [f"{spec.key}={o}" for o in spec.option_values]
            elif kind == "ordinal":
                assert spec.encoding is not None
                item["map"] = {k: float(v) for k, v in spec.encoding["map"].items()}
                item["column"] = spec.key
            else:
                item["column"] = spec.key
            enc.append(item)
        derived = [
            {"feature": d.key, "column": d.key, "op": d.op, "inputs": list(d.inputs)} for d in self.derived
        ]
        return {"columns": self.columns, "encoding": enc, "derived": derived}
