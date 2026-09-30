"""The published definitions never contradict the published geometry.

``anatomy/config/definitions.json`` quotes numbers as ``{KEY}`` placeholders that ``make_manifest.py`` fills from the
built model (``manifest.facts``). These tests re-measure the same quantities independently from ``vessels.json`` and
check that the manifest's definitions state them, that no placeholder is left, and that the FMA ids of the venous
tree are the specific entities (the anterior interventricular vein is not the great cardiac vein).
"""
from __future__ import annotations

import json
import re

import numpy as np
import pytest

from common import PUBLIC_DIR

MANIFEST = PUBLIC_DIR / "manifest.json"
VESSELS = PUBLIC_DIR / "vessels.json"

pytestmark = pytest.mark.skipif(not (MANIFEST.exists() and VESSELS.exists()), reason="anatomy assets not built")


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def vessels() -> dict:
    return json.loads(VESSELS.read_text(encoding="utf-8"))


def length_mm(points) -> float:
    P = np.asarray(points, float)
    return float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum() * 100.0)


def structure(manifest: dict, node: str) -> dict:
    return next(s for s in manifest["structures"] if s["node"] == node)


def vein(manifest: dict, label: str) -> dict:
    return next(v for v in manifest["veins"] if v["label"] == label)


def test_no_unfilled_placeholders(manifest):
    texts = [s.get("definition", "") for s in manifest["structures"]] + [v.get("definition", "") for v in manifest["veins"]]
    left = [t for t in texts if re.search(r"\{[A-Z_]+\}", t)]
    assert not left, left


def test_left_main_length_matches_the_centreline(manifest, vessels):
    lm = next(v for v in vessels["vessels"] if v["node"] == "Coronary_LM")
    measured = length_mm(lm["segments"][0]["points"])
    m = re.search(r"about (\d+) mm long in this model", structure(manifest, "Coronary_LM")["definition"])
    assert m, structure(manifest, "Coronary_LM")["definition"]
    assert abs(float(m.group(1)) - measured) <= 1.0


@pytest.mark.parametrize("label", ["CS", "GCV", "AIV", "SCV", "RMV"])
def test_vein_lengths_match_the_centrelines(manifest, vessels, label):
    main = next((sg for sg in vessels["veins"]["segments"] if sg["label"] == label and not sg.get("side")), None)
    if main is None:
        pytest.skip(f"no {label} in this build")
    measured = length_mm(main["points"])
    m = re.search(r"\((\d+) mm\)|Last (\d+) mm", vein(manifest, label)["definition"])
    assert m, vein(manifest, label)["definition"]
    stated = float(m.group(1) or m.group(2))
    assert abs(stated - measured) <= 1.0, (label, stated, measured)


def test_anterior_cardiac_vein_count(manifest, vessels):
    n = sum(1 for sg in vessels["veins"]["segments"] if sg["label"] == "ACV" and sg.get("parent") is None)
    assert f"({n} in this model" in vein(manifest, "ACV")["definition"]


def test_tricuspid_offset_is_apical(manifest):
    facts = manifest.get("facts", {})
    assert float(facts["TV_OFFSET_MM"]) > 0.0  # the septal hinge lies apical to the anterior mitral hinge
    assert f"{facts['TV_OFFSET_MM']} mm more apically" in structure(manifest, "Valve_Tricuspid")["definition"]


def test_venous_fma_ids_are_specific(manifest):
    ids = {v["label"]: v.get("fma_id") for v in manifest["veins"]}
    assert ids["AIV"] == "FMA66403" and ids["GCV"] == "FMA4707"
    assert ids.get("RMV") == "FMA4716"
    assert len({i for i in ids.values() if i}) == len([i for i in ids.values() if i])
