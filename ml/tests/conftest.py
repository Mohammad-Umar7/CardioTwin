"""Shared fixtures for the CardioTwin ML test-suite."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from cardiotwin_ml import data
from cardiotwin_ml.config import FeatureRegistry, TargetRegistry, load_feature_registry, load_target_registry
from cardiotwin_ml.paths import ARTIFACTS_DIR
from cardiotwin_ml.preprocess import extract_labels, normalise_frame


@pytest.fixture(scope="session")
def registry() -> FeatureRegistry:
    return load_feature_registry()


@pytest.fixture(scope="session")
def targets() -> TargetRegistry:
    return load_target_registry()


@pytest.fixture(scope="session")
def raw() -> pd.DataFrame:
    return data.load_raw(data.ensure_dataset(allow_download=False))


@pytest.fixture(scope="session")
def values(raw: pd.DataFrame, registry: FeatureRegistry) -> pd.DataFrame:
    return normalise_frame(raw, registry)


@pytest.fixture(scope="session")
def labels(raw: pd.DataFrame, targets: TargetRegistry) -> pd.DataFrame:
    return extract_labels(raw, targets)


def _require(path: Path) -> Path:
    if not path.exists():
        pytest.skip(f"{path.name} not built yet - run `python -m cardiotwin_ml.train` first")
    return path


@pytest.fixture(scope="session")
def artifacts_dir() -> Path:
    _require(ARTIFACTS_DIR / "cardiotwin_models.joblib")
    return ARTIFACTS_DIR


@pytest.fixture(scope="session")
def predictor(artifacts_dir: Path):  # noqa: ANN201
    from cardiotwin_ml.inference import CardioTwinPredictor

    return CardioTwinPredictor.load(artifacts_dir)


@pytest.fixture(scope="session")
def fixtures_json(artifacts_dir: Path) -> dict:
    return json.loads(_require(artifacts_dir / "fixtures.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def model_json(artifacts_dir: Path) -> dict:
    return json.loads(_require(artifacts_dir / "model.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def schema_json(artifacts_dir: Path) -> dict:
    return json.loads(_require(artifacts_dir / "schema.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def metrics_json(artifacts_dir: Path) -> dict:
    return json.loads(_require(artifacts_dir / "metrics.json").read_text(encoding="utf-8"))
