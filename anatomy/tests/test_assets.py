"""Contract tests for the published anatomy assets in ``frontend/public/anatomy``.

These run against the committed GLB / manifest / vessels (no Blender needed) and pin the guarantees
the viewer relies on: CONTRACTS.md §6 node names and layers, COLOR_0 territories on the heart walls,
consistent model-target <-> structure mapping, and proximal->distal coronary centrelines.
"""
from __future__ import annotations

import json

import numpy as np
import pytest

from common import GLB_NAME, PUBLIC_DIR, load_config
from verify_glb import CONTRACT_LAYERS, read_gltf_json, verify

GLB = PUBLIC_DIR / GLB_NAME
MANIFEST = PUBLIC_DIR / "manifest.json"
VESSELS = PUBLIC_DIR / "vessels.json"

pytestmark = pytest.mark.skipif(
    not (GLB.exists() and MANIFEST.exists() and VESSELS.exists()),
    reason="anatomy assets not built (run anatomy/build.py)",
)

EXPECTED_TARGET = {
    "Coronary_LM": None,
    "Coronary_LAD": "LAD",
    "Coronary_LAD_Septal": "LAD",
    "Coronary_LCX": "LCX",
    "Coronary_RCA": "RCA",
    "Coronary_RCA_Marginal": "RCA",
    "Coronary_RCA_PDA": "RCA",
    "Coronary_RCA_PL": "RCA",
    "Coronary_RCA_Septal": "RCA",
}


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def vessels() -> dict:
    return json.loads(VESSELS.read_text(encoding="utf-8"))


def test_glb_satisfies_contract_and_web_budgets():
    report = verify(GLB)
    assert report["ok"], report["errors"]
    assert report["triangles_total"] <= 400_000
    assert report["bytes"] <= 8 * 1024 * 1024
    assert "COLOR_0" in report["nodes"]["Heart_Wall_Anterior"]["attributes"]
    assert "COLOR_0" in report["nodes"]["Heart_Wall_Posterior"]["attributes"]


def test_glb_node_extras_carry_ids_and_targets():
    gltf = read_gltf_json(GLB)
    extras = {n["name"]: n.get("extras", {}) for n in gltf["nodes"]}
    for node, target in EXPECTED_TARGET.items():
        assert extras[node]["ct_target"] == (target or "")
        assert extras[node]["ct_layer"] == "coronary"


def test_config_covers_every_contract_node():
    cfg_nodes = {n["node"] for n in load_config()["nodes"]}
    contract_nodes = {n for members in CONTRACT_LAYERS.values() for n in members}
    assert contract_nodes <= cfg_nodes


def test_manifest_layers_and_structures_match_contract(manifest):
    assert manifest["glb"] == GLB_NAME and manifest["version"]
    assert "BodyParts3D" in manifest["credits"]
    layer_nodes = {layer["node"] for layer in manifest["layers"]}
    assert layer_nodes == set(CONTRACT_LAYERS)
    ids = [s["id"] for s in manifest["structures"]]
    assert len(ids) == len(set(ids))
    by_node = {s["node"]: s for s in manifest["structures"]}
    for layer in manifest["layers"]:
        assert len(layer["explode"]) == 3
        for node in CONTRACT_LAYERS[layer["node"]]:
            assert by_node[node]["layer"] == layer["id"]
            assert node in layer["nodes"]
    for s in manifest["structures"]:
        assert len(s["explode"]) == 3 and s["label"] and s["description"]
        lo, hi = np.array(s["bbox"]["min"]), np.array(s["bbox"]["max"])
        assert np.all(hi > lo)


def test_manifest_target_mapping_is_consistent(manifest):
    by_node = {s["node"]: s for s in manifest["structures"]}
    for node, target in EXPECTED_TARGET.items():
        assert by_node[node]["target"] == target
    for target in ("LAD", "LCX", "RCA"):
        assert manifest["targets"][target], target
        assert all(by_node[n]["target"] == target for n in manifest["targets"][target])
    assert set(manifest["targets"]["CAD"]) == {"Heart_Wall_Anterior", "Heart_Wall_Posterior"}
    assert manifest["territories"]["channels"] == {"r": "LAD", "g": "LCX", "b": "RCA"}
    assert "NOT a lesion map" in manifest["territories"]["interpretation"]


def test_manifest_camera_presets(manifest):
    cam = manifest["camera"]
    for key in ("home", "heart", "exploded"):
        assert len(cam[key]["position"]) == 3 and len(cam[key]["target"]) == 3
    for s in manifest["structures"]:
        preset = cam["focus"][s["id"]]
        pos, tgt = np.array(preset["position"]), np.array(preset["target"])
        assert np.linalg.norm(pos - tgt) > 1.0  # camera outside the structure
        assert np.allclose(tgt, s["center"], atol=1e-3)


def test_heart_opens_like_a_book_with_vessels_riding_on_their_half(manifest):
    by_node = {s["node"]: s for s in manifest["structures"]}
    n = np.array(manifest["heart"]["cut_plane"]["normal"])
    assert n[2] > 0.5  # the cut normal faces anteriorly (+Z)
    ant = np.array(by_node["Heart_Wall_Anterior"]["explode"])
    post = np.array(by_node["Heart_Wall_Posterior"]["explode"])
    assert np.dot(ant - post, n) > 0.5  # the halves separate along the cut normal (>= 5 cm)
    assert ant[2] > 0.3 and ant[0] < -0.3  # anterior half swings towards the viewer and to patient-right
    cut_point = np.array(manifest["heart"]["cut_plane"]["point"])
    for s in manifest["structures"]:
        if s["layer"] == "coronary" or s["node"] == "CardiacVeins":
            side = ant if (np.array(s["center"]) - cut_point) @ n >= 0 else post
            assert np.allclose(s["explode"], side, atol=1e-4), s["node"]  # seated on its half


