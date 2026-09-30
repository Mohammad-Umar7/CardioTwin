"""Target-leakage guard: LAD, LCX, RCA and Cath must never reach the model inputs."""

from __future__ import annotations

import dataclasses

import pytest

from cardiotwin_ml.config import FeatureSpec
from cardiotwin_ml.preprocess import (
    LEAKAGE_COLUMNS,
    FeatureEncoder,
    LeakageError,
    assert_no_leakage,
    check_leakage_config,
)


def test_leakage_columns_are_hard_coded() -> None:
    assert frozenset({"LAD", "LCX", "RCA", "Cath"}) == LEAKAGE_COLUMNS


def test_targets_config_lists_every_leakage_column(targets) -> None:  # noqa: ANN001
    check_leakage_config(targets)
    assert {t.source_column for t in targets.targets} <= set(targets.leakage_columns)


def test_feature_registry_has_no_leakage_columns(registry) -> None:  # noqa: ANN001
    assert not LEAKAGE_COLUMNS & set(registry.keys)
    for d in registry.derived:
        assert not LEAKAGE_COLUMNS & set(d.inputs)


def test_normalised_frame_excludes_labels(values) -> None:  # noqa: ANN001
    assert not LEAKAGE_COLUMNS & set(values.columns)


@pytest.mark.parametrize("column", sorted(LEAKAGE_COLUMNS) + ["LAD=Stenotic"])
def test_assert_no_leakage_rejects(column: str) -> None:
    with pytest.raises(LeakageError):
        assert_no_leakage(["Age", column])


def test_encoder_refuses_a_leaking_feature(registry) -> None:  # noqa: ANN001
    age = registry.by_key()["Age"]
    leaking: FeatureSpec = dataclasses.replace(age, key="Cath")
    with pytest.raises(LeakageError):
        FeatureEncoder([age, leaking])


def test_deployed_model_inputs_are_leakage_free(model_json, schema_json) -> None:  # noqa: ANN001
    assert_no_leakage(model_json["columns"])
    assert not LEAKAGE_COLUMNS & {f["key"] for f in schema_json["features"]}
    assert not LEAKAGE_COLUMNS & {f["key"] for f in model_json["features"]}
