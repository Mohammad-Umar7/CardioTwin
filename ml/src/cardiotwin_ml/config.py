"""Typed access to the YAML registries in ``ml/configs``.

``features.yaml`` (inputs), ``targets.yaml`` (labels + anatomy) and ``training.yaml`` (protocol and model
zoo) drive the whole pipeline, so extending CardioTwin with a new feature, target or model is a
configuration change rather than a code change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .paths import CONFIG_DIR

FEATURE_TYPES = ("numeric", "binary", "categorical")
RAW_ENCODINGS = ("int01", "yn", "number", "string")
GROUPS = ("demographics", "risk_factors", "symptoms", "exam", "ecg", "labs", "echo")
DERIVED_OPS = ("ratio", "sum", "ckd_epi_2021")


@dataclass(frozen=True)
class FeatureSpec:
    """One raw clinical input as declared in ``features.yaml``."""

    key: str
    label: str
    group: str
    type: str
    raw: str
    description: str
    unit: str | None = None
    step: float | None = None
    normal: dict[str, float | None] = field(default_factory=lambda: {"low": None, "high": None})
    options: tuple[dict[str, str], ...] | None = None
    encoding: dict[str, Any] | None = None
    raw_map: dict[str, str] | None = None

    @property
    def option_values(self) -> tuple[str, ...]:
        return tuple(o["value"] for o in self.options or ())

    @property
    def encoding_kind(self) -> str:
        """``numeric`` | ``binary`` | ``onehot`` | ``ordinal``."""
        if self.type == "categorical":
            assert self.encoding is not None
            return str(self.encoding["kind"])
        return self.type


@dataclass(frozen=True)
class DerivedSpec:
    """A clinically motivated feature computed from raw inputs (see ``features.yaml``)."""

    key: str
    label: str
    op: str
    inputs: tuple[str, ...]
    unit: str | None
    description: str


@dataclass(frozen=True)
class TargetSpec:
    id: str
    label: str
    short: str
    source_column: str
    positive_values: tuple[str, ...]
    anatomy: tuple[str, ...]
    territory: str
    description: str


@dataclass(frozen=True)
class FeatureRegistry:
    groups: tuple[dict[str, Any], ...]
    features: tuple[FeatureSpec, ...]
    derived: tuple[DerivedSpec, ...]

    def by_key(self) -> dict[str, FeatureSpec]:
        return {f.key: f for f in self.features}

    @property
    def keys(self) -> list[str]:
        return [f.key for f in self.features]


@dataclass(frozen=True)
class TargetRegistry:
    targets: tuple[TargetSpec, ...]
    leakage_columns: tuple[str, ...]
    risk_bands: tuple[dict[str, Any], ...]

    @property
    def ids(self) -> list[str]:
        return [t.id for t in self.targets]


def _read_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _validate_feature(raw: dict[str, Any]) -> FeatureSpec:
    key = raw["key"]
    if raw["type"] not in FEATURE_TYPES:
        raise ValueError(f"{key}: unknown type {raw['type']!r}")
    if raw["group"] not in GROUPS:
        raise ValueError(f"{key}: unknown group {raw['group']!r}")
    if raw["raw"] not in RAW_ENCODINGS:
        raise ValueError(f"{key}: unknown raw encoding {raw['raw']!r}")
    if not str(raw.get("description", "")).strip():
        raise ValueError(f"{key}: description is required")
    options = raw.get("options")
    encoding = raw.get("encoding")
    if raw["type"] == "categorical":
        if not options or not encoding:
            raise ValueError(f"{key}: categorical features need options and encoding")
        if encoding["kind"] not in ("onehot", "ordinal"):
            raise ValueError(f"{key}: encoding.kind must be onehot|ordinal")
        values = [o["value"] for o in options]
        if encoding["kind"] == "ordinal" and set(encoding["map"]) != set(values):
            raise ValueError(f"{key}: ordinal map keys must equal option values")
    normal = raw.get("normal") or {"low": None, "high": None}
    return FeatureSpec(
        key=key,
        label=raw["label"],
        group=raw["group"],
        type=raw["type"],
        raw=raw["raw"],
        description=" ".join(str(raw["description"]).split()),
        unit=raw.get("unit"),
        step=raw.get("step"),
        normal={"low": normal.get("low"), "high": normal.get("high")},
        options=tuple(options) if options else None,
        encoding=encoding,
        raw_map=raw.get("raw_map"),
    )


@lru_cache(maxsize=4)
def load_feature_registry(config_dir: Path = CONFIG_DIR) -> FeatureRegistry:
    raw = _read_yaml(config_dir / "features.yaml")
    features = tuple(_validate_feature(f) for f in raw["features"])
    keys = [f.key for f in features]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate feature keys in features.yaml")
    derived = []
    for d in raw.get("derived", []) or []:
        if d["op"] not in DERIVED_OPS:
            raise ValueError(f"derived {d['key']}: unknown op {d['op']!r}")
        missing = [i for i in d["inputs"] if i not in keys]
        if missing:
            raise ValueError(f"derived {d['key']}: unknown inputs {missing}")
        derived.append(
            DerivedSpec(
                key=d["key"],
                label=d["label"],
                op=d["op"],
                inputs=tuple(d["inputs"]),
                unit=d.get("unit"),
                description=" ".join(str(d["description"]).split()),
            )
        )
    return FeatureRegistry(groups=tuple(raw["groups"]), features=features, derived=tuple(derived))


@lru_cache(maxsize=4)
def load_target_registry(config_dir: Path = CONFIG_DIR) -> TargetRegistry:
    raw = _read_yaml(config_dir / "targets.yaml")
    targets = tuple(
        TargetSpec(
            id=t["id"],
            label=t["label"],
            short=t.get("short", t["id"]),
            source_column=t["source_column"],
            positive_values=tuple(t["positive_values"]),
            anatomy=tuple(t["anatomy"]),
            territory=t.get("territory", ""),
            description=" ".join(str(t.get("description", "")).split()),
        )
        for t in raw["targets"]
    )
    leakage = tuple(raw["leakage_columns"])
    for t in targets:
        if t.source_column not in leakage:
            raise ValueError(f"target {t.id}: source column {t.source_column} must be listed in leakage_columns")
    return TargetRegistry(targets=targets, leakage_columns=leakage, risk_bands=tuple(raw["risk_bands"]))


@lru_cache(maxsize=4)
def load_training_config(config_dir: Path = CONFIG_DIR) -> dict[str, Any]:
    return _read_yaml(config_dir / "training.yaml")
