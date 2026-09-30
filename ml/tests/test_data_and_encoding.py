"""Dataset integrity, encoding normalisation and encoder round-trips."""

from __future__ import annotations

import math

import numpy as np
import pytest

from cardiotwin_ml import data
from cardiotwin_ml.preprocess import (
    FeatureEncoder,
    ckd_epi_2021,
    compute_derived,
    find_constant_columns,
    normalise_binary,
    normalise_value,
)
from cardiotwin_ml.splits import holdout_split, merge_rare_patterns, joint_patterns


def test_dataset_digest_and_shape(raw) -> None:  # noqa: ANN001
    assert data.sha256_file(data.RAW_DATA_DIR / data.XLSX_NAME) == data.XLSX_SHA256
    assert raw.shape == (303, 59)


def test_verified_label_facts(raw, labels) -> None:  # noqa: ANN001
    assert labels.sum().to_dict() == {"CAD": 216, "LAD": 177, "LCX": 119, "RCA": 114}
    any_vessel = labels[["LAD", "LCX", "RCA"]].max(axis=1)
    assert int((any_vessel == labels["CAD"]).sum()) == 302  # one Cath=Normal patient has a stenotic LAD
    assert set(raw["Sex"]) == {"Male", "Fmale"}


def test_binary_columns_are_normalised_to_ints(values, registry) -> None:  # noqa: ANN001
    for f in registry.features:
        if f.type == "binary":
            assert set(values[f.key].unique()) <= {0, 1}, f.key
    assert set(values["Sex"]) == {"Male", "Female"}
    assert set(values["BBB"]) == {"N", "LBBB", "RBBB"}
    assert set(values["VHD"]) == {"N", "mild", "Moderate", "Severe"}


def test_exertional_cp_is_detected_as_constant(values) -> None:  # noqa: ANN001
    assert "Exertional CP" in find_constant_columns(values)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(1, 1), (0, 0), (True, 1), (False, 0), ("Y", 1), ("N", 0), ("yes", 1), ("no", 0), ("true", 1), ("0", 0), (1.0, 1)],
)
def test_binary_normalisation_accepts_api_spellings(value, expected) -> None:  # noqa: ANN001
    assert normalise_binary(value) == expected


@pytest.mark.parametrize("value", [2, "maybe", None, 0.5, "YY"])
def test_binary_normalisation_rejects_garbage(value) -> None:  # noqa: ANN001
    with pytest.raises(ValueError):
        normalise_binary(value)


def test_categorical_aliases_and_case(registry) -> None:  # noqa: ANN001
    specs = registry.by_key()
    assert normalise_value(specs["Sex"], "Fmale") == "Female"
    assert normalise_value(specs["Sex"], "fmale") == "Female"
    assert normalise_value(specs["BBB"], "lbbb") == "LBBB"
    assert normalise_value(specs["VHD"], "MILD") == "mild"
    with pytest.raises(ValueError):
        normalise_value(specs["VHD"], "catastrophic")
    with pytest.raises(ValueError):
        normalise_value(specs["Age"], float("nan"))


def test_encoder_round_trip_and_shapes(values, registry) -> None:  # noqa: ANN001
    used = [f for f in registry.features if f.key not in find_constant_columns(values)]
    enc = FeatureEncoder(used)
    X = enc.transform(values)
    assert X.shape == (len(values), len(enc.columns))
    assert np.isfinite(X).all()
    bbb = [i for i, c in enumerate(enc.columns) if c.startswith("BBB=")]
    assert len(bbb) == 3 and np.all(X[:, bbb].sum(axis=1) == 1)
    vhd = enc.columns.index("VHD")
    assert set(np.unique(X[:, vhd])) == {0.0, 1.0, 2.0, 3.0}
    # re-normalising an already API-normalised record is the identity
    for rec in values.head(25).to_dict(orient="records"):
        again = {k: normalise_value(enc.specs[k], v) for k, v in rec.items() if k in enc.specs}
        assert enc.encode_row(again) == enc.encode_row(rec)


def test_attribution_groups_cover_every_column_once(values, registry) -> None:  # noqa: ANN001
    enc = FeatureEncoder([f for f in registry.features if f.key != "Exertional CP"], list(registry.derived))
    idx = sorted(i for group in enc.attribution_groups().values() for i in group)
    assert idx == list(range(len(enc.columns)))
    assert enc.attribution_groups()["BBB"] == [enc.columns.index(f"BBB={o}") for o in ("N", "LBBB", "RBBB")]


def test_ckd_epi_2021_reference_values() -> None:
    # Inker et al. 2021: 60-year-old man, creatinine 1.0 mg/dL -> ~86; 50-year-old woman, 0.7 -> ~105.
    assert math.isclose(ckd_epi_2021(1.0, 60, "Male"), 86.2, abs_tol=0.3)
    assert math.isclose(ckd_epi_2021(0.7, 50, "Female"), 104.8, abs_tol=0.5)


def test_derived_features(registry) -> None:  # noqa: ANN001
    d = {x.key: x for x in registry.derived}
    rec = {"Neut": 60, "Lymph": 30, "TG": 150, "HDL": 50, "DM": 1, "HTN": 1, "Current Smoker": 0, "DLP": 1, "FH": 0,
           "CR": 1.0, "Age": 60, "Sex": "Male"}
    assert compute_derived(d["NLR"], rec) == 2.0
    assert compute_derived(d["TG/HDL"], rec) == 3.0
    assert compute_derived(d["Risk factor count"], rec) == 3.0
    assert math.isclose(compute_derived(d["eGFR"], rec), ckd_epi_2021(1.0, 60, "Male"))


def test_holdout_split_is_deterministic_and_stratified(labels) -> None:  # noqa: ANN001
    a = holdout_split(labels, 0.2, 42, 5)
    b = holdout_split(labels, 0.2, 42, 5)
    assert np.array_equal(a.test_index, b.test_index)
    assert len(a.test_index) == 61 and len(a.dev_index) == 242
    assert not set(a.test_index) & set(a.dev_index)
    assert a.merged == {"0100": "0000"}
    for t in labels.columns:
        assert abs(labels.loc[a.test_index, t].mean() - labels[t].mean()) < 0.03


def test_rare_pattern_merge_prefers_nearest_then_frequent() -> None:
    import pandas as pd

    pats = pd.Series(["0000"] * 10 + ["1100"] * 6 + ["0100"])
    merged, mapping = merge_rare_patterns(pats, 5)
    assert mapping == {"0100": "0000"}  # tie at Hamming 1 -> more frequent pattern
    assert merged.value_counts().to_dict() == {"0000": 11, "1100": 6}


def test_joint_patterns(labels) -> None:  # noqa: ANN001
    pats = joint_patterns(labels).value_counts().to_dict()
    assert pats["0000"] == 86 and pats["1111"] == 63 and pats["0100"] == 1