def test_exploded_layout_separates_chest_wall_from_lungs_and_is_framed(manifest):
    layer = {lay["id"]: np.array(lay["explode"]) for lay in manifest["layers"]}
    by_node = {s["node"]: s for s in manifest["structures"]}

    def box(node: str) -> tuple[np.ndarray, np.ndarray]:
        s = by_node[node]
        off = layer[s["layer"]] + np.array(s["explode"])
        return np.array(s["bbox"]["min"]) + off, np.array(s["bbox"]["max"]) + off

    for side, sign in (("L", 1), ("R", -1)):
        ribs, lung = box(f"Ribs_{side}"), box(f"Lung_{side}")
        # the half rib cage ends up entirely lateral to its lung (bounding boxes do not overlap in X)
        assert (ribs[0][0] > lung[1][0]) if sign > 0 else (ribs[1][0] < lung[0][0])
    cam = manifest["camera"]["exploded"]
    assert np.linalg.norm(np.array(cam["position"]) - np.array(cam["target"])) > np.linalg.norm(
        np.array(manifest["camera"]["home"]["position"]) - np.array(manifest["camera"]["home"]["target"])
    )


def test_vessels_cover_every_coronary_node_with_targets(vessels, manifest):
    assert vessels["units"] == "scene"
    by_node = {v["node"]: v for v in vessels["vessels"]}
    assert set(by_node) == set(EXPECTED_TARGET)
    for node, target in EXPECTED_TARGET.items():
        assert by_node[node]["target"] == target
    manifest_targets = {s["node"]: s["target"] for s in manifest["structures"]}
    for node, v in by_node.items():
        assert v["target"] == manifest_targets[node]


def test_vessel_segments_are_well_formed(vessels, manifest):
    bbox = {s["node"]: (np.array(s["bbox"]["min"]), np.array(s["bbox"]["max"])) for s in manifest["structures"]}
    for v in vessels["vessels"]:
        lo, hi = bbox[v["node"]]
        assert v["segments"], v["id"]
        for i, seg in enumerate(v["segments"]):
            pts, r = np.array(seg["points"]), np.array(seg["radius"])
            assert pts.shape[1] == 3 and len(pts) == len(r) >= 2
            assert np.all(r > 0) and np.all(r < 0.05)  # < 5 mm lumen radius
            assert seg["parent"] is None or 0 <= seg["parent"] < i
            own = pts[1:] if seg.get("attach") else pts
            assert np.all(own >= lo - 0.02) and np.all(own <= hi + 0.02), (v["id"], i)
            steps = np.linalg.norm(np.diff(pts, axis=0), axis=1)
            assert steps.max() < 3 * vessels["spacing"]


def test_vessels_flow_proximal_to_distal_from_their_parent(vessels):
    by_id = {v["id"]: v for v in vessels["vessels"]}
    assert by_id["LM"]["parent"] == "aorta" and by_id["RCA"]["parent"] == "aorta"
    assert by_id["LAD"]["parent"] == "LM" and by_id["LCX"]["parent"] == "LM"
    for vid in ("RCA_MARGINAL", "RCA_PDA", "RCA_PL"):
        assert by_id[vid]["parent"] == "RCA"
    for v in vessels["vessels"]:
        if v["parent"] == "aorta":
            continue
        parent_pts = np.vstack([np.array(s["points"]) for s in by_id[v["parent"]]["segments"]])
        for seg in v["segments"]:
            if seg.get("attach"):
                start = np.array(seg["points"][0])
                end = np.array(seg["points"][-1])
                d_start = np.min(np.linalg.norm(parent_pts - start, axis=1))
                d_end = np.min(np.linalg.norm(parent_pts - end, axis=1))
                assert d_start < 0.002, v["id"]  # starts on the parent's centreline (< 0.2 mm)
                assert d_end > d_start  # and flows away from it


def test_design_system_additive_fields(manifest, vessels):
    by_node = {s["node"]: s for s in manifest["structures"]}
    walls = {"Heart_Wall_Anterior", "Heart_Wall_Posterior"}
    for s in manifest["structures"]:
        if s["layer"] == "coronary" or s["node"] == "CardiacVeins":
            assert s["rides"] in walls, s["node"]
        if "rides" in s:  # a structure riding on a wall moves exactly with it
            assert np.allclose(s["explode"], by_node[s["rides"]]["explode"], atol=1e-4), s["node"]
    lines = {v["node"]: np.vstack([np.array(seg["points"]) for seg in v["segments"]]) for v in vessels["vessels"]}
    for node, target in (("Coronary_LAD", "LAD"), ("Coronary_LCX", "LCX"), ("Coronary_RCA", "RCA")):
        s = by_node[node]
        anchor, normal = np.array(s["labelAnchor"]), np.array(s["labelNormal"])
        assert np.min(np.linalg.norm(lines[node] - anchor, axis=1)) < 1e-3  # on the vessel's centreline
        assert np.linalg.norm(normal) == pytest.approx(1.0, abs=1e-3)
        assert set(s["bestView"]) == {"azimuth", "elevation", "distance"} and s["bestView"]["distance"] > 2.0
    # radiological sanity: the LAD label faces the viewer, the LCX label the patient's left and back
    assert by_node["Coronary_LAD"]["labelNormal"][2] > 0.3
    assert by_node["Coronary_LCX"]["labelNormal"][0] > 0.3 and by_node["Coronary_LCX"]["labelNormal"][2] < 0
    assert by_node["Coronary_RCA"]["labelNormal"][0] < 0
