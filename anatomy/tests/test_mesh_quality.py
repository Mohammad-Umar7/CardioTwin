"""Geometry QA of the published GLB: frame, orientation, winding, holes, shading normals, seating.

The meshopt-compressed GLB is decoded with ``scripts/decode_glb.mjs`` (glTF-Transform, installed by
``build.py`` into ``anatomy/node_modules``); the tests are skipped when Node or the tooling is missing.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy.spatial import cKDTree

import meshops as mo
from common import ANATOMY_DIR, GLB_NAME, PUBLIC_DIR

GLB = PUBLIC_DIR / GLB_NAME
DECODER = ANATOMY_DIR / "scripts" / "decode_glb.mjs"
NODE = shutil.which("node")
TOOLS = ANATOMY_DIR / "node_modules" / "@gltf-transform" / "core"

pytestmark = pytest.mark.skipif(
    not (GLB.exists() and NODE and TOOLS.exists()), reason="needs the built GLB, Node and anatomy/node_modules"
)

#: Open shells (the rest must be closed, outward-facing solids).
OPEN_SHELLS = {"Skin_Torso"}
#: Open edges tolerated on a closed node (non-manifold source vertices on the heart's cutting plane).
MAX_OPEN_EDGES = 8


@pytest.fixture(scope="module")
def meshes(tmp_path_factory) -> dict[str, dict]:
    out = tmp_path_factory.mktemp("decoded")
    subprocess.run([NODE, str(DECODER), str(GLB), str(out)], check=True, capture_output=True, cwd=ANATOMY_DIR)
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    result = {}
    for e in index:
        if not e.get("triangles"):
            continue
        name = e["name"]
        V = np.fromfile(out / f"{name}.pos.f32", dtype=np.float32).reshape(-1, 3).astype(np.float64)
        F = np.fromfile(out / f"{name}.idx.u32", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
        N = np.fromfile(out / f"{name}.nrm.f32", dtype=np.float32).reshape(-1, 3)
        col = out / f"{name}.col.f32"
        C = np.fromfile(col, dtype=np.float32).reshape(-1, e["col"]) if col.exists() else None
        arc = out / f"{name}.arc.f32"
        A = np.fromfile(arc, dtype=np.float32) if arc.exists() else None
        result[name] = {"V": V, "F": F, "N": N, "C": C, "A": A, "parent": e["parent"]}
    return result


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((PUBLIC_DIR / "manifest.json").read_text(encoding="utf-8"))


def welded(V: np.ndarray, F: np.ndarray) -> mo.Mesh:
    """Merge coincident vertices (normal splits at sharp edges duplicate them) and re-index the faces."""
    Vu, inv = np.unique(np.round(V, 7), axis=0, return_inverse=True)
    return Vu, inv.reshape(-1)[F]


def test_budgets(meshes):
    assert sum(len(m["F"]) for m in meshes.values()) <= 400_000
    assert GLB.stat().st_size <= 16 * 1024 * 1024  # CONTRACTS §7.1 (baked textures)


def test_scene_frame_and_heart_orientation(meshes, manifest):
    wall = np.concatenate([meshes[n]["V"] for n in ("Heart_Wall_Anterior", "Heart_Wall_Posterior")])
    lo, hi = wall.min(axis=0), wall.max(axis=0)
    assert np.all(np.abs((lo + hi) / 2) < 0.01)  # origin = heart-wall bbox centre (within 1 mm)
    assert 1.0 < float(np.max(hi - lo)) < 1.4  # ~12 cm heart at 1 unit = 10 cm
    centre = {n: m["V"].mean(axis=0) for n, m in meshes.items()}
    assert centre["Spine_Thoracic"][2] < centre["Sternum"][2] - 1.0  # spine posterior (-Z)
    assert centre["Clavicle_L"][1] > centre["Diaphragm"][1] + 2.0  # head is +Y
    assert centre["Lung_L"][0] > centre["Lung_R"][0]  # patient-left is +X
    apex, base = np.array(manifest["heart"]["apex"]), np.array(manifest["heart"]["base_center"])
    axis = apex - base
    assert axis[0] > 0 and axis[1] < 0 and axis[2] > 0  # apex left, inferior, anterior
    midline = centre["Sternum"][0]
    assert (wall[:, 0] > midline).mean() > 0.55  # most of the heart lies left of the midline


def test_closed_nodes_are_outward_and_watertight(meshes):
    for name, m in meshes.items():
        if name in OPEN_SHELLS:
            continue
        V, F = welded(m["V"], m["F"])
        assert not mo.inverted_component_faces(V, F).any(), f"{name}: inside-out component"
        e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
        _, counts = np.unique(e, axis=0, return_counts=True)
        assert int((counts == 1).sum()) <= MAX_OPEN_EDGES, f"{name}: {(counts == 1).sum()} open edges"


def test_shading_normals_agree_with_faces(meshes):
    for name, m in meshes.items():
        V, F, N = m["V"], m["F"], m["N"]
        fn = mo.face_normals(V, F)
        dots = np.einsum("fj,fkj->fk", fn, N[F])
        flipped = float((dots.min(axis=1) < -0.2).mean())
        assert flipped < 0.005, f"{name}: {flipped:.2%} faces with a vertex normal against the face"


def test_heart_walls_carry_territories(meshes):
    for name in ("Heart_Wall_Anterior", "Heart_Wall_Posterior"):
        C = meshes[name]["C"]
        assert C is not None and C.shape[1] == 3
        assert C.min() >= 0.0 and C.sum(axis=1).max() <= 1.0 + 1e-2
        assert (C.sum(axis=1) > 0.5).mean() > 0.2  # ventricles are tinted
        assert (C.sum(axis=1) < 0.05).mean() > 0.1  # atria and roots stay neutral


def test_coronary_centrelines_sit_on_the_epicardium(meshes):
    vessels = json.loads((PUBLIC_DIR / "vessels.json").read_text(encoding="utf-8"))
    wall = cKDTree(np.concatenate([meshes[n]["V"] for n in ("Heart_Wall_Anterior", "Heart_Wall_Posterior")]))
    for v in vessels["vessels"]:
        pts = np.concatenate([np.array(s["points"]) for s in v["segments"]])
        d, _ = wall.query(pts)
        limit = 0.06 if "SEPTAL" in v["id"] else 0.02  # septal perforators run inside the septum
        assert np.median(d) < limit, f"{v['id']}: median {np.median(d) * 100:.1f} mm from the wall"


def test_every_coronary_node_is_covered_by_a_centreline(meshes):
    vessels = json.loads((PUBLIC_DIR / "vessels.json").read_text(encoding="utf-8"))
    covered = {v["node"] for v in vessels["vessels"]}
    coronary = {n for n, m in meshes.items() if m["parent"] == "Layer_Coronary"}
    assert coronary == covered


def test_coronary_arc_length_runs_from_each_ostium(meshes):
    arc = {n: m["A"] for n, m in meshes.items() if m["parent"] == "Layer_Coronary"}
    assert all(a is not None and len(a) == len(meshes[n]["V"]) for n, a in arc.items()), "missing _ARCLEN"
    assert all(a.min() >= 0.0 and a.max() <= 1.0 for a in arc.values())
    # the left main starts the left tree, the RCA trunk the right tree; branches lie further down
    assert arc["Coronary_LM"].min() < 0.01 and arc["Coronary_RCA"].min() < 0.01
    assert np.median(arc["Coronary_LAD"]) > arc["Coronary_LM"].max()
    for branch in ("Coronary_RCA_PDA", "Coronary_RCA_PL"):
        assert arc[branch].min() > 0.3  # distal right-dominant branches beyond the crux
    for tree in (("Coronary_LM", "Coronary_LAD", "Coronary_LAD_Septal", "Coronary_LCX"),
                 ("Coronary_RCA", "Coronary_RCA_Marginal", "Coronary_RCA_PDA", "Coronary_RCA_PL", "Coronary_RCA_Septal")):
        assert max(arc[n].max() for n in tree) == pytest.approx(1.0, abs=0.02)  # normalised per tree
