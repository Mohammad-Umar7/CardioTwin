#!/usr/bin/env python
"""Measure the CardioTwin 3D anatomy against the anatomical reference.

Evaluates every check of ``anatomy/checks/reference_checks.yaml`` (facts and sources in
``docs/anatomy/REFERENCE.md``) on the CURRENT published assets and grades each one PASS / MINOR / FAIL
with the measured numbers. Read-only: it never writes into the repository unless you pass an output
path there yourself.

Run (from the repository root)::

    ./.venv/Scripts/python anatomy/checks/measure_model.py                      # console table
    ./.venv/Scripts/python anatomy/checks/measure_model.py --markdown out.md    # markdown table
    ./.venv/Scripts/python anatomy/checks/measure_model.py --json out.json      # every number
    ./.venv/Scripts/python anatomy/checks/measure_model.py --raw                # use the uncompressed
                                                                                 # anatomy/build/*.raw.glb

Inputs
    * ``frontend/public/anatomy/cardiotwin_anatomy.glb`` (meshopt-compressed). It is decoded with
      ``anatomy/scripts/decode_glb.mjs`` (Node + ``anatomy/node_modules``) into a temporary directory
      OUTSIDE the repository. Without Node, ``--raw`` reads ``anatomy/build/cardiotwin_anatomy.raw.glb``
      (plain glTF buffers) with the built-in reader below.
    * ``frontend/public/anatomy/manifest.json`` and ``vessels.json``.
    * Optional: ``anatomy/raw/FMA*.stl`` (the git-ignored BodyParts3D cache) to name the connected
      components of ``CardiacVeins`` (coronary sinus, great / middle / anterior / posterior-LV veins).
      Without it the components are named by their companion artery.
    * Optional: ``frontend/src`` colour tokens, to check whether the web viewer overrides the glTF
      colour conventions.

Requirements: the project virtualenv (numpy, scipy, trimesh, rtree, networkx, scikit-image, PyYAML).
Runtime is about 3-5 minutes (most of it in the POS-09 penetration pairs).

Grading
    PASS   every sub-metric is inside the accepted band of reference_checks.yaml.
    MINOR  only soft (population-statistic) sub-metrics miss, each by less than half the band width
           (or a soft yes/no criterion fails).
    FAIL   a hard (anatomical-invariant) sub-metric misses, a soft one misses by half the band width
           or more, or the structure / attribute needed for the check is not in the model.
    N/A    the check only applies to an optional structure that the default phenotype omits.

Operational definitions follow the YAML ``landmarks`` section. Where the YAML definition does not work
on this mesh, the choice made here is stated in the check's ``note``:
    * H_epi: heart-wall faces whose outward normal ray (marched through a 0.8 mm occupancy grid) never
      hits the heart wall again.
    * Valve annuli: hinge rings = valve vertices within 1 mm of the heart wall (basal quartile along u_ba
      for the AV valves, proximal half for the pulmonary valve), plane + circle fit. The YAML fallback
      ("25% of vertices closest to the base") picks leaflet/chordal tissue on these closed valve solids.
    * Aortic annulus: the flat, oblique proximal cap of GreatVessel_Aorta (support-plane search); ostial
      heights are distances from that plane measured along root_axis.
    * Carina: the tracheal lumen is tracked downward from the top cut; the bronchial tree rises lateral to
      the trachea, so a plain "first two-loop section" is wrong on this mesh.
    * PA branch lengths: bifurcation -> entry into the ipsilateral lung solid.
    * AHA-17 rings: basal = annulus to papillary tips (5th percentile of t), mid = to papillary bases
      (95th percentile of t) of the LV papillary muscles; the YAML text has the two bounds swapped.
    * Cavity samples: outside the myocardium, > 4 mm from the wall surface, nearest wall face endocardial
      and walled in along 14 directions within 4 cm.
    * Cardiac veins: CardiacVeins is split into its connected components, named from the BodyParts3D
      source parts when anatomy/raw is present, and skeletonised at 0.4 mm.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx
import numpy as np
import trimesh
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

try:  # skeletons of the great vessels and cardiac veins
    from skimage.morphology import skeletonize
except ImportError:  # pragma: no cover
    skeletonize = None

REPO = Path(os.environ.get("CARDIOTWIN_REPO") or Path(__file__).resolve().parents[2]).resolve()
PUBLIC = REPO / "frontend" / "public" / "anatomy"
GLB = PUBLIC / "cardiotwin_anatomy.glb"
RAW_GLB = REPO / "anatomy" / "build" / "cardiotwin_anatomy.raw.glb"
DECODER = REPO / "anatomy" / "scripts" / "decode_glb.mjs"
RAW_DIR = REPO / "anatomy" / "raw"
YAML = REPO / "anatomy" / "checks" / "reference_checks.yaml"
FRONTEND = REPO / "frontend" / "src"

MM = 0.01  # scene units per millimetre
#: BodyParts3D part -> cardiac-vein name (anatomy/SOURCES.md).
VEIN_PARTS = {"FMA4706": "CS", "FMA4707": "GCV", "FMA4713": "MCV", "FMA71567": "ACV", "FMA76751": "PVLV"}


# =============================================================================================
# Loading
# =============================================================================================
@dataclass
class Mesh:
    name: str
    V: np.ndarray  # (n, 3) world positions (scene frame)
    F: np.ndarray  # (m, 3)
    N: np.ndarray | None = None
    C: np.ndarray | None = None  # COLOR_0
    extras: dict = field(default_factory=dict)
    A: dict = field(default_factory=dict)  # extra per-vertex attributes: "seg" (_SEGMENT), "vein" (_VEIN)
    _tm: trimesh.Trimesh | None = None

    @property
    def tm(self) -> trimesh.Trimesh:
        """Welded trimesh (normal splits duplicate vertices in the glTF)."""
        if self._tm is None:
            Vw, Fw = weld(self.V, self.F)
            self._tm = trimesh.Trimesh(Vw, Fw, process=False)
        return self._tm


def decode_with_node(glb: Path) -> tuple[dict[str, Mesh], str]:
    node = shutil.which("node")
    if not (node and DECODER.exists() and (REPO / "anatomy" / "node_modules" / "@gltf-transform" / "core").exists()):
        raise RuntimeError("Node or anatomy/node_modules missing")
    out = Path(tempfile.mkdtemp(prefix="cardiotwin_measure_"))
    try:
        subprocess.run([node, str(DECODER), str(glb), str(out)], check=True, capture_output=True, cwd=REPO / "anatomy")
        index = json.loads((out / "index.json").read_text(encoding="utf-8"))
        meshes = {}
        for e in index:
            if not e.get("triangles"):
                continue
            n = e["name"]
            V = np.fromfile(out / f"{n}.pos.f32", dtype=np.float32).reshape(-1, 3).astype(np.float64)
            F = np.fromfile(out / f"{n}.idx.u32", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
            N = np.fromfile(out / f"{n}.nrm.f32", dtype=np.float32).reshape(-1, 3).astype(np.float64)
            col = out / f"{n}.col.f32"
            C = np.fromfile(col, dtype=np.float32).reshape(-1, e["col"]).astype(np.float64) if col.exists() else None
            A = {k: np.fromfile(out / f"{n}.{k}.f32", dtype=np.float32).astype(np.float64)
                 for k in ("seg", "vein") if (out / f"{n}.{k}.f32").exists()}
            meshes[n] = Mesh(n, V, F, N, C, e.get("extras") or {}, A)
    finally:
        shutil.rmtree(out, ignore_errors=True)
    return meshes, f"{glb.relative_to(REPO)} (decoded with anatomy/scripts/decode_glb.mjs)"


_CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_plain_glb(glb: Path) -> tuple[dict[str, Mesh], dict]:
    """Minimal glTF 2.0 binary reader for UNcompressed buffers (the Blender raw export)."""
    b = glb.read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    gj = json.loads(b[20 : 20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", b[off : off + 4])[0]
    binc = b[off + 8 : off + 8 + blen]
    if "EXT_meshopt_compression" in (gj.get("extensionsRequired") or []):
        raise RuntimeError(f"{glb} is meshopt-compressed; use Node decoding or --raw")

    def acc(i: int) -> np.ndarray:
        a = gj["accessors"][i]
        bv = gj["bufferViews"][a["bufferView"]]
        dt = np.dtype(_CTYPE[a["componentType"]])
        k = _NCOMP[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", dt.itemsize * k)
        raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * k, offset=start)
        arr = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dt.itemsize * k), strides=(stride, 1)).copy()
        out = arr.view(dt).reshape(a["count"], k).astype(np.float64)
        if a.get("normalized"):
            out /= float(np.iinfo(dt).max)
        return out

    def local(n: dict) -> np.ndarray:
        if "matrix" in n:
            return np.array(n["matrix"], dtype=float).reshape(4, 4).T
        T = np.eye(4)
        x, y, z, w = n.get("rotation", [0, 0, 0, 1])
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        T[:3, :3] = R * np.array(n.get("scale", [1, 1, 1]))
        T[:3, 3] = n.get("translation", [0, 0, 0])
        return T

    parent = {c: i for i, n in enumerate(gj["nodes"]) for c in n.get("children", [])}

    def world(i: int) -> np.ndarray:
        T = local(gj["nodes"][i])
        while i in parent:
            i = parent[i]
            T = local(gj["nodes"][i]) @ T
        return T

    meshes = {}
    for i, n in enumerate(gj["nodes"]):
        if "mesh" not in n:
            continue
        prim = gj["meshes"][n["mesh"]]["primitives"][0]
        T = world(i)
        V = acc(prim["attributes"]["POSITION"]) @ T[:3, :3].T + T[:3, 3]
        N = acc(prim["attributes"]["NORMAL"]) @ T[:3, :3].T if "NORMAL" in prim["attributes"] else None
        C = acc(prim["attributes"]["COLOR_0"])[:, :3] if "COLOR_0" in prim["attributes"] else None
        F = acc(prim["indices"]).astype(np.int64).reshape(-1, 3)
        meshes[n["name"]] = Mesh(n["name"], V, F, N, C, n.get("extras") or {})
    return meshes, gj


def glb_json(glb: Path) -> dict:
    b = glb.read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20 : 20 + jlen])


# =============================================================================================
# Geometry helpers
# =============================================================================================
def weld(V: np.ndarray, F: np.ndarray, decimals: int = 6) -> tuple[np.ndarray, np.ndarray]:
    Vu, inv = np.unique(np.round(V, decimals), axis=0, return_inverse=True)
    return Vu, inv.reshape(-1)[F]


def components(V: np.ndarray, F: np.ndarray, min_vertices: int = 1) -> list[tuple[np.ndarray, np.ndarray]]:
    """Connected components after welding -> list of (vertices, faces) with local indices."""
    Vw, Fw = weld(V, F)
    n = len(Vw)
    r = np.concatenate([Fw[:, 0], Fw[:, 1], Fw[:, 2]])
    c = np.concatenate([Fw[:, 1], Fw[:, 2], Fw[:, 0]])
    k, lab = connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(n, n)), directed=False)
    out = []
    flab = lab[Fw[:, 0]]
    for i in range(k):
        vid = np.flatnonzero(lab == i)
        if len(vid) < min_vertices:
            continue
        remap = -np.ones(n, dtype=np.int64)
        remap[vid] = np.arange(len(vid))
        out.append((Vw[vid], remap[Fw[flab == i]]))
    return out


def vertex_areas(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    a = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    out = np.zeros(len(V))
    for k in range(3):
        np.add.at(out, F[:, k], a / 3.0)
    return out


def dense_points(V: np.ndarray, F: np.ndarray, spacing: float) -> np.ndarray:
    """Surface samples no further than ``spacing`` apart (edge subdivision + face centroids)."""
    Vs, Fs = trimesh.remesh.subdivide_to_size(V, F, max_edge=spacing, max_iter=12)
    return np.vstack([Vs, Vs[Fs].mean(axis=1)])


def arclen(P: np.ndarray) -> np.ndarray:
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def at_s(P: np.ndarray, s: float) -> np.ndarray:
    d = arclen(P)
    return np.array([np.interp(s, d, P[:, k]) for k in range(3)])


def angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def unit(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v) + 1e-12)


def fit_plane(P: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = P.mean(axis=0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    return c, vt[2]


@dataclass
class Ring:
    """Annulus: circle of radius R about centre c, in the plane with unit normal n."""

    c: np.ndarray
    n: np.ndarray
    R: float
    pts: np.ndarray  # the ring vertices used for the fit

    @property
    def D(self) -> float:
        return 2.0 * self.R

    def samples(self, k: int = 180) -> np.ndarray:
        a = unit(np.cross(self.n, [1.0, 0.0, 0.0] if abs(self.n[0]) < 0.9 else [0.0, 1.0, 0.0]))
        b = np.cross(self.n, a)
        t = np.linspace(0, 2 * np.pi, k, endpoint=False)
        return self.c + self.R * (np.outer(np.cos(t), a) + np.outer(np.sin(t), b))

    def dist(self, P: np.ndarray) -> np.ndarray:
        d = P - self.c
        h = d @ self.n
        rho = np.linalg.norm(d - np.outer(h, self.n), axis=1)
        return np.sqrt((rho - self.R) ** 2 + h**2)


def fit_ring(P: np.ndarray, normal_hint: np.ndarray | None = None) -> Ring:
    c0, n = fit_plane(P)
    if normal_hint is not None and np.dot(n, normal_hint) < 0:
        n = -n
    a = unit(np.cross(n, [1.0, 0.0, 0.0] if abs(n[0]) < 0.9 else [0.0, 1.0, 0.0]))
    b = np.cross(n, a)
    x, y = (P - c0) @ a, (P - c0) @ b
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    sol, *_ = np.linalg.lstsq(A, x**2 + y**2, rcond=None)
    cx, cy = sol[0], sol[1]
    R = math.sqrt(max(sol[2] + cx * cx + cy * cy, 1e-12))
    return Ring(c0 + cx * a + cy * b, n, R, P)


def support_cap(V: np.ndarray, around: np.ndarray, axis_hint: np.ndarray, max_tilt: float = 75.0,
                tol: float = 0.004, radius: float = 0.3) -> tuple[np.ndarray, np.ndarray]:
    """Flat end cap of a tube: the supporting plane (outward normal within max_tilt of axis_hint) that
    touches the most vertices near ``around``. Returns (outward normal, cap vertices)."""
    near = V[np.linalg.norm(V - around, axis=1) < radius]
    k = 4000
    i = np.arange(k) + 0.5
    phi, th = np.arccos(1 - 2 * i / k), np.pi * (1 + 5**0.5) * i
    D = np.c_[np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)]
    D = D[D @ unit(axis_hint) >= math.cos(math.radians(max_tilt))]
    H = near @ D.T
    cnt = (H >= H.max(axis=0) - tol).sum(axis=0)
    j = int(np.argmax(cnt))
    n = D[j]
    return n, near[near @ n >= (near @ n).max() - tol]


def signed_distance(tm: trimesh.Trimesh, P: np.ndarray) -> np.ndarray:
    """Distance to the surface, positive outside (sign from the nearest face's outward normal)."""
    if len(P) == 0:
        return np.zeros(0)
    cp, d, tri = trimesh.proximity.closest_point(tm, P)
    s = np.einsum("ij,ij->i", P - cp, tm.face_normals[tri])
    return np.where(s < 0, -d, d)


def penetration_depth(tm: trimesh.Trimesh, P: np.ndarray, confirm: bool = True) -> np.ndarray:
    """Depth of each point inside the closed mesh (0 outside). Nearest-face signs are confirmed with a
    ray-parity inside test, because the nearest-face sign is unreliable next to edges and vertices."""
    out = np.zeros(len(P))
    if len(P) == 0:
        return out
    sd = signed_distance(tm, P)
    neg = np.flatnonzero(sd < -1e-4)
    deep = neg[-sd[neg] > 0.004]  # shallower mis-signs cannot exceed the 0.005 u tolerance
    if len(deep) and confirm:
        ok = tm.contains(P[deep])
        out[deep[ok]] = -sd[deep[ok]]
        neg = np.setdiff1d(neg, deep)
    out[neg] = -sd[neg]
    return out


class Grid:
    """Axis-aligned voxel grid used for occupancy, ray marching and skeletons."""

    def __init__(self, lo: np.ndarray, hi: np.ndarray, pitch: float, pad: int = 3):
        self.pitch = pitch
        self.origin = np.asarray(lo, float) - pad * pitch
        self.shape = tuple(np.ceil((np.asarray(hi) - self.origin) / pitch).astype(int) + pad + 1)

    def index(self, P: np.ndarray) -> np.ndarray:
        return np.floor((P - self.origin) / self.pitch).astype(np.int64)

    def inside_bounds(self, ijk: np.ndarray) -> np.ndarray:
        return np.all((ijk >= 0) & (ijk < np.array(self.shape)), axis=1)

    def rasterize(self, P: np.ndarray) -> np.ndarray:
        g = np.zeros(self.shape, dtype=bool)
        ijk = self.index(P)
        ok = self.inside_bounds(ijk)
        g[tuple(ijk[ok].T)] = True
        return g

    def lookup(self, g: np.ndarray, P: np.ndarray) -> np.ndarray:
        ijk = self.index(P)
        ok = self.inside_bounds(ijk)
        out = np.zeros(len(P), dtype=bool)
        out[ok] = g[tuple(ijk[ok].T)]
        return out

    def centers(self, ijk: np.ndarray) -> np.ndarray:
        return self.origin + (ijk + 0.5) * self.pitch


def solid_grid(V: np.ndarray, F: np.ndarray, pitch: float, grid: Grid | None = None) -> tuple[Grid, np.ndarray]:
    """Filled occupancy of a closed mesh (shell dilated by one voxel before filling, then eroded)."""
    grid = grid or Grid(V.min(axis=0), V.max(axis=0), pitch)
    shell = grid.rasterize(dense_points(V, F, pitch * 0.7))
    shell = ndimage.binary_dilation(shell)
    solid = ndimage.binary_fill_holes(shell)
    return grid, ndimage.binary_erosion(solid) | grid.rasterize(V)


def march_hits(grid: Grid, occ: np.ndarray, O: np.ndarray, D: np.ndarray, skip: float, max_len: float) -> np.ndarray:
    """True where the ray O + t D (t in [skip, max_len]) enters an occupied voxel."""
    step = grid.pitch * 0.5
    ts = np.arange(skip, max_len, step)
    hit = np.zeros(len(O), dtype=bool)
    for c0 in range(0, len(O), 4000):
        o, d = O[c0 : c0 + 4000], D[c0 : c0 + 4000]
        live = np.ones(len(o), dtype=bool)
        for t0 in range(0, len(ts), 64):
            tt = ts[t0 : t0 + 64]
            P = o[:, None, :] + d[:, None, :] * tt[None, :, None]
            ijk = grid.index(P.reshape(-1, 3))
            ok = grid.inside_bounds(ijk)
            h = np.zeros(len(ijk), dtype=bool)
            h[ok] = occ[tuple(ijk[ok].T)]
            h = h.reshape(len(o), len(tt)).any(axis=1)
            hit[c0 : c0 + 4000] |= h & live
            live &= ~h
            if not ok.reshape(len(o), len(tt))[:, -1].any() and not live.any():
                break
    return hit


# ---------------------------------------------------------------------------------------------
# Skeletons (voxel medial axis -> tree)
# ---------------------------------------------------------------------------------------------
@dataclass
class Skeleton:
    pos: np.ndarray  # node positions
    graph: nx.Graph  # minimum spanning forest of the 26-connected skeleton
    radius: np.ndarray  # distance from each node to the mesh surface

    def path(self, a: int, b: int) -> list[int]:
        return nx.shortest_path(self.graph, a, b, weight="weight")

    def endpoints(self) -> list[int]:
        return [n for n, d in self.graph.degree() if d == 1]

    def farthest(self, a: int) -> tuple[int, float]:
        dist = nx.single_source_dijkstra_path_length(self.graph, a, weight="weight")
        b = max(dist, key=dist.get)
        return b, dist[b]


def skeleton_of(V: np.ndarray, F: np.ndarray, pitch: float, tm: trimesh.Trimesh | None = None) -> Skeleton:
    if skeletonize is None:
        raise RuntimeError("scikit-image is required for skeletons")
    grid, solid = solid_grid(V, F, pitch)
    skel = skeletonize(solid)
    idx = np.argwhere(skel)
    pos = grid.centers(idx)
    lookup = {tuple(v): i for i, v in enumerate(idx)}
    g = nx.Graph()
    g.add_nodes_from(range(len(idx)))
    offs = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]
    for i, (x, y, z) in enumerate(idx):
        for dx, dy, dz in offs:
            j = lookup.get((x + dx, y + dy, z + dz))
            if j is not None:
                g.add_edge(i, j, weight=pitch * math.sqrt(dx * dx + dy * dy + dz * dz))
    g = nx.minimum_spanning_tree(g, weight="weight")
    tm = tm or trimesh.Trimesh(*weld(V, F), process=False)
    _, r, _ = trimesh.proximity.closest_point(tm, pos) if len(pos) else (None, np.zeros(0), None)
    # prune spurs shorter than 2 local radii (wall noise), a few passes
    for _ in range(3):
        removed = False
        for e in [n for n, d in g.degree() if d == 1]:
            chain, cur, length = [e], e, 0.0
            while True:
                nb = [m for m in g.neighbors(cur) if m not in chain]
                if len(nb) != 1 or g.degree(cur) > 2 and cur != e:
                    break
                length += g[cur][nb[0]]["weight"]
                cur = nb[0]
                if g.degree(cur) > 2:
                    break
                chain.append(cur)
            if g.degree(cur) > 2 and length < 2.0 * max(r[cur], pitch):
                g.remove_nodes_from(chain)
                removed = True
        if not removed:
            break
    keep = sorted(g.nodes)
    remap = {old: new for new, old in enumerate(keep)}
    g2 = nx.relabel_nodes(g, remap)
    return Skeleton(pos[keep], g2, np.asarray(r)[keep])


def smooth_path(P: np.ndarray, win: int = 5) -> np.ndarray:
    if len(P) < win:
        return P
    Q = ndimage.uniform_filter1d(P, size=win, axis=0, mode="nearest")
    Q[0], Q[-1] = P[0], P[-1]
    return Q


def resample(P: np.ndarray, spacing: float) -> np.ndarray:
    d = arclen(P)
    n = max(2, int(round(d[-1] / spacing)) + 1)
    t = np.linspace(0, d[-1], n)
    return np.column_stack([np.interp(t, d, P[:, k]) for k in range(3)])


# ---------------------------------------------------------------------------------------------
# Loops of a planar mesh section (carina)
# ---------------------------------------------------------------------------------------------
def section_loops(tm: trimesh.Trimesh, y: float) -> list[np.ndarray]:
    seg = trimesh.intersections.mesh_plane(tm, plane_normal=[0, 1, 0], plane_origin=[0, y, 0])
    if len(seg) == 0:
        return []
    pts = seg.reshape(-1, 3)
    key, inv = np.unique(np.round(pts, 6), axis=0, return_inverse=True)
    inv = inv.reshape(-1, 2)
    n = len(key)
    k, lab = connected_components(coo_matrix((np.ones(len(inv)), (inv[:, 0], inv[:, 1])), shape=(n, n)), directed=False)
    loops = []
    for i in range(k):
        vid = np.flatnonzero(lab == i)
        if len(vid) < 6:
            continue
        g = nx.Graph()
        e = inv[lab[inv[:, 0]] == i]
        g.add_edges_from(map(tuple, e))
        try:
            cyc = [u for u, _ in nx.find_cycle(g)]
        except nx.NetworkXNoCycle:
            cyc = list(nx.dfs_preorder_nodes(g))
        loops.append(key[cyc][:, [0, 2]])
    return loops


def polygon_area(P2: np.ndarray) -> float:
    x, z = P2[:, 0], P2[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(z, -1)) - np.dot(z, np.roll(x, -1)))


# =============================================================================================
# Vessels (vessels.json)
# =============================================================================================
@dataclass
class Seg:
    P: np.ndarray
    r: np.ndarray
    parent: int | None
    attach: str | None

    @property
    def L(self) -> float:
        return float(arclen(self.P)[-1])

    @property
    def s(self) -> np.ndarray:
        return arclen(self.P)

    def d0(self) -> float:
        """Origin diameter: median radius of points 2..6 (the first point sits on the parent)."""
        return float(2 * np.median(self.r[1:6])) if len(self.r) > 2 else float(2 * self.r[0])


def load_vessels(path: Path) -> dict[str, dict]:
    vj = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for v in vj["vessels"]:
        segs = []
        for s in v["segments"]:
            r = s.get("radius", s.get("radii"))
            P = np.asarray(s["points"], float)
            r = np.full(len(P), float(r)) if np.isscalar(r) else np.asarray(r, float)
            segs.append(Seg(P, r, s.get("parent"), s.get("attach")))
        out[v["id"]] = {"node": v["node"], "parent": v.get("parent"), "segments": segs, "raw": v}
    return out


# =============================================================================================
# Check bookkeeping and grading
# =============================================================================================
@dataclass
class Sub:
    name: str
    value: object
    ok: bool
    expected: str
    severity: str
    miss: float = 0.0  # fraction of the band width by which a numeric value misses
    text: str = ""


@dataclass
class Check:
    id: str
    title: str
    severity: str
    subs: list[Sub] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    absent: bool = False
    na: bool = False

    def band(self, name, value, lo=None, hi=None, unit="u", severity=None, fmt="{:.3f}", typical=None):
        value = float(value) if value is not None and not (isinstance(value, float) and math.isnan(value)) else float("nan")
        ok = not math.isnan(value) and (lo is None or value >= lo) and (hi is None or value <= hi)
        width = (hi - lo) if (lo is not None and hi is not None) else abs(lo if lo is not None else hi) or 1.0
        miss = 0.0
        if not ok and not math.isnan(value):
            miss = ((lo - value) if (lo is not None and value < lo) else (value - hi)) / (width or 1.0)
        elif math.isnan(value):
            miss = float("inf")
        rng = f"[{'' if lo is None else fmt.format(lo)}, {'' if hi is None else fmt.format(hi)}]"
        exp = f"{name} {rng}{(' ' + unit) if unit else ''}" + (f" (typ {typical})" if typical is not None else "")
        sev = severity or self.severity
        if not ok and unit == "u" and not math.isnan(value):
            gap = (lo - value) if (lo is not None and value < lo) else (value - hi)
            if gap <= 0.005:  # within mesh / centreline resolution (reference_checks.yaml: 0.005 u noise)
                sev, miss = "soft", min(miss, 0.49)
        self.subs.append(Sub(name, value, ok, exp, sev, miss, f"{name} = {fmt.format(value)}"))
        return ok

    def cond(self, name, ok, expected, text, severity=None):
        # a failed yes/no criterion is FAIL when hard and MINOR when soft
        self.subs.append(Sub(name, bool(ok), bool(ok), expected, severity or self.severity, 0.0, text))
        return bool(ok)

    def note(self, s: str):
        self.notes.append(s)

    @property
    def verdict(self) -> str:
        if self.na:
            return "N/A"
        if self.absent:
            return "FAIL"
        worst = "PASS"
        for s in self.subs:
            if s.ok:
                continue
            if s.severity == "hard" or s.miss >= 0.5:
                return "FAIL"
            worst = "MINOR"
        return worst

    def expected_text(self) -> str:
        return "; ".join(s.expected for s in self.subs)

    def measured_text(self) -> str:
        parts = [(s.text + ("" if s.ok else " ✗")) for s in self.subs]
        return "; ".join(parts)


# =============================================================================================
# The model: meshes + landmarks
# =============================================================================================
class Model:
    def __init__(self, meshes: dict[str, Mesh], manifest: dict, vessels: dict, source: str):
        self.m, self.manifest, self.v, self.source = meshes, manifest, vessels, source
        self.t0 = time.time()
        self.log(f"loaded {len(meshes)} meshes from {source}")
        self._landmarks()

    def log(self, s: str):
        print(f"[{time.time() - getattr(self, 't0', time.time()):6.1f}s] {s}", file=sys.stderr, flush=True)

    # -----------------------------------------------------------------------------------------
    def _landmarks(self):
        m = self.m
        ha, hp = m["Heart_Wall_Anterior"], m["Heart_Wall_Posterior"]
        self.H = np.vstack([ha.V, hp.V])
        self.HF = np.vstack([ha.F, hp.F + len(ha.V)])
        self.HC = np.vstack([ha.C[:, :3], hp.C[:, :3]]) if ha.C is not None and hp.C is not None else None
        self.H_tm = trimesh.Trimesh(*weld(self.H, self.HF), process=False)
        # ---- midline, sternum
        st = m["Sternum"].V
        self.X_mid = float(np.median(st[:, 0]))
        self.spine_mean_x = float(m["Spine_Thoracic"].V[:, 0].mean())
        self.Y_JN = float(st[:, 1].max())
        # ---- vertebrae
        vs = [c for c in components(m["Spine_Thoracic"].V, m["Spine_Thoracic"].F, 200)]
        vs.sort(key=lambda c: -len(c[0]))
        vs = sorted(vs[:12], key=lambda c: -c[0][:, 1].mean())
        self.vert = []
        for V, _ in vs:
            body = V[V[:, 2] > np.median(V[:, 2])]
            top, bot = float(body[:, 1].max()), float(body[:, 1].min())
            self.vert.append({"top": top, "bottom": bot, "mid": (top + bot) / 2, "x": float(V[:, 0].mean()), "z": float(body[:, 2].mean())})
        # ---- ribs
        self.ribs = {}
        for side in ("L", "R"):
            rc = components(m[f"Ribs_{side}"].V, m[f"Ribs_{side}"].F, 100)
            rc.sort(key=lambda c: -c[0][:, 1].max())
            self.ribs[side] = [c[0] for c in rc]
        # ---- costal cartilages
        cc = components(m["CostalCartilage"].V, m["CostalCartilage"].F, 20)
        st_tree = cKDTree(st)
        self.cc = {"L": [], "R": []}
        for V, _ in cc:
            side = "L" if V[:, 0].mean() > self.X_mid else "R"
            d, _ = st_tree.query(V)
            se = V[d <= 0.05]
            band = (float(se[:, 1].min()), float(se[:, 1].max())) if len(se) else (float(V[:, 1].min()), float(V[:, 1].max()))
            self.cc[side].append({"V": V, "maxY": float(V[:, 1].max()), "band": band, "sternal": len(se) > 0})
        for side in ("L", "R"):
            self.cc[side].sort(key=lambda c: -c["maxY"])
        self.Y_SA = float(np.mean([np.mean(self.cc[s][1]["band"]) for s in ("L", "R")]))
        cl = m["Clavicle_L"].V
        self.MCL_L = float((cl[:, 0].min() + cl[:, 0].max()) / 2)
        # ---- heart axis
        h = self.manifest["heart"]
        self.apex = np.array(h["apex"], float)
        self.base_center = np.array(h["base_center"], float)
        self.u_ba = unit(self.apex - self.base_center)
        # ---- coronary trunks
        self.trunk = {k: v["segments"][0] for k, v in self.v.items()}
        lad = self.trunk["LAD"]
        k_ap = int(np.argmin(np.linalg.norm(lad.P - self.apex, axis=1)))
        P = lad.P[: k_ap + 1]
        order = np.argsort(P[:, 1])
        self._xlad = (P[order, 1], P[order, 0])
        # ---- H_epi (outer shell) by ray marching the face normals
        self.log("computing the epicardial shell (H_epi)")
        self._epi()
        # ---- valves and annuli
        self._valves()
        self.log("landmarks ready")

    def X_LAD(self, y: np.ndarray) -> np.ndarray:
        ys, xs = self._xlad
        y = np.asarray(y, float)
        out = np.interp(y, ys, xs)
        return np.where((y < ys[0]) | (y > ys[-1]), np.nan, out)

    def level_of(self, y: float) -> float:
        """Continuous vertebral level: n.0 = top of Tn body, n.5 about mid-body; disc Tn/Tn+1 ~ n.9."""
        tops = np.array([v["top"] for v in self.vert])
        for i in range(len(tops) - 1):
            if tops[i] >= y > tops[i + 1]:
                return i + 1 + (tops[i] - y) / (tops[i] - tops[i + 1])
        return float("nan") if y > tops[0] else 12 + (tops[-1] - y) / (tops[-2] - tops[-1])

    def disc(self, n: int) -> float:
        return (self.vert[n - 1]["bottom"] + self.vert[n]["top"]) / 2

    def rib_edges(self, side: str, n: int, x: float, slab: float = 0.05) -> tuple[float, float]:
        V = self.ribs[side][n - 1]
        sel = V[(np.abs(V[:, 0] - x) <= slab) & (V[:, 2] > 0)]
        if len(sel) == 0:
            return float("nan"), float("nan")
        return float(sel[:, 1].min()), float(sel[:, 1].max())

    def sternal_edges(self, y: float) -> tuple[float, float]:
        st = self.m["Sternum"].V
        sel = st[np.abs(st[:, 1] - y) <= 0.02]
        if len(sel) == 0:
            return float("nan"), float("nan")
        return float(sel[:, 0].min()), float(sel[:, 0].max())

    def ics_index(self, side: str, x: float, y: float) -> float:
        """n.5 = inside ICS n (between rib n and rib n+1); n.0 = behind rib n."""
        for n in range(1, len(self.ribs[side])):
            lo_n, hi_n = self.rib_edges(side, n, x)
            lo_m, hi_m = self.rib_edges(side, n + 1, x)
            if math.isnan(lo_n) or math.isnan(hi_m):
                continue
            if hi_n >= y >= lo_n:
                return float(n)
            if lo_n > y > hi_m:
                return n + 0.5
        return float("nan")

    # -----------------------------------------------------------------------------------------
    def _epi(self):
        V, F = self.H, self.HF
        tri = V[F]
        cen = tri.mean(axis=1)
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        area2 = np.linalg.norm(fn, axis=1)
        fn = fn / np.maximum(area2[:, None], 1e-15)
        pitch = 0.008
        grid = Grid(V.min(axis=0), V.max(axis=0), pitch, pad=4)
        occ = ndimage.binary_dilation(grid.rasterize(dense_points(V, F, pitch * 0.7)))
        span = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0)))
        hit = march_hits(grid, occ, cen, fn, skip=0.02, max_len=span + 0.1)
        self.H_grid, self.H_occ = grid, occ
        self.epi_face = ~hit & (area2 > 0)
        self.H_epi_F = F[self.epi_face]
        epi_v = np.unique(self.H_epi_F)
        self.epi_vertex = np.zeros(len(V), dtype=bool)
        self.epi_vertex[epi_v] = True
        self.H_epi = V[epi_v]
        self.epi_samples = dense_points(V, self.H_epi_F, 0.004)
        self.epi_tree = cKDTree(self.epi_samples)
        self.H_tree = cKDTree(V)
        # a face-level lookup for "nearest H face is epicardial"
        self.face_cen_tree = cKDTree(cen)
        self.face_cen = cen
        self.log(f"H_epi: {self.epi_face.mean():.2%} of {len(F)} heart-wall faces are epicardial")

    def inside_myocardium(self, P: np.ndarray) -> np.ndarray:
        """Inside either closed heart-wall half (nearest-face sign confirmed by ray parity)."""
        if not hasattr(self, "_halves"):
            self._halves = [self.m[n].tm for n in ("Heart_Wall_Anterior", "Heart_Wall_Posterior")]
        sd = signed_distance(self.H_tm, P)
        out = np.zeros(len(P), dtype=bool)
        cand = np.flatnonzero(sd < 0)
        if len(cand):
            ins = np.zeros(len(cand), dtype=bool)
            for h in self._halves:
                ins |= h.contains(P[cand])
            out[cand] = ins
        return out

    def enclosed(self, P: np.ndarray, max_len: float = 0.4) -> np.ndarray:
        """Point enclosed by heart wall in all 14 axis/diagonal directions (i.e. inside a cardiac cavity)."""
        dirs = [np.array(d, float) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
        dirs += [unit(np.array([a, b, c], float)) for a in (1, -1) for b in (1, -1) for c in (1, -1)]
        hits = np.zeros(len(P), dtype=int)
        for d in dirs:
            hits += march_hits(self.H_grid, self.H_occ, P, np.tile(d, (len(P), 1)), skip=0.012, max_len=max_len)
        return hits == len(dirs)

    def sd_epi(self, P: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Signed distance to H_epi (positive outside the myocardium) and 'in a cavity' flags."""
        d_epi, _ = self.epi_tree.query(P)
        inside_myo = self.inside_myocardium(P)
        sd = d_epi.copy()
        if inside_myo.any():
            sd[inside_myo] = -trimesh.proximity.closest_point(self.H_tm, P[inside_myo])[1]
        _, fi = self.face_cen_tree.query(P)
        # a cavity sample floats inside a chamber: > 4 mm from the wall surface, nearest wall face
        # endocardial, and walled in along all 14 axis/diagonal directions within 4 cm
        cand = np.flatnonzero(~inside_myo & (d_epi > 0.01) & ~self.epi_face[fi])
        if len(cand):
            cand = cand[trimesh.proximity.closest_point(self.H_tm, P[cand])[1] > 0.04]
        cavity = np.zeros(len(P), dtype=bool)
        if len(cand):
            cavity[cand] = self.enclosed(P[cand])
        return sd, cavity

    # -----------------------------------------------------------------------------------------
    def _valves(self):
        """Annulus rings = hinge lines: valve vertices touching the heart wall (<= 1 mm).

        The valves are closed solids (leaflets + chordae), so there is no boundary loop. The hinge is where
        the valve tissue meets the myocardium; for the AV valves only the basal quartile along u_ba is used
        (chordal tips also touch the wall near the papillary muscles), for the pulmonary valve the proximal
        half along its own axis.
        """
        m = self.m
        nb = -self.u_ba  # toward the base / atria
        rings, self.ring_fit = {}, {}
        for key, node in (("MA", "Valve_Mitral"), ("TA", "Valve_Tricuspid"), ("PV", "Valve_Pulmonary")):
            V = weld(m[node].V, m[node].F)[0]
            _, d, _ = trimesh.proximity.closest_point(self.H_tm, V)
            touch = d <= 0.01
            if key == "PV":
                _, n = fit_plane(V[touch])
                n = n if n[1] > 0 else -n  # distal = toward the PA bifurcation (superior)
                proj = (V - V[touch].mean(axis=0)) @ n
                sel = touch & (proj <= np.median(proj[touch]))
                hint = n
            else:
                proj = (V - self.base_center) @ self.u_ba
                sel = touch & (proj <= np.quantile(proj, 0.25))
                hint = nb
            if sel.sum() < 20:  # fall back to the basal quartile (YAML landmark definition)
                proj = (V - self.base_center) @ self.u_ba
                sel = proj <= np.quantile(proj, 0.25)
            rg = fit_ring(V[sel], normal_hint=hint)
            rings[key] = rg
            self.ring_fit[key] = {"n_points": int(sel.sum()), "residual_mm": float(np.median(rg.dist(V[sel])) / MM),
                                  "normal_vs_base_deg": angle_deg(rg.n, nb)}
        self.rings = rings

    # -----------------------------------------------------------------------------------------
    def aorta(self):
        if hasattr(self, "_aorta"):
            return self._aorta
        self.log("skeletonising the aorta")
        a = self.m["GreatVessel_Aorta"]
        tm = a.tm
        sk = skeleton_of(tm.vertices, tm.faces, 0.012, tm)
        ends = sk.endpoints()
        prox = min(ends, key=lambda i: np.linalg.norm(sk.pos[i] - self.base_center))
        dist_end = min(ends, key=lambda i: sk.pos[i][1])
        path = sk.path(prox, dist_end)
        P = resample(smooth_path(sk.pos[path], 7), 0.01)
        # the root ends in a flat (possibly oblique) cap = the modelled aortic annulus plane
        t0 = unit(at_s(P, 0.15) - P[0])
        n_cap, cap = support_cap(tm.vertices, P[0], -t0)
        c = cap.mean(axis=0)
        e1 = unit(np.cross(n_cap, [1.0, 0.0, 0.0] if abs(n_cap[0]) < 0.9 else [0.0, 1.0, 0.0]))
        e2 = np.cross(n_cap, e1)
        from scipy.spatial import ConvexHull

        P2 = np.c_[(cap - c) @ e1, (cap - c) @ e2]
        hull = ConvexHull(P2)
        cap_D = 2 * math.sqrt(hull.volume / math.pi)
        rim = cap[hull.vertices]
        P = resample(np.vstack([c, P]), 0.01)
        _, r, _ = trimesh.proximity.closest_point(tm, P)
        r = ndimage.uniform_filter1d(r, 3, mode="nearest")
        s = arclen(P)
        root_axis = unit(at_s(P, 0.30) - P[0])
        # sinus bulge and STJ
        first = s <= 0.25
        i_sin = int(np.argmax(np.where(first, r, -1)))
        i_stj = i_sin
        for i in range(i_sin + 1, len(r) - 1):
            if s[i] - s[i_sin] > 0.35:
                break
            if r[i] <= r[i - 1] and r[i] <= r[i + 1]:
                i_stj = i
                break
        aov = Ring(c, -n_cap, cap_D / 2, np.vstack([rim, cap]))
        self.aov_tilt = angle_deg(-n_cap, [0, 1, 0])
        top = int(np.argmax(P[:, 1]))
        # arch start / end: first and last centreline point at Y = Y_SA
        above = P[:, 1] >= self.Y_SA
        i_as = int(np.argmax(above)) if above.any() else top
        i_ae = int(len(above) - 1 - np.argmax(above[::-1])) if above.any() else top
        self._aorta = dict(P=P, r=r, s=s, root_axis=root_axis, i_sin=i_sin, i_stj=i_stj, AoV=aov, top=top, i_as=i_as, i_ae=i_ae, sk=sk)
        return self._aorta

    def pa(self):
        if hasattr(self, "_pa"):
            return self._pa
        self.log("skeletonising the pulmonary arteries")
        a = self.m["GreatVessel_PulmonaryArtery"]
        tm = a.tm
        sk = skeleton_of(tm.vertices, tm.faces, 0.012, tm)
        pv = self.rings["PV"].c
        root = int(np.argmin(np.linalg.norm(sk.pos - pv, axis=1)))
        # keep the component containing the root
        comp = nx.node_connected_component(sk.graph, root)
        T = nx.bfs_tree(sk.graph.subgraph(comp), root)
        sub_len = {}
        for n in reversed(list(nx.topological_sort(T))):
            sub_len[n] = sum(sub_len[c] + sk.graph[n][c]["weight"] for c in T.successors(n))

        def walk(start, balance, max_len=None):
            """Follow the largest subtree until a node whose second-largest child carries at least
            ``balance`` of the two largest subtrees (a real division, not a small side branch)."""
            path, cur, L = [start], start, 0.0
            while True:
                ch = sorted(T.successors(cur), key=lambda c: -(sub_len[c] + sk.graph[cur][c]["weight"]))
                if not ch:
                    return path, None
                w = [sub_len[c] + sk.graph[cur][c]["weight"] for c in ch[:2]]
                if max_len is None and len(ch) >= 2 and w[1] >= balance * (w[0] + w[1]):
                    return path, ch
                L += sk.graph[cur][ch[0]]["weight"]
                if max_len is not None and L >= max_len:
                    return path, None
                cur = ch[0]
                path.append(cur)

        trunk, kids = walk(root, 0.25)
        out = {"sk": sk, "trunk": sk.pos[trunk], "bif": sk.pos[trunk[-1]], "root": sk.pos[root]}
        if kids:
            br, br_long = [], []
            for k in kids[:2]:
                p, _ = walk(k, 0.20)
                br.append(np.vstack([sk.pos[trunk[-1]], sk.pos[p]]))
                pl, _ = walk(k, 0.0, max_len=1.2)
                br_long.append(np.vstack([sk.pos[trunk[-1]], sk.pos[pl]]))
            order = np.argsort([P[-1][0] for P in br_long])
            out["RPA"], out["LPA"] = br[order[0]], br[order[1]]
            out["RPA_long"], out["LPA_long"] = br_long[order[0]], br_long[order[1]]
        trunk_P = resample(smooth_path(out["trunk"], 5), 0.01) if len(out["trunk"]) > 2 else out["trunk"]
        out["trunk"] = np.vstack([pv, trunk_P]) if np.linalg.norm(trunk_P[0] - pv) > 0.01 else trunk_P
        _, r, _ = trimesh.proximity.closest_point(tm, out["trunk"])
        out["r"] = r
        self._pa = out
        return out

    def carina(self):
        if hasattr(self, "_carina"):
            return self._carina
        # Track the tracheal lumen downward from the top cut: the bronchial tree also rises lateral to the
        # trachea (upper-lobe bronchi), so only loops near the tracked tracheal centre count. The carina is
        # the first height at which that single lumen is gone (split into the two main bronchi).
        tm = self.m["Trachea_Bronchi"].tm
        ytop = tm.vertices[:, 1].max() - 0.03
        loops = [L for L in section_loops(tm, ytop) if polygon_area(L) > 0.005]
        if not loops:
            self._carina = None
            return None
        cur = max(loops, key=polygon_area)
        c_prev, a_ref = cur.mean(axis=0), polygon_area(cur)
        res = None
        for y in np.arange(ytop, tm.vertices[:, 1].min(), -0.005):
            loops = [L for L in section_loops(tm, y) if polygon_area(L) > 0.002]
            same = [L for L in loops if np.linalg.norm(L.mean(axis=0) - c_prev) < 0.03 and polygon_area(L) > 0.6 * a_ref]
            if same:
                L = max(same, key=polygon_area)
                c_prev = 0.7 * c_prev + 0.3 * L.mean(axis=0)
                continue
            near = sorted([L for L in loops if np.linalg.norm(L.mean(axis=0) - c_prev) < 0.2], key=lambda L: -polygon_area(L))[:2]
            c2 = np.mean([L.mean(axis=0) for L in near], axis=0) if len(near) == 2 else c_prev
            res = np.array([c2[0], y + 0.0025, c2[1]])
            break
        self._carina = res
        return res

    def veins(self):
        """CardiacVeins pieces, named, each with a centreline path.

        When the published asset labels its (single-lumen) vein tree - ``vessels.json`` ``veins`` centrelines
        plus the ``_VEIN`` vertex attribute - the pieces are the labelled courses (CS, GCV + AIV, MCV, PVLV, ACV)
        with their published centrelines and radii; otherwise (the original BodyParts3D asset, five disjoint
        parts) each connected component is named from the source parts and skeletonised.
        """
        if hasattr(self, "_veins"):
            return self._veins
        cv = self.m["CardiacVeins"]
        vj = json.loads((PUBLIC / "vessels.json").read_text(encoding="utf-8")) if (PUBLIC / "vessels.json").exists() else {}
        if vj.get("veins") and "vein" in cv.A:
            self._veins = self._labelled_veins(vj["veins"], cv)
            return self._veins
        self.log("labelling and skeletonising the cardiac veins")
        comps = components(cv.V, cv.F, 30)
        names = self._name_vein_components(comps)
        out = []
        for (V, F), name in zip(comps, names):
            tm = trimesh.Trimesh(V, F, process=False)
            sk = skeleton_of(V, F, 0.004, tm)
            if len(sk.pos) == 0:
                continue
            # main path = longest geodesic in the largest skeleton component
            comp = max(nx.connected_components(sk.graph), key=len)
            a = next(iter(comp))
            b, _ = sk.farthest(a)
            c, _ = sk.farthest(b)
            path = sk.path(b, c)
            P = sk.pos[path]
            rr = sk.radius[path]
            out.append({"name": name, "V": V, "F": F, "tm": tm, "sk": sk, "P": P, "r": rr, "L": float(arclen(P)[-1])})
        self._veins = out
        return out

    def _labelled_veins(self, vj: dict, cv: "Mesh") -> list[dict]:
        self.log("cardiac veins: labelled centrelines (vessels.json veins) + _VEIN vertex labels")
        codes = {int(v): k for k, v in vj["codes"].items()}
        lab = np.round(cv.A["vein"]).astype(int)
        segs = vj["segments"]
        P_ = [np.asarray(sg["points"], float) for sg in segs]
        R_ = [np.asarray(sg["radius"], float) for sg in segs]

        def join(idx):
            out = [P_[idx[0]]]
            rr = [R_[idx[0]]]
            for j in idx[1:]:
                k0 = 1 if np.linalg.norm(P_[j][0] - out[-1][-1]) < 0.003 else 0
                out.append(P_[j][k0:])
                rr.append(R_[j][k0:])
            return np.vstack(out), np.concatenate(rr)

        def piece(name, idx_main, idx_all, code):
            P, r = join(idx_main)
            allP = np.vstack([P_[j] for j in idx_all])
            allR = np.concatenate([R_[j] for j in idx_all])
            V = cv.V[lab == code] if code is not None else cv.V
            if code is not None and len(idx_all) < sum(1 for sg in segs if sg["code"] == code):
                # several pieces share a label (PVLV / ACV sets): keep the vertices nearest this piece
                other = np.vstack([P_[j] for j, sg in enumerate(segs) if sg["code"] == code and j not in idx_all])
                V = V[cKDTree(allP).query(V)[0] <= cKDTree(other).query(V)[0]]
            sk = type("Sk", (), {"pos": allP, "radius": allR})()
            return {"name": name, "V": V, "F": None, "tm": None, "sk": sk, "P": P, "r": r, "L": float(arclen(P)[-1])}

        by = lambda lb: [j for j, sg in enumerate(segs) if sg["label"] == lb]  # noqa: E731
        main = lambda lb: [j for j in by(lb) if not segs[j].get("side")]  # noqa: E731
        out = []
        if by("CS"):
            out.append(piece("CS", main("CS")[:1], by("CS"), vj["codes"]["CS"]))
        gcv_main = main("GCV") + main("AIV")[:1]
        if gcv_main:
            out.append(piece("GCV", gcv_main, by("GCV") + by("AIV"), None))
            out[-1]["V"] = cv.V[(lab == vj["codes"]["GCV"]) | (lab == vj["codes"]["AIV"])]
        if by("MCV"):
            out.append(piece("MCV", main("MCV")[:1], by("MCV"), vj["codes"]["MCV"]))
        for lb in ("PVLV", "ACV"):
            roots = [j for j in by(lb) if not segs[j].get("side")]
            for rj in roots:
                members = [j for j in by(lb) if j == rj or self._vein_ancestor(segs, j, rj)]
                out.append(piece(lb, [rj], members, vj["codes"][lb]))
        # connectivity of the drained tree = connected mesh components that are not anterior cardiac veins
        comps = components(cv.V, cv.F, 30)
        tree_idx = cKDTree(cv.V)
        pieces = 0
        for Vc, _ in comps:
            _, ii = tree_idx.query(Vc)
            maj = np.bincount(lab[ii], minlength=8).argmax()
            if codes.get(int(maj)) != "ACV":
                pieces += 1
        self.vein_tree_pieces = pieces
        self.vein_label_source = f"vessels.json veins centrelines + _VEIN labels ({len(comps)} mesh components)"
        return out

    @staticmethod
    def _vein_ancestor(segs, j, root) -> bool:
        seen = 0
        while segs[j]["parent"] is not None and seen < 100:
            j = segs[j]["parent"]
            if j == root:
                return True
            seen += 1
        return False

    def _name_vein_components(self, comps) -> list[str]:
        names = [None] * len(comps)
        raw = {k: RAW_DIR / f"{k}.stl" for k in VEIN_PARTS}
        if all(p.exists() for p in raw.values()):
            O = np.array(self.manifest["frame"]["source_origin_mm"], float)
            pts, lab = [], []
            for f, nm in VEIN_PARTS.items():
                mm = trimesh.load(raw[f], process=False)
                q = (np.asarray(mm.vertices) - O) * MM
                pts.append(np.c_[q[:, 0], q[:, 2], -q[:, 1]])
                lab += [nm] * len(q)
            tree, lab = cKDTree(np.vstack(pts)), np.array(lab)
            for i, (V, _) in enumerate(comps):
                d, j = tree.query(V)
                u, c = np.unique(lab[j], return_counts=True)
                names[i] = str(u[np.argmax(c)])
            self.vein_label_source = f"BodyParts3D source parts in anatomy/raw (median published-to-source gap {np.median(d) / MM:.2f} mm)"
            return names
        # fallback: companion arteries
        self.vein_label_source = "companion-artery heuristic (anatomy/raw not available)"
        lad, pda = self.trunk["LAD"].P, self.trunk["RCA_PDA"].P
        for i, (V, _) in enumerate(comps):
            c = V.mean(axis=0)
            dl = cKDTree(lad).query(V)[0].mean()
            dp = cKDTree(pda).query(V)[0].mean()
            if c[2] < self.base_center[2] and c[1] > self.base_center[1] - 0.2 and len(V) < 800 and c[0] < 0.25:
                names[i] = "CS"
            elif dl < 0.06:
                names[i] = "GCV"
            elif dp < 0.06:
                names[i] = "MCV"
            elif c[0] < self.X_LAD(np.array([c[1]]))[0] if not np.isnan(self.X_LAD(np.array([c[1]]))[0]) else c[0] < 0:
                names[i] = "ACV"
            else:
                names[i] = "PVLV"
        return names

    # -----------------------------------------------------------------------------------------
    def aha(self, P: np.ndarray) -> np.ndarray:
        """AHA-17 segment of each point (0 = outside the LV sampling region)."""
        c_ma = self.rings["MA"].c
        ax = self.apex - c_ma
        Lax = np.linalg.norm(ax)
        a = ax / Lax
        # papillary levels from the LV papillary muscles (components near the LV axis)
        pap = components(self.m["Papillary_Muscles"].V, self.m["Papillary_Muscles"].F, 30)
        lv_pap = []
        for V, _ in pap:
            d = V - c_ma
            rho = np.linalg.norm(d - np.outer(d @ a, a), axis=1)
            if np.median(rho) < 0.22:
                lv_pap.append(V)
        if not lv_pap:
            lv_pap = [p[0] for p in pap]
        PV = np.vstack(lv_pap)
        tp = (PV - c_ma) @ a / Lax
        t_tip, t_base = float(np.quantile(tp, 0.05)), float(np.quantile(tp, 0.95))
        self.aha_levels = {"t_tip": t_tip, "t_base": t_base, "n_lv_papillary_components": len(lv_pap)}
        # angular reference: anterior IV groove (LAD) at the same t
        lad = self.trunk["LAD"].P
        tl = (lad - c_ma) @ a / Lax

        def radial(X):
            d = X - c_ma
            return d - np.outer(d @ a, a)

        rl = radial(lad)
        ref_axis = unit(rl[np.argmin(np.abs(tl - 0.5))])
        # direction toward the septum: the PDA (posterior IV groove) lies ~120 deg from the anterior groove
        pda = self.trunk["RCA_PDA"].P
        e1 = ref_axis
        e2 = unit(np.cross(a, e1))
        rp = radial(pda).mean(axis=0)
        if np.dot(rp, e2) < 0:
            e2 = -e2  # positive rotation runs anterior groove -> septum -> posterior groove
        t = (P - c_ma) @ a / Lax
        rP = radial(P)
        # per-t reference angle from the LAD sample at that t
        order = np.argsort(tl)
        ref_ang_lad = np.arctan2(rl @ e2, rl @ e1)
        ref = np.interp(t, tl[order], np.unwrap(ref_ang_lad[order]))
        th = (np.degrees(np.arctan2(rP @ e2, rP @ e1) - ref)) % 360
        seg = np.zeros(len(P), dtype=int)
        basal = (t >= 0) & (t < t_tip)
        mid = (t >= t_tip) & (t < t_base)
        apical = (t >= t_base) & (t <= 0.95)
        cap = t > 0.95
        sector6 = (th // 60).astype(int)  # 0:[0,60) ... 5:[300,360)
        bm_map = np.array([2, 3, 4, 5, 6, 1])
        seg[basal] = bm_map[sector6[basal]]
        seg[mid] = bm_map[sector6[mid]] + 6
        ap = np.full(len(P), 13)
        ap[(th >= 15) & (th < 105)] = 14
        ap[(th >= 105) & (th < 195)] = 15
        ap[(th >= 195) & (th < 285)] = 16
        seg[apical] = ap[apical]
        seg[cap] = 17
        self.aha_theta = th
        return seg

    def lv_mask(self, P: np.ndarray) -> np.ndarray:
        """LV myocardium sampling region: 0 <= t <= 1 and within the LV radius (lateral-wall based)."""
        c_ma = self.rings["MA"].c
        ax = self.apex - c_ma
        Lax = np.linalg.norm(ax)
        a = ax / Lax
        d = P - c_ma
        t = d @ a / Lax
        rho = np.linalg.norm(d - np.outer(d @ a, a), axis=1)
        th = self.aha_theta
        lateral = (th >= 180) & (th < 300) & self.epi_vertex_of(P)
        Rt = np.full(len(P), np.nan)
        bins = np.linspace(0, 1.0, 11)
        for i in range(10):
            sel = lateral & (t >= bins[i]) & (t < bins[i + 1])
            if sel.sum() > 20:
                Rt[(t >= bins[i]) & (t < bins[i + 1])] = np.quantile(rho[sel], 0.95) * 1.1
        Rt = np.where(np.isnan(Rt), np.nanmax(Rt), Rt)
        return (t >= 0) & (t <= 1.0) & (rho <= Rt)

    def epi_vertex_of(self, P: np.ndarray) -> np.ndarray:
        d, _ = self.epi_tree.query(P)
        return d < 0.003


# =============================================================================================
# Checks
# =============================================================================================
def ok_str(b: bool) -> str:
    return "yes" if b else "no"


def run_checks(M: Model, yaml_checks: dict) -> list[Check]:
    checks: list[Check] = []

    def new(cid: str) -> Check:
        y = yaml_checks.get(cid, {})
        c = Check(cid, y.get("title", cid), y.get("severity", "soft"))
        checks.append(c)
        return c

    m = M.m
    H = M.H
    Xm = M.X_mid
    V = M.vert
    lvl = V[0]["top"] - V[1]["top"]
    u = M.u_ba
    bc = M.base_center
    apex = M.apex
    rings = M.rings
    tr = M.trunk
    areas = vertex_areas(H, M.HF)

    # ------------------------------------------------------------------ POSITION
    c = new("POS-01")
    frac = float(areas[H[:, 0] > Xm].sum() / areas.sum())
    epi_area = vertex_areas(H, M.H_epi_F)
    frac_epi = float(epi_area[H[:, 0] > Xm].sum() / epi_area.sum())
    c.band("area_frac_left", frac, 0.60, 0.75, "", typical=0.67)
    c.cond("X_mid<0", Xm < 0, "X_mid < 0", f"X_mid = {Xm:.3f} u (spine mean X {M.spine_mean_x:.3f})")
    # volume enclosed by the epicardium (closing seals the vessel orifices)
    grid = Grid(H.min(axis=0), H.max(axis=0), 0.01, pad=20)
    shell = grid.rasterize(dense_points(H, M.HF, 0.007))
    dt_out = ndimage.distance_transform_edt(~shell) * grid.pitch
    closed = dt_out <= 0.02
    filled = ndimage.binary_fill_holes(closed)
    dt_in = ndimage.distance_transform_edt(filled) * grid.pitch
    vol = dt_in > 0.02
    vol |= shell
    vol = ndimage.binary_fill_holes(vol)
    ctr = grid.centers(np.argwhere(vol))
    vfrac = float((ctr[:, 0] > Xm).mean())
    M.heart_volume_ml = len(ctr) * (grid.pitch / MM) ** 3 / 1000.0
    c.note(f"H_epi-area fraction {frac_epi:.3f}; enclosed-volume fraction {vfrac:.3f} (orifices closed at 2 cm; volume {M.heart_volume_ml:.0f} mL)")

    c = new("POS-02")
    c.band("u_ba.x", u[0], 0.10, None, "")
    c.band("u_ba.y", u[1], None, -0.10, "")
    c.band("u_ba.z", u[2], 0.10, None, "")

    c = new("POS-03")
    axial = math.degrees(math.atan2(u[0], u[2]))
    frontal = math.degrees(math.atan2(-u[1], u[0]))
    c.band("axial_deg", axial, 30, 60, "deg", fmt="{:.1f}", typical=45)
    c.band("frontal_deg", frontal, 21, 56, "deg", fmt="{:.1f}", typical=38.1)
    # PCA long axis of the ventricular mass as a cross-check of the manifest axis
    bc2 = (rings["MA"].c + rings["TA"].c) / 2
    u2 = unit(apex - bc2)
    c.note(f"u_ba = ({u[0]:.3f}, {u[1]:.3f}, {u[2]:.3f}) from manifest.heart; with base_center = mean of the mitral/tricuspid hinge-ring centres the axis is {angle_deg(u, u2):.1f} deg away (axial {math.degrees(math.atan2(u2[0], u2[2])):.1f}, frontal {math.degrees(math.atan2(-u2[1], u2[0])):.1f} deg)")

    c = new("POS-04")
    ics_mcl = M.ics_index("L", M.MCL_L, apex[1])
    lo4, hi4 = M.rib_edges("L", 4, M.MCL_L)
    lo5, hi5 = M.rib_edges("L", 5, M.MCL_L)
    _, hi6 = M.rib_edges("L", 6, M.MCL_L)
    c.band("ICS index at MCL_L", ics_mcl, 3.5, 6.5, "", fmt="{:.1f}", typical="5.5 = 5th ICS")
    c.note(f"apex.y {apex[1]:.3f}; at MCL_L x={M.MCL_L:.3f}: rib 4 {lo4:.3f}..{hi4:.3f}, rib 5 {lo5:.3f}..{hi5:.3f}, rib 6 top {hi6:.3f} (index n.5 = ICS n, n.0 = behind rib n)")

    c = new("POS-05")
    dx = apex[0] - Xm
    dm = abs(apex[0] - M.MCL_L)
    c.band("dx", dx, 0.65, 1.05, "u", typical=0.85)
    c.band("dm", dm, None, 0.20, "u")

    c = new("POS-06")
    top_L = float(H[H[:, 0] > Xm][:, 1].max())
    top_R = float(H[H[:, 0] < Xm][:, 1].max())
    d_L = top_L - M.cc["L"][1]["band"][0]
    d_R = top_R - M.cc["R"][2]["band"][1]
    c.band("d_L", d_L, -0.15, 0.10)
    c.band("d_R", d_R, -0.15, 0.10)
    c.cond("left_higher", top_L > top_R, "top_L > top_R", f"top_L {top_L:.3f} vs top_R {top_R:.3f}")
    c.band("maxY(H) - disc(T4/T5)", H[:, 1].max() - M.disc(4), None, 0.05)
    c.band("minY(H) - mid(T9)", H[:, 1].min() - V[8]["mid"], 0.0, None)
    c.note(f"heart body spans vertebral levels {M.level_of(H[:, 1].max()):.1f} to {M.level_of(H[:, 1].min()):.1f} (n.0 = top of Tn)")

    c = new("POS-07")
    L = float(np.ptp((H - bc) @ u))
    W = float(np.ptp(H[:, 0]))
    c.band("L", L, 1.0, 1.4, "u", typical=1.2)
    c.band("W", W, 1.0, 1.55, "u", typical=1.34)
    c.note(f"depth (Z extent, not graded) {np.ptp(H[:, 2]):.3f} u; enclosed volume {M.heart_volume_ml:.0f} mL")

    c = new("POS-08")
    dia = m["Diaphragm"].V
    dome_R = float(dia[dia[:, 0] < Xm - 0.25][:, 1].max())
    LL, LR = m["Lung_L"].V, m["Lung_R"].V
    best = 0.0
    for y in np.arange(dome_R, M.Y_SA, 0.01):
        a = LL[np.abs(LL[:, 1] - y) < 0.01]
        b = LR[np.abs(LR[:, 1] - y) < 0.01]
        if len(a) and len(b):
            best = max(best, float(a[:, 0].max() - b[:, 0].min()))
    ctr_ = W / best if best else float("nan")
    c.band("CTR", ctr_, 0.38, 0.50, "", typical=0.47)
    c.note(f"inner thoracic width (lung-to-lung) {best:.3f} u; transverse heart width {W:.3f} u")

    c = new("POS-09")
    M.log("POS-09 penetration pairs")
    solids_B = ["Sternum", "CostalCartilage", "Ribs_L", "Ribs_R", "Spine_Thoracic", "Lung_L", "Lung_R"]
    set_A = {"Heart": (H, None), "GreatVessel_Aorta": None, "GreatVessel_SVC": None, "GreatVessel_IVC": None,
             "CardiacVeins": None, "Coronary_LAD": None, "Coronary_LCX": None, "Coronary_RCA": None}
    worst = {}
    Btm = {b: m[b].tm for b in solids_B}
    Bgrid = {}
    for b in solids_B:
        tmb = Btm[b]
        Bgrid[b] = solid_grid(tmb.vertices, tmb.faces, 0.01)
    Bsamp = {b: cKDTree(dense_points(Btm[b].vertices, Btm[b].faces, 0.01)) for b in solids_B}
    M.Bgrid = Bgrid
    for a in set_A:
        M.log(f"  penetration of {a}")
        A = H if a == "Heart" else weld(m[a].V, m[a].F)[0]
        for b in solids_B:
            tmb = Btm[b]
            lo, hi = tmb.bounds
            sel = np.all((A >= lo - 0.01) & (A <= hi + 0.01), axis=1)
            if not sel.any():
                continue
            P = A[sel]
            g, occ = Bgrid[b]
            d0, _ = Bsamp[b].query(P)
            inside = g.lookup(occ, P)
            near = d0 < 0.012
            pen = np.zeros(len(P))
            if near.any():
                pen[near] = penetration_depth(tmb, P[near])
            deep = inside & ~near
            pen[deep] = d0[deep]
            if pen.max() > 0:
                worst[(a, b)] = (float(pen.max()), int((pen > 0.005).sum()))
    exempt = set()
    viol = {k: v for k, v in worst.items() if v[0] > 0.005 and k not in exempt}
    maxpen = max([v[0] for v in viol.values()], default=0.0)
    c.band("max_penetration", maxpen, None, 0.005)
    listing = ", ".join(f"{a}->{b} {v[0] / MM:.1f} mm ({v[1]} vtx)" for (a, b), v in sorted(viol.items(), key=lambda kv: -kv[1][0])[:8])
    c.note("penetrations > 0.5 mm: " + (listing or "none"))
    # cardiac notch: H_epi points left of the midline at CC4-CC6 whose +Z ray reaches the chest wall before Lung_L
    ylo, yhi = M.cc["L"][5]["band"][0], M.cc["L"][3]["band"][1]
    cand = M.H_epi[(M.H_epi[:, 1] >= ylo) & (M.H_epi[:, 1] <= yhi) & (M.H_epi[:, 0] > Xm)]
    cand = cand[cand[:, 2] > np.quantile(cand[:, 2], 0.5)] if len(cand) else cand
    gL, occL = Bgrid["Lung_L"]
    lung_hit = march_hits(gL, occL, cand, np.tile([0, 0, 1.0], (len(cand), 1)), 0.0, 1.2) if len(cand) else np.zeros(0, bool)
    bare = cand[~lung_hit]
    c.cond("cardiac_notch", len(bare) > 0, "bare area present", f"bare-area H_epi points: {len(bare)} of {len(cand)} anterior candidates" + (f", Y {bare[:, 1].min():.2f}..{bare[:, 1].max():.2f}" if len(bare) else ""), severity="soft")
    M.penetrations = worst

    c = new("POS-10")
    tmD = m["Diaphragm"].tm
    lowY = np.quantile(H[:, 1], 0.15)
    low = H[H[:, 1] <= lowY]
    sdD = signed_distance(tmD, low)
    pen = float(penetration_depth(tmD, low).max())
    contact = float((np.abs(sdD) <= 0.05).mean())
    dome_L = float(dia[dia[:, 0] > Xm + 0.25][:, 1].max())
    c.band("max_penetration", pen, None, 0.005)
    c.band("contact_fraction", contact, 0.05, None, "")
    c.cond("dome_order", dome_R > dome_L, "dome_R > dome_L", f"dome_R {dome_R:.3f}, dome_L {dome_L:.3f}", severity="soft")
    c.note(f"heart-to-diaphragm gap: median {np.median(sdD) / MM:.1f} mm, min {sdD.min() / MM:.1f} mm over the lowest 15% of H")

    c = new("POS-11")
    car = M.carina()
    if car is None:
        c.absent = True
        c.note("no two-lumen section found in Trachea_Bronchi")
    else:
        c.band("carina vs disc(T4/T5) (levels)", abs(car[1] - M.disc(4)) / lvl, None, 0.5, "levels", fmt="{:.2f}")
        c.band("|carina.y - Y_SA|", abs(car[1] - M.Y_SA), None, 0.15)
        c.band("maxY(H) - carina.y", H[:, 1].max() - car[1], None, 0.05)
        c.note(f"carina ({car[0]:.3f}, {car[1]:.3f}, {car[2]:.3f}); level {M.level_of(car[1]):.1f}; Y_SA {M.Y_SA:.3f}; disc T4/T5 {M.disc(4):.3f}")
    M.car = car

    # ------------------------------------------------------------------ CHAMBERS
    c = new("CHM-01")
    ys, _ = M._xlad
    E = M.H_epi[(M.H_epi[:, 1] >= ys[0]) & (M.H_epi[:, 1] <= ys[-1])]
    front = E[E[:, 2] >= np.quantile(E[:, 2], 0.9)]
    rv = float((front[:, 0] < M.X_LAD(front[:, 1])).mean())
    c.band("RV-side fraction", rv, 0.5, None, "", typical=0.7)

    c = new("CHM-02")
    pR = H[np.argmin(H[:, 0])]
    ivc, svc = m["GreatVessel_IVC"].V, m["GreatVessel_SVC"].V
    c.cond("between cavae", ivc[:, 1].max() - 0.1 <= pR[1] <= svc[:, 1].min() + 0.1, "maxY(IVC)-0.1 <= p_R.y <= minY(SVC)+0.1",
           f"p_R.y {pR[1]:.3f}; IVC top {ivc[:, 1].max():.3f}; SVC bottom {svc[:, 1].min():.3f}")
    xr, _ = M.sternal_edges(pR[1])
    c.band("lat", xr - pR[0], 0.05, 0.30, "u", typical=0.15)
    c.cond("CC3..CC6 level", M.cc["R"][5]["band"][0] - 0.1 <= pR[1] <= M.cc["R"][2]["band"][1] + 0.1, "CC_R(6)-0.1 <= y <= CC_R(3)+0.1",
           f"p_R = ({pR[0]:.3f}, {pR[1]:.3f}, {pR[2]:.3f}); right sternal edge x {xr:.3f}")

    # ------------------------------------------------------------------ VALVES
    ao = M.aorta()
    AoV = ao["AoV"]
    MA, TA, PV = rings["MA"], rings["TA"], rings["PV"]
    c = new("VLV-01")
    bL3, bL4, bR4 = M.cc["L"][2]["band"], M.cc["L"][3]["band"], M.cc["R"][3]["band"]
    xl_ao = M.sternal_edges(AoV.c[1])[1]

    def band_miss(y, band):
        return 0.0 if band[0] <= y <= band[1] else min(abs(y - band[0]), abs(y - band[1]))

    c.band("PV.c.y outside CC_L(3)", band_miss(PV.c[1], bL3), None, 0.10)
    c.band("AoV.c.y outside CC_L(3)..CC_L(4)", band_miss(AoV.c[1], (bL4[0], bL3[1])), None, 0.10)
    c.cond("AoV.c.x behind left half of sternum", Xm - 0.05 <= AoV.c[0] <= xl_ao + 0.05, "X_mid-0.05 <= x <= X_L_edge+0.05", f"AoV.c.x {AoV.c[0]:.3f} (X_mid {Xm:.3f}, left edge {xl_ao:.3f})")
    c.band("MA.c.y outside CC_L(4)", band_miss(MA.c[1], bL4), None, 0.10)
    c.cond("MA.c.x > X_mid", MA.c[0] > Xm, "MA.c.x > X_mid", f"MA.c.x {MA.c[0]:.3f}")
    c.band("TA.c.y outside CC_R(4)", band_miss(TA.c[1], bR4), None, 0.10)
    c.cond("TA.c.x <= X_mid+0.05", TA.c[0] <= Xm + 0.05, "TA.c.x <= X_mid + 0.05", f"TA.c.x {TA.c[0]:.3f}")
    c.note(f"PV.c {np.round(PV.c, 3).tolist()}, AoV.c {np.round(AoV.c, 3).tolist()}, MA.c {np.round(MA.c, 3).tolist()}, TA.c {np.round(TA.c, 3).tolist()}; CC_L3 {np.round(bL3, 3).tolist()}, CC_L4 {np.round(bL4, 3).tolist()}, CC_R4 {np.round(bR4, 3).tolist()}")

    c = new("VLV-02")
    d = PV.c - AoV.c
    c.band("dz", d[2], 0.02, None)
    c.band("dy", d[1], 0.02, None)
    c.band("dx", d[0], 0.0, None)

    c = new("VLV-03")
    c.cond("TA.x < AoV.x < MA.x", TA.c[0] < AoV.c[0] < MA.c[0], "TA.x < AoV.x < MA.x", f"x: TA {TA.c[0]:.3f}, AoV {AoV.c[0]:.3f}, MA {MA.c[0]:.3f}")
    c.cond("MA most posterior", MA.c[2] < min(TA.c[2], AoV.c[2]), "MA.z < min(TA.z, AoV.z)", f"z: MA {MA.c[2]:.3f}, TA {TA.c[2]:.3f}, AoV {AoV.c[2]:.3f}")

    c = new("VLV-04")
    c.band("MA.c.y - TA.c.y", MA.c[1] - TA.c[1], -0.05, None, severity="soft")
    # septal hinges = the parts of each hinge ring that face the other valve
    ta_s = TA.pts[np.argsort(np.linalg.norm(TA.pts - MA.c, axis=1))[: max(5, len(TA.pts) // 8)]]
    ma_a = MA.pts[np.argsort(np.linalg.norm(MA.pts - TA.c, axis=1))[: max(5, len(MA.pts) // 8)]]
    off = float((ta_s.mean(axis=0) - ma_a.mean(axis=0)) @ u)
    c.band("offset", off, 0.0, 0.15, "u", severity="soft")
    c.note(f"offset = (TA septal hinge - MA anterior hinge) . u_ba, hinges = the facing eighth of each hinge ring; centre-based (TA.c - MA.c) . u_ba = {float((TA.c - MA.c) @ u):.3f}")

    c = new("VLV-05")
    dmin = float(cKDTree(weld(m["Valve_Mitral"].V, m["Valve_Mitral"].F)[0]).query(AoV.pts)[0].min())
    c.band("min_dist(AoV ring, Valve_Mitral)", dmin, None, 0.05)

    c = new("VLV-06")
    c.band("MA_D", MA.D, 0.24, 0.38, typical=0.30)
    c.band("TA_D", TA.D, 0.24, 0.40, typical=0.30)
    c.band("AoV_D", AoV.D, 0.18, 0.29, typical=0.23)
    c.band("PV_D", PV.D, 0.17, 0.25, typical=0.21)
    c.cond("TA >= MA", TA.D >= MA.D, "TA perimeter >= MA perimeter", f"TA {TA.D:.3f} vs MA {MA.D:.3f}")
    c.note("hinge rings = valve vertices within 1 mm of the heart wall (basal quartile for MV/TV); fits: " + ", ".join(f"{k} {v['n_points']} pts, residual {v['residual_mm']:.1f} mm, normal {v['normal_vs_base_deg']:.0f} deg from -u_ba" for k, v in M.ring_fit.items()) + f"; AoV = flat proximal cap of GreatVessel_Aorta (equivalent-area diameter), tilted {M.aov_tilt:.0f} deg from horizontal")

    # ------------------------------------------------------------------ GREAT VESSELS
    P, r, s = ao["P"], ao["r"], ao["s"]
    pa = M.pa()
    bif = pa["bif"]
    asc = np.arange(len(P)) <= ao["top"]
    desc = ~asc

    def at_y(mask, y):
        idx = np.flatnonzero(mask)
        k = idx[np.argmin(np.abs(P[idx, 1] - y))]
        return k

    c = new("GV-01")
    ast = P[ao["i_as"]]
    c.band("|AoV.c.y - min(CC_L(3))|", abs(AoV.c[1] - bL3[0]), None, 0.2)
    c.cond("AoV.c.x behind left half", Xm - 0.05 <= AoV.c[0] <= xl_ao + 0.10, "X_mid-0.05 <= x <= X_L_edge+0.10", f"AoV.c.x {AoV.c[0]:.3f}")
    c.band("angle(arch_start - AoV.c, +Y)", angle_deg(ast - AoV.c, [0, 1, 0]), None, 40, "deg", fmt="{:.1f}")
    c.band("arch_start.x - AoV.c.x", ast[0] - AoV.c[0], None, 0.02)
    c.band("L", s[ao["i_as"]], 0.4, 0.7, "u", typical=0.5)

    c = new("GV-02")
    D_sin, D_stj = 2 * r[ao["i_sin"]], 2 * r[ao["i_stj"]]
    k_asc = at_y(asc, bif[1])
    D_asc = 2 * r[k_asc]
    c.band("D_sinus", D_sin, 0.29, 0.40)
    c.band("D_stj", D_stj, 0.22, 0.36)
    c.cond("sinus bulge", D_sin > D_stj + 0.01, "D_sinus > D_stj (+1 mm)", f"max root D at s={s[ao['i_sin']]:.2f} u, next minimum at s={s[ao['i_stj']]:.2f} u; bulge {(D_sin - D_stj) / MM:.1f} mm")
    c.band("D_asc", D_asc, 0.25, 0.41, typical=0.33)
    c.note("diameters = 2 x inscribed radius (centreline-to-wall distance) of GreatVessel_Aorta")

    c = new("GV-03")
    y_top = P[:, 1].max()
    c.cond("Y_SA < y_top < Y_JN", M.Y_SA < y_top < M.Y_JN, "Y_SA < y_top < Y_JN", f"y_top {y_top:.3f}; Y_SA {M.Y_SA:.3f}; Y_JN {M.Y_JN:.3f}")
    c.band("gap", M.Y_JN - y_top, 0.10, 0.45, severity="soft", typical=0.25)

    c = new("GV-04")
    a_s, a_e = P[ao["i_as"]], P[ao["i_ae"]]
    c.band("dZ(arch)", a_e[2] - a_s[2], None, -0.15)
    c.band("dX(arch)", a_e[0] - a_s[0], 0.05, None)
    tr_tm = m["Trachea_Bronchi"].tm
    c.band("penetration(Aorta, Trachea)", float(penetration_depth(tr_tm, weld(m["GreatVessel_Aorta"].V, m["GreatVessel_Aorta"].F)[0]).max()), None, 0.005)
    # arch underside to the left main bronchus: bronchus points below the arch (X > carina.x + 0.05, Y < carina.y)
    arch = P[ao["i_as"] : ao["i_ae"] + 1]
    TB = tr_tm.vertices
    if M.car is not None:
        lmb = TB[(TB[:, 0] > M.car[0] + 0.03) & (TB[:, 0] < M.car[0] + 0.35) & (TB[:, 1] < M.car[1] + 0.02) & (TB[:, 1] > M.car[1] - 0.25) & (np.abs(TB[:, 2] - M.car[2]) < 0.15)]
        ar_r = r[ao["i_as"] : ao["i_ae"] + 1]
        gap = float((cKDTree(lmb).query(arch)[0] - ar_r).min()) if len(lmb) else float("nan")
        c.band("underside gap to left main bronchus", gap, 0.0, 0.2)
    c.cond("arch_end left of midline", a_e[0] > Xm, "arch_end.x > X_mid", f"arch_end {np.round(a_e, 3).tolist()} (level {M.level_of(a_e[1]):.1f})")

    c = new("GV-05")
    offs = []
    for n in range(5, 9):
        k = at_y(desc, V[n - 1]["mid"])
        offs.append(P[k, 0] - Xm)
    k12 = at_y(desc, V[11]["mid"])
    k6 = at_y(desc, V[5]["mid"])
    c.band("min x_off(T5..T8)", min(offs), 0.02, None)
    c.cond("converges", abs(P[k12, 0] - Xm) <= abs(P[k6, 0] - Xm), "|x_off(T12)| <= |x_off(T6)|", f"x_off T6 {P[k6, 0] - Xm:.3f}, T12 {P[k12, 0] - Xm:.3f} (T12 below crop: {P[:, 1].min() > V[11]['mid']})")
    behind = []
    for n in range(6, 9):
        k = at_y(desc, V[n - 1]["mid"])
        Hy = H[np.abs(H[:, 1] - P[k, 1]) < 0.02]
        if len(Hy):
            behind.append(P[k, 2] + r[k] - (Hy[:, 2].min() + 0.02))
    c.band("max (Z_desc + r) - (minZ(H)+0.02) over T6..T8", max(behind) if behind else float("nan"), None, 0.0)
    c.note("x_off T5..T8 = " + ", ".join(f"{o:.3f}" for o in offs))

    c = new("GV-06")
    k_d = at_y(desc, bif[1])
    D_desc = 2 * r[k_d]
    c.band("D_desc", D_desc, 0.18, 0.30, typical=0.24)
    c.band("ratio", D_desc / D_asc, 0.60, 0.90, "", typical=0.73)

    c = new("GV-07")
    c.band("dz_origin", PV.c[2] - AoV.c[2], 0.05, None)
    db = bif - PV.c
    c.cond("up and back", db[1] > 0 and db[2] < 0, "bif - PV.c: dy > 0, dz < 0", f"bif - PV.c = ({db[0]:.3f}, {db[1]:.3f}, {db[2]:.3f})")
    T_ = pa["trunk"]
    left_of = [T_[i, 0] > P[at_y(asc, T_[i, 1]), 0] for i in range(len(T_)) if P[asc, 1].min() <= T_[i, 1] <= P[asc, 1].max()]
    c.cond("left of ascending aorta", all(left_of) if left_of else False, "X_PT(y) > X_Ao(y)", f"{np.mean(left_of) if left_of else float('nan'):.0%} of trunk samples left of the aorta")
    L_pt = float(arclen(T_)[-1])
    c.band("L", L_pt, 0.4, 0.6, "u", typical=0.5)

    c = new("GV-08")
    rt = pa["r"]
    D_mpa = float(2 * np.median(rt[len(rt) // 4 : 3 * len(rt) // 4 + 1])) if len(rt) > 3 else float(2 * rt.mean())
    c.band("D_mpa", D_mpa, 0.18, 0.29, typical=0.25)
    c.band("ratio", D_mpa / D_asc, None, 0.9, "")
    c.band("ratio (hard)", D_mpa / D_asc, None, 1.0, "", severity="hard")

    c = new("GV-09")
    arch_under = float(P[ao["top"], 1] - r[ao["top"]])
    k_a, k_d2 = at_y(asc, bif[1]), at_y(desc, bif[1])
    in_conc = bif[1] < arch_under and P[k_d2, 2] < bif[2]
    c.cond("in the arch concavity", in_conc, "bif.y < arch underside, in front of the descending limb",
           f"bif {np.round(bif, 3).tolist()}; arch underside y {arch_under:.3f}; ascending z {P[k_a, 2]:.3f} / descending z {P[k_d2, 2]:.3f} at that height")
    c.cond("T4/5..T7", V[6]["bottom"] <= bif[1] <= M.disc(4), "bottom(T7) <= bif.y <= disc(T4/T5)", f"bif level {M.level_of(bif[1]):.1f}")
    if M.car is not None:
        c.band("carina.y - bif.y", M.car[1] - bif[1], 0.0, 0.5)
        c.cond("bif in front of carina", bif[2] > M.car[2], "bif.z > carina.z", f"bif.z {bif[2]:.3f} vs carina.z {M.car[2]:.3f}")
    if "RPA" in pa:
        RPA, LPA = pa["RPA_long"], pa["LPA_long"]
        # right PA behind the ascending aorta and SVC where it passes them
        svcV = m["GreatVessel_SVC"].V
        ok_ao, ok_svc = [], []
        for p in RPA:
            k = at_y(asc, p[1])
            if abs(P[k, 0] - p[0]) < r[k] + 0.03 and abs(P[k, 1] - p[1]) < 0.05:
                ok_ao.append(p[2] < P[k, 2])
            sv = svcV[(np.abs(svcV[:, 1] - p[1]) < 0.03) & (np.abs(svcV[:, 0] - p[0]) < 0.05)]
            if len(sv):
                ok_svc.append(p[2] < sv[:, 2].min())
        c.cond("RPA behind Ao", all(ok_ao) if ok_ao else True, "Z_RPA < Z_Ao at crossing", f"{sum(ok_ao)}/{len(ok_ao)} crossing samples behind the aorta")
        c.cond("RPA behind SVC", all(ok_svc) if ok_svc else True, "Z_RPA < Z_SVC at crossing", f"{sum(ok_svc)}/{len(ok_svc)} crossing samples behind the SVC" + ("" if ok_svc else " (SVC does not reach the RPA level)"))
        lpa_ok = []
        if M.car is not None:
            lmb = TB[(TB[:, 0] > M.car[0] + 0.03) & (TB[:, 0] < M.car[0] + 0.55) & (TB[:, 1] < M.car[1] + 0.02) & (TB[:, 1] > M.car[1] - 0.35) & (np.abs(TB[:, 2] - M.car[2]) < 0.2)]
            for p in LPA:
                bb = lmb[(np.abs(lmb[:, 0] - p[0]) < 0.03) & (np.abs(lmb[:, 2] - p[2]) < 0.08)]
                if len(bb):
                    lpa_ok.append(bool(p[1] > bb[:, 1].mean()))
        c.cond("LPA over left bronchus", (np.mean(lpa_ok) >= 0.5) if lpa_ok else False, "Y_LPA > Y_LMB at crossing", f"{sum(lpa_ok)}/{len(lpa_ok)} LPA samples above the left main bronchus where they overlap in X-Z")
        def to_hilum(Pp, lung):
            g_, occ_ = M.Bgrid[lung]
            ins_ = g_.lookup(occ_, Pp)
            return float(arclen(Pp)[int(np.argmax(ins_))]) if ins_.any() else float("nan")

        L_R, L_L = to_hilum(RPA, "Lung_R"), to_hilum(LPA, "Lung_L")
        c.cond("L_RPA > L_LPA", L_R > L_L, "L_RPA > L_LPA (bifurcation -> lung entry)",
               f"to the hilum: L_RPA {L_R:.3f}, L_LPA {L_L:.3f}; to the first lobar division: {arclen(pa['RPA'])[-1]:.3f} / {arclen(pa['LPA'])[-1]:.3f}")
    else:
        c.cond("PA bifurcation found", False, "bifurcation", "no bifurcation found in the PA skeleton")

    c = new("GV-10")
    svcV = m["GreatVessel_SVC"].V
    c.band("|maxY(SVC) - mid CC_R(1)|", abs(svcV[:, 1].max() - np.mean(M.cc["R"][0]["band"])), None, 0.15)
    c.band("|minY(SVC) - mid CC_R(3)|", abs(svcV[:, 1].min() - np.mean(M.cc["R"][2]["band"])), None, 0.15)
    ys_ = np.linspace(svcV[:, 1].min() + 0.02, svcV[:, 1].max() - 0.02, 8)
    right_ao, right_tr = [], []
    for y in ys_:
        sv = svcV[np.abs(svcV[:, 1] - y) < 0.02]
        k = at_y(asc, y)
        right_ao.append(sv[:, 0].mean() < P[k, 0])
        tb = TB[(np.abs(TB[:, 1] - y) < 0.02) & (np.abs(TB[:, 0] - (M.car[0] if M.car is not None else Xm)) < 0.15)]
        if len(tb) and (M.car is None or y > M.car[1]):
            right_tr.append(sv[:, 0].mean() < tb[:, 0].mean())
    c.cond("right of aorta", all(right_ao), "X_SVC < X_Ao", f"{sum(right_ao)}/{len(right_ao)} heights")
    c.cond("right of trachea", all(right_tr) if right_tr else True, "X_SVC < X_trachea", f"{sum(right_tr)}/{len(right_tr)} heights")
    cs_, _, vt = np.linalg.svd(svcV - svcV.mean(axis=0), full_matrices=False)
    c.band("axis angle to -Y", angle_deg(vt[0] * np.sign(-vt[0][1] or 1), [0, -1, 0]), None, 20, "deg", severity="soft", fmt="{:.1f}")
    gap_svc = float(M.H_tree.query(svcV)[0].min())
    c.note(f"SVC Y {svcV[:, 1].min():.3f}..{svcV[:, 1].max():.3f}; CC_R(1) band {np.round(M.cc['R'][0]['band'], 3).tolist()}, CC_R(3) band {np.round(M.cc['R'][2]['band'], 3).tolist()}; min SVC-to-heart-wall distance {gap_svc / MM:.1f} mm")

    c = new("GV-11")
    Lsvc = float(np.ptp((svcV - svcV.mean(axis=0)) @ vt[0]))
    rad = []
    for y in ys_:
        sv = svcV[np.abs(svcV[:, 1] - y) < 0.01]
        if len(sv) > 5:
            rad.append(np.ptp(sv[:, 0]) / 2 + np.ptp(sv[:, 2]) / 2)
    D_svc = float(np.median(rad)) if rad else float("nan")
    c.band("L", Lsvc, 0.6, 0.8, "u", typical=0.7)
    c.band("D", D_svc, 0.15, 0.30, "u", typical=0.2)

    c = new("GV-12")
    ivcV = m["GreatVessel_IVC"].V
    ivc_top = ivcV[ivcV[:, 1] >= ivcV[:, 1].max() - 0.03].mean(axis=0)
    # hiatus = the height where Diaphragm vertices crowd around the IVC wall (the caval foramen)
    best_y, best_n = float("nan"), 0
    for y in np.arange(ivcV[:, 1].max(), ivcV[:, 1].max() - 0.8, -0.01):
        sl = ivcV[np.abs(ivcV[:, 1] - y) < 0.01]
        if len(sl) < 5:
            continue
        cc_ = sl.mean(axis=0)
        rr_ = (np.ptp(sl[:, 0]) + np.ptp(sl[:, 2])) / 4
        n_ = int(((np.abs(dia[:, 1] - y) < 0.015) & (np.hypot(dia[:, 0] - cc_[0], dia[:, 2] - cc_[2]) < rr_ + 0.05)).sum())
        if n_ > best_n:
            best_y, best_n = float(y), n_
    y_hiatus = best_y
    gap_ivc = float(M.H_tree.query(ivcV)[0].min())
    c.band("levels outside T8", max(0.0, abs(M.level_of(y_hiatus) - 8.5) - 0.5), None, 1.0, "levels", fmt="{:.2f}")
    c.cond("right of midline", ivc_top[0] < Xm, "X_IVC < X_mid", f"IVC top x {ivc_top[0]:.3f}")
    c.band("entry - hiatus", ivcV[:, 1].max() - y_hiatus, 0.0, 0.3, severity="soft")
    c.cond("entry behind TA", ivc_top[2] < TA.c[2], "entry.z < TA.c.z", f"entry.z {ivc_top[2]:.3f}, TA.c.z {TA.c[2]:.3f}")
    rad = []
    for y in np.linspace(ivcV[:, 1].min() + 0.05, ivcV[:, 1].max() - 0.05, 10):
        sl = ivcV[np.abs(ivcV[:, 1] - y) < 0.01]
        if len(sl) > 5:
            rad.append((np.ptp(sl[:, 0]) + np.ptp(sl[:, 2])) / 2)
    c.band("D", float(np.median(rad)) if rad else float("nan"), None, 0.21, severity="soft")
    c.band("IVC-to-RA gap", gap_ivc, None, 0.01, severity="soft")
    c.note(f"hiatus y {y_hiatus:.3f} (level {M.level_of(y_hiatus):.1f}; T8 body {V[7]['top']:.3f}..{V[7]['bottom']:.3f}); IVC top y {ivcV[:, 1].max():.3f}; the IVC mesh stops {gap_ivc / MM:.1f} mm short of the heart wall")

    c = new("GV-13")
    pvm = m["GreatVessel_PulmonaryVeins"]
    ost_c, Ds = [], []
    for Vc, _ in components(pvm.V, pvm.F, 30):
        dH, _ = M.H_tree.query(Vc)
        ring_ = Vc[dH < 0.015]
        if len(ring_) < 8:
            continue
        ost_c.append(ring_.mean(axis=0))
        _, _, vt2 = np.linalg.svd(ring_ - ring_.mean(axis=0), full_matrices=False)
        Ds.append(float(np.ptp((ring_ - ring_.mean(axis=0)) @ vt2[:2].T, axis=0).mean()))
    n_ost = len(ost_c)
    ost_c = np.array(ost_c) if ost_c else np.zeros((0, 3))
    c.band("n_ostia", n_ost, 3, 5, "", fmt="{:.0f}", typical=4)
    zc = float(m["Heart_Wall_Posterior"].V[:, 2].mean())
    c.cond("ostia posterior", bool(n_ost) and bool(np.all(ost_c[:, 2] < zc)), "ostium.z < centroid_z(Heart_Wall_Posterior)", "ostia z: " + ", ".join(f"{z:.2f}" for z in ost_c[:, 2]) + f" vs {zc:.2f}")
    if n_ost:
        c.band("median D_ostium", float(np.median(Ds)), 0.09, 0.14, severity="soft")
        right = [d for d, p in zip(Ds, ost_c) if p[0] < Xm]
        left = [d for d, p in zip(Ds, ost_c) if p[0] >= Xm]
        if right and left:
            c.cond("right >= left", np.mean(right) >= np.mean(left), "mean D right >= left", f"right {np.mean(right) / MM:.1f} mm, left {np.mean(left) / MM:.1f} mm", severity="soft")
    c.note("ostia = GreatVessel_PulmonaryVeins components touching the heart wall (contact ring <= 1.5 mm; D = mean in-plane extent of the ring); centres " + "; ".join(str(np.round(p, 2).tolist()) for p in ost_c))

    # ------------------------------------------------------------------ CORONARIES
    lad, lcx, rca, lm = tr["LAD"], tr["LCX"], tr["RCA"], tr["LM"]
    pda, pl = tr["RCA_PDA"], tr["RCA_PL"]
    aoTM = m["GreatVessel_Aorta"].tm
    rs = ao["root_axis"]

    c = new("COR-01")
    dR = float(abs(signed_distance(aoTM, rca.P[:1])[0]))
    dL = float(abs(signed_distance(aoTM, lm.P[:1])[0]))
    c.band("dist(RCA ostium, Aorta)", dR, None, 0.03)
    c.band("dist(LM ostium, Aorta)", dL, None, 0.03)
    def h_plane(X):
        return float(((X - AoV.c) @ AoV.n) / max(1e-6, float(rs @ AoV.n)))

    h_stj = h_plane(P[ao["i_stj"]])
    hR, hL = h_plane(rca.P[0]), h_plane(lm.P[0])
    M.h_naive = (float((rca.P[0] - AoV.c) @ rs), float((lm.P[0] - AoV.c) @ rs))
    c.cond("in the root", max(hR, hL) <= h_stj + 0.10 and min(hR, hL) >= 0, "0 <= h <= h_STJ + 0.10", f"h_RCA {hR:.3f}, h_LM {hL:.3f}, h_STJ {h_stj:.3f}")
    c.band("RCA0.z - LM0.z", rca.P[0][2] - lm.P[0][2], 0.03, None)
    c.band("RCA0.x - LM0.x", rca.P[0][0] - lm.P[0][0], None, -0.03)
    n_ao = sum(1 for v in M.v.values() if v["segments"][0].attach == "aorta")
    c.band("n_ostia", n_ao, 2, 2, "", fmt="{:.0f}")

    c = new("COR-02")
    c.band("h_LM", hL, 0.07, 0.23, typical=0.144)
    c.band("h_RCA", hR, 0.10, 0.24, typical=0.172)
    c.band("h_RCA - h_LM", hR - hL, -0.05, 0.10, typical=0.028)
    c.note(f"heights from the (tilted) cap plane along root_axis; centre-based (X0 - AoV.c) . root_axis gives h_RCA {M.h_naive[0]:.3f}, h_LM {M.h_naive[1]:.3f}; Y(RCA ostium) - Y(LM ostium) = {rca.P[0][1] - lm.P[0][1]:.3f}")

    c = new("COR-03")
    c.band("L", lm.L, 0.02, 0.25, "u", typical="0.05-0.15")
    c.band("D", 2 * np.median(lm.r), 0.027, 0.055, "u", typical="0.035-0.045", fmt="{:.4f}")

    c = new("COR-04")
    chord = lm.P[-1] - lm.P[0]
    c.cond("chord mostly +X", int(np.argmax(np.abs(chord))) == 0 and chord[0] > 0, "argmax|chord| = x, chord.x > 0", f"chord ({chord[0]:.3f}, {chord[1]:.3f}, {chord[2]:.3f})")
    ptV = m["GreatVessel_PulmonaryArtery"].V
    beh, tot = 0, 0
    for p in lm.P:
        sel = ptV[(np.abs(ptV[:, 0] - p[0]) <= 0.02) & (np.abs(ptV[:, 1] - p[1]) <= 0.02)]
        if len(sel):
            tot += 1
            beh += int(sel[:, 2].min() > p[2])
    c.cond("behind PT", tot == 0 or beh == tot, "Z_LM < Z_PT where the PT overlies it", f"{beh}/{tot} overlapped LM samples lie wholly behind the pulmonary trunk")
    kids = [(k, v["segments"][0]) for k, v in M.v.items() if v["parent"] == "LM"]
    bad = [k for k, sg in kids if np.linalg.norm(sg.P[0] - lm.P[-1]) > 0.01]
    c.cond("no LM side branches", not bad, "attach at LM end", f"children {[k for k, _ in kids]} attach at the LM end" if not bad else f"{bad} attach before the LM end")

    def chord10(sg):
        return at_s(sg.P, 0.10) - sg.P[0]

    c = new("COR-05")
    c.band("lad_lcx_deg", angle_deg(chord10(lad), chord10(lcx)), 30, 130, "deg", fmt="{:.1f}", typical=75)
    t_end = lm.P[-1] - at_s(lm.P, max(0.0, lm.L - 0.03))
    c.band("lm_lad_deg", angle_deg(t_end, chord10(lad)), 15, 60, "deg", fmt="{:.1f}", typical=37.5)
    c.note(f"LM-LCX angle {angle_deg(t_end, chord10(lcx)):.1f} deg")

    c = new("COR-06")
    k = int(np.argmin(np.linalg.norm(lad.P - apex, axis=1)))
    dd = lad.P[k] - lad.P[0]
    c.band("dx", dd[0], 0.0, None)
    c.band("dy", dd[1], None, 0.0)
    c.band("dz", dd[2], 0.0, None)
    c.band("apex_gap", np.linalg.norm(lad.P[k] - apex), None, 0.15)
    sd, cav = M.sd_epi(lad.P)
    c.band("groove fraction (dist <= r + 0.10)", float((np.abs(sd) <= lad.r + 0.10).mean()), 0.9, None, "")
    wrap = lad.s[-1] - lad.s[k]
    c.note(f"LAD continues {wrap / MM:.0f} mm past the point nearest the apex (wrap-around {'yes' if wrap > 0.05 else 'no'})")

    # LAD first-order branches: side of the anterior IV groove
    c = new("COR-08")
    lad_segs = M.v["LAD"]["segments"]
    diag, rvb = [], []
    for i, sg in enumerate(lad_segs[1:], start=1):
        if sg.parent != 0:
            continue
        xl = M.X_LAD(sg.P[:, 1])
        ok = ~np.isnan(xl)
        lv_side = float((sg.P[ok, 0] >= xl[ok] - 0.02).mean()) if ok.any() else float("nan")
        (diag if lv_side >= 0.5 else rvb).append((i, sg, lv_side))
    crossing = [i for i, sg, f in diag if f < 0.9]
    big = [i for i, sg, f in diag if sg.d0() >= 0.015]
    c.cond("diagonals stay on the LV", not crossing, ">= 90% of each diagonal on the LV side", f"LV-side branches {[i for i, _, _ in diag]}; crossing: {crossing or 'none'}")
    c.band("n_diag (d0 >= 1.5 mm)", len(big), 1, 4, "", fmt="{:.0f}", severity="soft", typical=2)
    c.note("first-order LAD branches: " + "; ".join(f"seg{i} d0 {sg.d0() / MM:.1f} mm, L {sg.L / MM:.0f} mm, LV-side {f:.0%}" for i, sg, f in sorted(diag + rvb, key=lambda x: x[0])))
    c.note(f"{len(rvb)} first-order branches run onto the RV (RV / conal branches of the LAD, not diagonals): {[i for i, _, _ in rvb]}")
    M.lad_diag, M.lad_rvb = diag, rvb

    c = new("COR-09")
    sep_frac, takeoffs, lens_a, lens_i, d_main = [], [], [], [], []
    for vid, parent_id in (("LAD_SEPTAL", "LAD"), ("RCA_SEPTAL", "RCA_PDA")):
        par = tr[parent_id]
        for sg in M.v[vid]["segments"]:
            sdv, cavv = M.sd_epi(sg.P)
            intra = (sdv < 0) & (-sdv > sg.r)
            sep_frac.append((vid, float(intra.mean())))
            if sg.parent is None:
                kk = int(np.argmin(np.linalg.norm(par.P - sg.P[0], axis=1)))
                tpar = par.P[min(kk + 3, len(par.P) - 1)] - par.P[max(kk - 3, 0)]
                takeoffs.append(angle_deg(tpar, at_s(sg.P, 0.05) - sg.P[0]))
                (lens_a if vid == "LAD_SEPTAL" else lens_i).append(sg.L)
                if vid == "LAD_SEPTAL":
                    d_main.append(sg.d0())
    c.band("min intramyocardial fraction", min(f for _, f in sep_frac), 0.7, None, "", severity="hard")
    c.band("takeoff min", min(takeoffs), 30, 100, "deg", fmt="{:.0f}")
    c.band("takeoff max", max(takeoffs), 30, 100, "deg", fmt="{:.0f}")
    c.band("d_main", max(d_main), 0.010, 0.030, "u", severity="soft", fmt="{:.4f}")
    c.band("L_anterior_max", max(lens_a), 0.20, None, "u", severity="soft")
    c.band("L_inferior_each (max)", max(lens_i), None, 0.20, "u", severity="soft")
    c.note("intramyocardial fraction per septal segment: " + ", ".join(f"{v[:3]} {f:.2f}" for v, f in sep_frac) + "; take-offs " + ", ".join(f"{t:.0f}" for t in takeoffs) + " deg")

    c = new("COR-07")
    c.band("L", lad.L, 0.72, 1.45, "u", typical="1.0-1.3")

    c = new("COR-10")
    dMA = MA.dist(lcx.P)
    s_l = lcx.s
    c.band("max ring dist (s <= 0.2)", float(dMA[s_l <= 0.2].max()), None, 0.20)
    c.band("max ring dist (s > 0.2)", float(dMA[s_l > 0.2].max()) if (s_l > 0.2).any() else 0.0, None, 0.15)
    c.band("axial_spread", float(np.ptp((lcx.P - bc) @ u)), None, 0.25)
    zz = lcx.P[s_l > 0.2, 2]
    rise = float(np.max(zz - np.minimum.accumulate(zz))) if len(zz) else 0.0
    c.band("z_rise_after_0p2", rise, None, 0.02)
    k_min = int(np.argmin(dMA))
    after = np.flatnonzero((np.arange(len(dMA)) > k_min) & (dMA > 0.15))
    s_leave = float(s_l[after[0]]) if len(after) else float(lcx.L)
    in_groove = s_l[dMA <= 0.15]
    s_enter = float(in_groove.min()) if len(in_groove) else float("nan")
    c.note(f"the LCX is within 15 mm of the mitral hinge ring only from s = {s_enter / MM:.0f} to {s_leave / MM:.0f} mm (closest {dMA.min() / MM:.0f} mm at s = {s_l[k_min] / MM:.0f} mm); the remaining {(lcx.L - s_leave) / MM:.0f} mm leave the AV groove and run down the lateral wall to {np.linalg.norm(lcx.P[-1] - apex) / MM:.0f} mm from the apex, i.e. an obtuse-marginal course")
    M.lcx_leave = s_leave

    c = new("COR-11")
    c.band("L_LCX", lcx.L, 0.41, 1.08, "u", typical="0.5-0.8")
    c.band("ratio L_LAD/L_LCX", lad.L / lcx.L, 1.2, 2.5, "", typical=1.65)
    c.note(f"LCX up to the point where it leaves the AV groove: {s_leave / MM:.0f} mm (would pass as a normal LCX length if the remainder were relabelled OM)")

    c = new("COR-12")
    oms, others = [], []
    for i, sg in enumerate(M.v["LCX"]["segments"][1:], start=1):
        if sg.parent != 0:
            continue
        closer = np.linalg.norm(sg.P[-1] - apex) <= np.linalg.norm(sg.P[0] - apex) - 0.1
        xl = M.X_LAD(sg.P[:, 1])
        lat = (sg.P[:, 0] > bc[0] + 0.1) & (np.isnan(xl) | (sg.P[:, 0] >= xl))
        rec = (i, sg.d0(), sg.L, closer, float(lat.mean()))
        (oms if sg.d0() >= 0.015 else others).append(rec)
    c.band("n_OM (d0 >= 1.5 mm)", len(oms), 1, 4, "", fmt="{:.0f}", severity="soft", typical=2)
    bad_om = [o for o in oms if not (o[3] and o[4] >= 0.8)]
    c.cond("OMs run apically on the lateral wall", not bad_om, "each OM ends >= 0.1 u nearer the apex, >= 80% lateral", f"{len(oms) - len(bad_om)}/{len(oms)} OMs qualify")
    c.note("first-order LCX branches: " + "; ".join(f"seg{i} d0 {d / MM:.1f} mm, L {L / MM:.0f} mm, apical {ok_str(cl)}, lateral {f:.0%}" for i, d, L, cl, f in oms + others))
    c.note("the LCX 'trunk' beyond the AV groove behaves as the real OM1 (see COR-10)")

    # RCA
    k_crux = int(np.argmin(np.linalg.norm(rca.P - pda.P[0], axis=1)))
    s_crux = float(rca.s[k_crux])
    crux = pda.P[0]
    c = new("COR-13")
    t = at_s(rca.P, 0.1) - rca.P[0]
    c.band("t.z", t[2], 0.0, None)
    c.band("t.x", t[0], None, 0.0)
    mid = (rca.s >= 0.25 * s_crux) & (rca.s <= 0.60 * s_crux)
    dTA = TA.dist(rca.P[mid])
    c.band("max TA-ring dist (mid part)", float(dTA.max()), None, 0.15)
    c.note(f"mid RCA (s {0.25 * s_crux / MM:.0f}-{0.6 * s_crux / MM:.0f} mm) lies {np.median(dTA) / MM:.0f} mm (median) from the tricuspid hinge ring; it runs on the anterior RV surface (z up to {rca.P[mid, 2].max():.2f}) instead of the right AV groove; the TA ring is at z {TA.c[2]:.2f}")
    am = M.H_epi[(M.H_epi[:, 0] < H[:, 0].min() + 0.15) & (M.H_epi[:, 1] < bc[1])]
    c.band("acute margin gap", float(cKDTree(am).query(rca.P)[0].min()) if len(am) else float("nan"), None, 0.10)
    c.cond("crux below/behind AV centre", crux[1] < bc[1] and crux[2] < bc[2] + 0.05, "crux.y < bc.y, crux.z < bc.z + 0.05", f"crux ({crux[0]:.3f}, {crux[1]:.3f}, {crux[2]:.3f}); base_center ({bc[0]:.3f}, {bc[1]:.3f}, {bc[2]:.3f})")

    c = new("COR-14")
    c.band("L to crux", s_crux, 0.9, 1.5, "u", typical="1.2-1.4")
    c.band("ratio L/L_LAD", s_crux / lad.L, 0.9, 1.5, "", typical=1.1)
    c.note(f"RCA trunk total {rca.L / MM:.0f} mm; {(rca.L - s_crux) / MM:.0f} mm continue beyond the PDA origin (should be SCCT 16, R-PLB)")

    c = new("COR-15")
    c.band("rise over first 0.3 u", float(rca.P[rca.s <= 0.3, 1].max() - rca.P[0, 1]), None, 0.03)

    c = new("COR-16")
    mv = M.v["RCA_MARGINAL"]["segments"]
    allP = np.vstack([sg.P for sg in mv])
    ant = allP[allP[:, 2] > bc[2]]
    xl = M.X_LAD(ant[:, 1])
    okm = ~np.isnan(xl)
    rvf = float((ant[okm, 0] <= xl[okm] + 0.02).mean())
    c.band("rv_side_fraction", rvf, 0.95, None, "")
    lt = cKDTree(lad.P)
    ends = [float(lt.query(sg.P[-1])[0]) for sg in mv]
    c.band("min dist(branch end, LAD)", min(ends), 0.03, None)
    c.note("marginal-branch end distances to the LAD trunk: " + ", ".join(f"{e / MM:.0f}" for e in ends) + " mm")

    c = new("COR-17")
    c.band("attach_fraction", s_crux / rca.L, 0.6, None, "")
    c.cond("diaphragmatic", bool(np.all(pda.P[:, 1] <= bc[1])), "all Y <= base_center.y", f"max Y {pda.P[:, 1].max():.3f} vs {bc[1]:.3f}")
    da = np.linalg.norm(pda.P - apex, axis=1)
    c.band("max increase of apex distance", float(np.max(da - np.minimum.accumulate(da))), None, 0.02)
    c.band("end_to_apex", float(da[-1]), None, 0.25)
    sdp, _ = M.sd_epi(pda.P)
    c.band("epicardial fraction", float((np.abs(sdp) <= pda.r + 0.10).mean()), 0.7, None, "")

    c = new("COR-18")
    c.cond("arises distal to the PDA", np.linalg.norm(pl.P[0] - rca.P[-1]) < 0.02 and rca.L > s_crux, "attach_s > s(PDA)", f"PL origin at RCA s = {rca.L / MM:.0f} mm vs PDA at {s_crux / MM:.0f} mm")
    ch = at_s(pl.P, 0.1) - pl.P[0]
    c.band("chord(0->0.1).x", ch[0], 0.0, None)
    _, nn = M.H_tree.query(pl.P)
    seg_pl = M.aha(H[nn])
    c.band("inferior fraction", float(np.isin(seg_pl, [4, 5, 10, 11, 15, 16]).mean()), 0.7, None, "")
    u_, cnt_ = np.unique(seg_pl, return_counts=True)
    c.note("AHA segments under the PL: " + ", ".join(f"{a}:{b}" for a, b in zip(u_, cnt_)))

    c = new("COR-19")
    c.cond("PDA parent RCA", M.v["RCA_PDA"]["parent"] == "RCA", "RCA_PDA.parent == RCA", f"parent = {M.v['RCA_PDA']['parent']}")
    c.cond("no L-PDA/L-PLB labels", True, "no _SEGMENT 15/18", "no _SEGMENT attribute present")
    c.band("lcx_end_to_crux", float(np.linalg.norm(lcx.P[-1] - crux)), 0.1, None)
    c.cond("dominance declared right", "right-dominant" in json.dumps(M.manifest.get("territories", {})), "manifest declares right dominance", "territories.interpretation mentions right-dominant")

    c = new("COR-20")

    def thirds(sg, s_end=None):
        s_end = s_end or sg.L
        sel = sg.s <= s_end
        ss, rr = sg.s[sel], sg.r[sel]
        return [float(2 * np.median(rr[(ss >= s_end * a) & (ss <= s_end * b)])) for a, b in ((0, 1 / 3), (1 / 3, 2 / 3), (2 / 3, 1))]

    dl, dx_, dr = thirds(lad), thirds(lcx), thirds(rca, s_crux)
    c.band("d_pLAD", dl[0], 0.022, 0.049, typical=0.035, fmt="{:.4f}")
    c.band("d_mLAD", dl[1], 0.011, 0.037, typical=0.024, fmt="{:.4f}")
    c.band("d_dLAD", dl[2], 0.006, 0.027, typical=0.016, fmt="{:.4f}")
    c.band("d_pLCX", dx_[0], 0.015, 0.046, typical=0.031, fmt="{:.4f}")
    c.band("d_mLCX", dx_[1], 0.007, 0.036, typical=0.022, fmt="{:.4f}")
    c.band("d_dLCX", dx_[2], 0.004, 0.028, typical=0.016, fmt="{:.4f}")
    c.band("d_pRCA", dr[0], 0.023, 0.046, typical=0.034, fmt="{:.4f}")
    c.band("d_mRCA", dr[1], 0.018, 0.045, typical=0.032, fmt="{:.4f}")
    c.band("d_dRCA", dr[2], 0.014, 0.038, typical=0.026, fmt="{:.4f}")
    dLM = float(2 * np.median(lm.r))
    c.cond("order", dLM > dl[0] >= dr[0] > dx_[0], "d_LM > d_pLAD >= d_pRCA > d_pLCX", f"LM {dLM / MM:.2f} / pLAD {dl[0] / MM:.2f} / pRCA {dr[0] / MM:.2f} / pLCX {dx_[0] / MM:.2f} mm")
    c.band("ratio_LAD", dl[2] / dl[0], 0.30, 0.70, "", typical=0.46)
    c.band("ratio_LCX", dx_[2] / dx_[0], 0.30, 0.80, "", typical=0.53)
    c.band("ratio_RCA", dr[2] / dr[0], 0.55, 1.00, "", typical=0.77)
    # taper rule and child < parent
    viol_g, viol_c = [], []
    for vid, v in M.v.items():
        for j, sg in enumerate(v["segments"]):
            d = 2 * sg.r
            branch_s = [float(sg.s[np.argmin(np.linalg.norm(sg.P - ch_.P[0], axis=1))]) for ch_ in v["segments"] if ch_.parent == j]
            for a in range(len(sg.s)):
                if sg.s[a] < 0.06:  # the first <= 6 mm bridge onto the parent / aortic wall (ATTACH_MAX)
                    continue
                b = np.searchsorted(sg.s, sg.s[a] + 0.1)
                if b >= len(sg.s):
                    break
                if vid == "RCA" and j == 0 and sg.s[b] <= 0.3:
                    continue
                if any(0 <= bs - sg.s[b] <= 0.05 for bs in branch_s):
                    continue
                if d[a + 1 : b + 1].max() - d[a] > 0.003:
                    viol_g.append(f"{vid}[{j}]@{sg.s[a] / MM:.0f}mm")
                    break
            if sg.parent is not None:
                par = v["segments"][sg.parent]
                kk = int(np.argmin(np.linalg.norm(par.P - sg.P[0], axis=1)))
                if sg.d0() >= 2 * par.r[kk]:
                    viol_c.append(f"{vid}[{j}]")
    c.cond("taper (growth <= 0.003 u / 0.1 u)", not viol_g, "no growth window violation", f"{len(viol_g)} segments grow: " + ", ".join(viol_g[:6]))
    c.cond("child < parent", not viol_c, "child d0 < parent d", f"{len(viol_c)} children not narrower: " + ", ".join(viol_c[:6]))
    c.note("trunk thirds used (no SCCT labels); RCA thirds over ostium -> crux; the growth rule skips the first 6 mm of each segment (vessels.json bridge onto the parent)")

    c = new("COR-21")
    tot_in, tot, cav_n, pen_list = 0, 0, 0, []
    for vid in ("LM", "LAD", "LCX", "RCA", "RCA_PDA", "RCA_PL", "RCA_MARGINAL"):
        for sg in M.v[vid]["segments"]:
            sdv, cavv = M.sd_epi(sg.P)
            inb = (sdv >= -0.005) & (sdv <= sg.r + 0.10)
            tot_in += int(inb.sum())
            tot += len(sdv)
            cav_n += int(cavv.sum())
            pen_list.append((vid, float(-sdv.min())))
    c.band("in_band_fraction", tot_in / tot, 0.95, None, "")
    c.band("cavity samples", cav_n, 0, 0, "", fmt="{:.0f}")
    worst_pen = sorted(pen_list, key=lambda x: -x[1])[:4]
    c.note("deepest intramyocardial epicardial-vessel samples: " + ", ".join(f"{v} {p / MM:.1f} mm" for v, p in worst_pen))
    deep_txt = []
    for vid in ("LM", "LAD", "LCX", "RCA"):
        sg = M.v[vid]["segments"][0]
        sdv, _ = M.sd_epi(sg.P)
        d_ = sdv < -0.005
        if d_.any():
            deep_txt.append(f"{vid} trunk {int(d_.sum())} samples ({d_.sum() * 0.8:.0f} mm) deeper than 0.5 mm, between s = {sg.s[d_].min() / MM:.0f} and {sg.s[d_].max() / MM:.0f} mm")
    if deep_txt:
        c.note("; ".join(deep_txt))
    c.note("no epicardial-fat layer is modelled; the band tests the vessel-to-epicardium gap only")

    c = new("COR-22")
    gj = glb_json(GLB) if GLB.exists() else {}
    has_seg = any("_SEGMENT" in p["attributes"] for mm in gj.get("meshes", []) for p in mm["primitives"])
    has_scct = any("scct" in s for v in M.v.values() for s in v["raw"]["segments"])
    has_man = "segments" in M.manifest
    c.cond("_SEGMENT attribute", has_seg, "_SEGMENT on coronary meshes (CONTRACTS 7.1)", f"present: {ok_str(has_seg)}")
    c.cond("vessels.json scct/code", has_scct, "segments carry scct + code", f"present: {ok_str(has_scct)}")
    c.cond("manifest.segments", has_man, "manifest.segments[]", f"present: {ok_str(has_man)}")
    if not (has_seg or has_scct):
        c.absent = True

    # territories
    if M.HC is not None:
        M.log("AHA-17 territories")
        segH = M.aha(H)
        lvm = M.lv_mask(H)
        W = M.HC
        wsum = W.sum(axis=1)
        keep = lvm & (segH > 0) & (wsum > 0.05)
        arg = np.argmax(W, axis=1)
        c = new("COR-23")
        for sgn in (2, 7, 8, 13):
            sel = keep & (segH == sgn)
            c.band(f"seg{sgn} LAD-majority", float((arg[sel] == 0).mean()) if sel.any() else float("nan"), 0.5, None, "", fmt="{:.2f}")
        c.note(f"LV region: {lvm.sum()} heart-wall vertices; papillary levels t_tip {M.aha_levels['t_tip']:.2f}, t_base {M.aha_levels['t_base']:.2f} ({M.aha_levels['n_lv_papillary_components']} LV papillary components)")
        c = new("COR-24")
        names = {0: "LAD", 1: "LCX", 2: "RCA"}
        expect_maj = {1: 0, 14: 0, 6: 1, 5: 1, 4: 2, 3: 2, 9: 2, 10: 2}
        mism = []
        maj_txt = []
        for sgn in range(1, 18):
            sel = keep & (segH == sgn)
            if not sel.any():
                maj_txt.append(f"{sgn}:-")
                continue
            cnt = np.bincount(arg[sel], minlength=3)
            mj = int(np.argmax(cnt))
            maj_txt.append(f"{sgn}:{names[mj]}")
            if sgn in expect_maj and mj != expect_maj[sgn]:
                mism.append(f"{sgn} is {names[mj]} (expected {names[expect_maj[sgn]]})")
        c.cond("majority map", not mism, "1,14 LAD; 5,6 LCX; 3,4,9,10 RCA", "mismatches: " + (", ".join(mism) or "none"))
        A = vertex_areas(H, M.HF)
        wa = (W[lvm] * A[lvm, None]).sum(axis=0)
        sh = wa / wa.sum()
        c.band("share_LAD", sh[0], 0.40, 0.50, "", typical=0.425)
        c.band("share_LCX", sh[1], 0.20, 0.35, "", typical=0.288)
        c.band("share_RCA", sh[2], 0.20, 0.30, "", typical=0.264)
        c.note("majority by segment: " + " ".join(maj_txt))
        c.note(f"shares normalised over the weighted channels; un-normalised weight coverage of the LV region {float((wsum[lvm] * A[lvm]).sum() / A[lvm].sum()):.2f}")

    # ------------------------------------------------------------------ VEINS
    vs = M.veins()
    byname: dict[str, list] = {}
    for vv in vs:
        byname.setdefault(vv["name"], []).append(vv)
    allVein = weld(m["CardiacVeins"].V, m["CardiacVeins"].F)[0]
    vtree = cKDTree(allVein)
    CS = byname.get("CS", [None])[0]
    GCV = max(byname.get("GCV", [None]), key=lambda x: x["L"] if x else 0) if byname.get("GCV") else None
    MCV = byname.get("MCV", [None])[0]

    c = new("VEN-01")
    cs_D = float(2 * np.median(CS["r"])) if CS else float("nan")
    c.cond("CS", CS is not None, "coronary sinus present", f"present (median D {cs_D / MM:.1f} mm)" if CS else "absent")
    c.band("D_CS >= 0.06", cs_D, 0.06, None, "u")
    c.cond("AIV/GCV", GCV is not None, "GCV/AIV present", ok_str(GCV is not None))
    c.cond("MCV", MCV is not None, "MCV present", ok_str(MCV is not None))
    c.cond("PVLV", "PVLV" in byname, "PVLV present", ok_str("PVLV" in byname), severity="soft")
    c.cond("LMV", "LMV" in byname, "left marginal vein present (66.7%)", "absent: BodyParts3D has no left marginal vein part", severity="soft")
    c.note(f"CardiacVeins = {len(vs)} labelled pieces: " + ", ".join(f"{v['name']} ({len(v['V'])} v, L {v['L'] / MM:.0f} mm)" for v in vs) + f"; labels from {M.vein_label_source}; the small cardiac vein (FMA4714) is listed in BodyParts3D but its mesh is not published")

    c = new("VEN-02")
    sel = lad.s <= 2 / 3 * lad.L
    dv, iv = vtree.query(lad.P[sel])
    c.band("paired_fraction", float((dv <= 0.10).mean()), 0.80, None, "")
    near = allVein[iv[dv <= 0.10]]
    xl = M.X_LAD(near[:, 1])
    okx = ~np.isnan(xl)
    c.band("lv_side_fraction", float((near[okx, 0] >= xl[okx]).mean()) if okx.any() else float("nan"), 0.5, None, "", severity="soft")
    if GCV is not None:
        gt = cKDTree(GCV["P"])
        dg, ig = gt.query(lad.P[sel])
        ratio = float(np.median(2 * GCV["r"][ig[dg < 0.1]]) / np.median(2 * lad.r[sel][dg < 0.1])) if (dg < 0.1).any() else float("nan")
        c.band("calibre_ratio d_AIV/d_LAD", ratio, 0.6, 1.6, "", severity="soft")
    c.note(f"median LAD-to-vein distance over the proximal 2/3: {np.median(dv) / MM:.1f} mm")

    c = new("VEN-03")
    dvp, _ = vtree.query(pda.P)
    c.band("paired_fraction", float((dvp <= 0.10).mean()), 0.70, None, "")
    c.note(f"median PDA-to-vein distance {np.median(dvp) / MM:.1f} mm")

    c = new("VEN-04")
    ringS = MA.samples(360)
    ring_tree = cKDTree(ringS)
    csp = allVein[(allVein[:, 2] < bc[2]) & (MA.dist(allVein) <= 0.20)]
    n_atr = MA.n  # fit_ring was hinted with -u_ba (toward the atria)
    if CS is not None and len(csp):
        c.band("atrial_side_fraction", float(((csp - MA.c) @ n_atr > 0).mean()), 0.75, None, "", typical=0.93)
        Pc = CS["P"]
        tang = np.gradient(smooth_path(Pc, 5), axis=0)
        _, ir = ring_tree.query(Pc)
        rt_ = np.gradient(ringS, axis=0)[ir]
        ang = np.array([min(angle_deg(a, b), 180 - angle_deg(a, b)) for a, b in zip(tang, rt_)])
        c.band("parallel_fraction", float((ang <= 30).mean()), 0.80, None, "")
        c.band("min_ma_dist (CS centreline)", float(MA.dist(Pc).min()), 0.04, 0.18)
    else:
        c.absent = True
    c.note(f"CS portion = {len(csp)} CardiacVeins vertices posterior to the base and within 20 mm of the MA ring")

    c = new("VEN-05")
    if CS is not None:
        ends = [CS["P"][0], CS["P"][-1]]
        o = min(ends, key=lambda p: p[0])
        c.band("dist(ostium, TA ring)", float(TA.dist(o[None])[0]), None, 0.25)
        c.cond("medial to IVC", o[0] > ivc_top[0], "o.x > IVC_top.x", f"o.x {o[0]:.3f}, IVC top x {ivc_top[0]:.3f}")
        c.cond("anterior to IVC", o[2] > ivc_top[2], "o.z > IVC_top.z", f"o.z {o[2]:.3f}, IVC top z {ivc_top[2]:.3f}")
        c.cond("above IVC", o[1] > ivc_top[1], "o.y > IVC_top.y", f"o.y {o[1]:.3f}, IVC top y {ivc_top[1]:.3f}")
        M.cs_ostium = o
    else:
        c.absent = True

    c = new("VEN-06")
    groove = [vv for vv in vs if vv["name"] in ("CS", "GCV")]
    if groove:
        GP = np.vstack([g["P"] for g in groove])
        gtree = cKDTree(GP)
        dlc, ilc = gtree.query(lcx.P)
        shared = dlc <= 0.15
        inner = MA.dist(lcx.P[shared]) < MA.dist(GP[ilc[shared]])
        c.band("lcx_inner_fraction", float(inner.mean()) if shared.any() else float("nan"), 0.5, None, "")
        c.band("median gap (shared stretch)", float(np.median(dlc[shared])) if shared.any() else float("nan"), 0.01, 0.10)
        c.note(f"{shared.sum()} of {len(lcx.P)} LCX samples share the groove (vein centreline within 15 mm)")
    else:
        c.absent = True

    c = new("VEN-07")
    if GCV is not None:
        gP = GCV["P"]
        bifp = lm.P[-1]
        kt = int(np.argmin(np.linalg.norm(gP - bifp, axis=1)))
        turn = gP[kt]
        pl_ = lad.P[lad.s <= lad.L / 3]
        pc_ = lcx.P[lcx.s <= min(lcx.L / 3, 0.3)]
        d1 = float(cKDTree(pl_).query(gP)[0].min())
        d2 = float(cKDTree(pc_).query(gP)[0].min())
        c.band("min dist(GCV, pLAD)", d1, None, 0.10)
        c.band("min dist(GCV, pLCX)", d2, None, 0.10)
        c.note(f"GCV point nearest the LM bifurcation is {np.linalg.norm(turn - bifp) / MM:.0f} mm away")
    else:
        c.absent = True

    c = new("VEN-08")
    def dia_at(vv, where):
        P_, r_ = vv["P"], vv["r"]
        n = max(3, len(P_) // 10)
        return float(2 * np.median(r_[:n] if where == 0 else r_[-n:]))

    if CS:
        o_end = 0 if CS["P"][0][0] <= CS["P"][-1][0] else -1
        c.band("D_CS", float(2 * np.median(CS["r"])), 0.06, 0.12, typical=0.09)
        c.band("D_CS_ostium", dia_at(CS, o_end), 0.06, 0.15)
    if GCV:
        c.band("D_GCV (AV-groove part)", float(2 * np.median(GCV["r"][GCV["P"][:, 2] < 0.1])) if (GCV["P"][:, 2] < 0.1).any() else float("nan"), 0.03, 0.085, typical=0.056)
        aiv = GCV["P"][:, 2] >= 0.1
        c.band("D_AIV_prox", float(2 * np.median(GCV["r"][aiv][:max(3, aiv.sum() // 3)])) if aiv.any() else float("nan"), 0.015, 0.065, typical=0.039)
    if MCV and CS:
        skp, skr = MCV["sk"].pos, MCV["sk"].radius
        k0 = int(np.argmin(cKDTree(CS["V"]).query(skp)[0]))
        near_k = np.linalg.norm(skp - skp[k0], axis=1) < 0.01
        c.band("D_MCV_ostium", float(2 * np.median(skr[near_k])), 0.028, 0.068, typical=0.048)
    if CS and GCV:
        c.band("cs_gcv_ratio", float(np.median(CS["r"]) / np.median(GCV["r"])), 1.3, 2.2, "")
    c.note("diameters = 2 x centreline-to-wall distance of each labelled piece (BodyParts3D veins are cadaveric, i.e. collapsed)")

    c = new("VEN-09")
    if CS and GCV:
        L_CS = CS["L"]
        c.band("L_CS", L_CS, 0.20, 0.55)
        # CS + GCV path from the ostium to the AIV turn (point nearest the LM bifurcation)
        csP = CS["P"] if CS["P"][0][0] <= CS["P"][-1][0] else CS["P"][::-1]
        gP = GCV["P"]
        j0 = int(np.argmin(np.linalg.norm(gP - csP[-1], axis=1)))
        kt = int(np.argmin(np.linalg.norm(gP - lm.P[-1], axis=1)))
        gpath = gP[j0 : kt + 1] if kt >= j0 else gP[kt : j0 + 1][::-1]
        gapCG = float(np.linalg.norm(gP[j0] - csP[-1]))
        path = np.vstack([csP, gpath])
        sp = arclen(path)
        c.band("L_CS_GCV", float(sp[-1]), 0.75, 1.45, typical=1.10)
        ptree = cKDTree(path)
        if MCV:
            dq_all, iq_all = ptree.query(MCV["sk"].pos)
            k = int(np.argmin(dq_all))
            c.band("s_MCV", float(sp[iq_all[k]]), 0.01, 0.21, typical=0.106)
            c.note(f"the MCV's closest approach to the CS/GCV path is {dq_all[k] / MM:.1f} mm (it does not join the CS)" if dq_all[k] > 0.01 else f"MCV joins {dq_all[k] / MM:.1f} mm from the CS/GCV path")
        for pv_ in byname.get("PVLV", []):
            dq_all, iq_all = ptree.query(pv_["sk"].pos)
            k = int(np.argmin(dq_all))
            c.note(f"PVLV piece joins at s = {sp[iq_all[k]] / MM:.0f} mm (gap {dq_all[k] / MM:.1f} mm)")
        c.band("s_AIV", float(sp[-1]), 0.67, 1.64)
        c.cond("LMV", False, "s_LMV 0.41-1.13 u", "no left marginal vein", severity="soft")
        c.note(f"CS->GCV gap {gapCG / MM:.1f} mm; MCV length {MCV['L'] / MM:.0f} mm" if MCV else "")
        if MCV:
            c.band("L_MCV", MCV["L"], 0.35, 1.15)
    else:
        c.absent = True

    c = new("VEN-10")
    n_tree = getattr(M, "vein_tree_pieces", None)
    if n_tree is None:
        n_tree = sum(1 for vv in vs if vv["name"] != "ACV")
    c.band("pieces of the CS tree (expect 1)", n_tree, 1, 1, "", fmt="{:.0f}")
    gaps = []
    if CS:
        trunk_tree = cKDTree(np.vstack([vv["V"] for vv in vs if vv["name"] in ("CS", "GCV")]))
        for vv in vs:
            if vv["name"] in ("CS", "ACV"):
                continue
            if not len(vv["V"]):
                continue
            if vv["name"] == "GCV":
                g_ = float(cKDTree(CS["V"]).query(vv["V"])[0].min())
            else:
                g_ = float(trunk_tree.query(vv["V"])[0].min())
            gaps.append((vv["name"], g_))
    c.note("surface gap from each piece to the CS/GCV trunk (GCV: to the CS): " + ", ".join(f"{n} {g / MM:.1f} mm" for n, g in gaps)
           + (f"; {n_tree} connected lumen(s) drain through the CS" if getattr(M, "vein_tree_pieces", None) is not None else "; the pieces touch or nearly touch but are not joined into one lumen"))
    pvV = weld(m["GreatVessel_PulmonaryVeins"].V, m["GreatVessel_PulmonaryVeins"].F)[0]
    c.band("min dist(veins, pulmonary veins)", float(cKDTree(pvV).query(allVein)[0].min()), 0.005, None)
    ost = getattr(M, "cs_ostium", None)
    cand = allVein if ost is None else allVein[np.linalg.norm(allVein - ost, axis=1) > 0.08]
    ins = M.inside_myocardium(cand)
    depth = trimesh.proximity.closest_point(M.H_tm, cand[ins])[1] if ins.any() else np.zeros(1)
    c.band("max penetration into myocardium (excl. 8 mm around the CS ostium)", float(depth.max()), None, 0.005)
    c.note(f"{int(ins.sum())} vein vertices lie inside the heart-wall solid; 95th-percentile depth {np.percentile(depth, 95) / MM:.1f} mm")
    ep = []
    for vv in vs:
        sdc, _ = M.sd_epi(vv["P"])
        ep.append((np.abs(sdc) <= vv["r"] + 0.07))
    c.band("epicardial_fraction (centrelines)", float(np.concatenate(ep).mean()), 0.95, None, "")

    c = new("VEN-11")
    if GCV:
        gP = GCV["P"]
        lat = gP[(gP[:, 0] > bc[0]) & (gP[:, 2] < 0.1)]
        c.cond("lateral GCV on the left", len(lat) > 0 and bool(np.all(lat[:, 0] > bc[0])), "X > base_center.x", f"{len(lat)} lateral samples")
        # left auricle proxy: atrial (t < 0 along the LV axis) epicardium at the far left
        a_ax = unit(apex - MA.c)
        HE = M.H_epi
        tE = (HE - MA.c) @ a_ax
        laa = HE[(tE < -0.02) & (HE[:, 0] > MA.c[0] + 0.1) & (HE[:, 2] > MA.c[2])]
        below = []
        for p in lat:
            q = laa[(np.abs(laa[:, 0] - p[0]) < 0.05) & (np.abs(laa[:, 2] - p[2]) < 0.05)]
            if len(q):
                below.append(p[1] < q[:, 1].min() + 0.01)
        c.cond("below the left auricle", (np.mean(below) >= 0.8) if below else True, "Y below the auricle", f"{sum(below)}/{len(below)} overlapped samples below the auricle proxy (atrial epicardium left of the MA)")
    c.cond("SCV", False, "small cardiac vein (optional)", "not modelled (FMA4714 has no published BodyParts3D mesh; absent or tiny in ~60 %)", severity="soft")
    acv = byname.get("ACV", [])
    if acv:
        AV_ = acv[0]["V"]
        xl = M.X_LAD(AV_[:, 1])
        okx = ~np.isnan(xl)
        rv_frac = float((AV_[okx, 0] < xl[okx]).mean())
        c.band("ACV on anterior RV (fraction)", rv_frac, 0.9, None, "")
        dca = float(cKDTree(np.vstack([sg.P for sg in M.v["RCA"]["segments"]])).query(AV_)[0].min())
        c.band("ACV-RCA crossing distance", dca, None, 0.03)
        dcs = float(cKDTree(CS["V"]).query(AV_)[0].min()) if CS else float("nan")
        c.band("ACV clear of the CS", dcs, 0.05, None)

    # ------------------------------------------------------------------ COLOUR
    gj = glb_json(GLB) if GLB.exists() else {}
    mats = gj.get("materials", [])
    node_mat = {}
    for mm in gj.get("meshes", []):
        node_mat[mm["name"]] = mats[mm["primitives"][0]["material"]] if mm["primitives"][0].get("material") is not None else {}

    def hsv(node):
        f = (node_mat.get(node, {}).get("pbrMetallicRoughness", {}) or {}).get("baseColorFactor", [1, 1, 1, 1])
        srgb = [(12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055) for x in f[:3]]
        h, s_, v_ = colorsys.rgb_to_hsv(*srgb)
        return h * 360, s_, v_

    fe = frontend_colours()

    def red(h):
        return h >= 345 or h <= 15

    def blue(h):
        return 200 <= h <= 250

    def viewer(c, kind, want, sat, severity=None):
        """Grade the web viewer's Realistic-look colour for a tissue kind (frontend/src/three/anatomy)."""
        look = fe.get("REALISTIC", {})
        if kind not in look:
            return
        hx = look[kind]
        h, s_, _ = hex_hsv(hx)
        ok = (red(h) if want == "red" else blue(h)) and s_ >= sat
        c.cond(f"viewer {kind}", ok, f"Realistic look: {kind} {want} (S >= {sat})", f"viewer Realistic {kind} = {hx} (hue {h:.0f}, S {s_:.2f})", severity=severity)

    c = new("COL-01")
    arts = ["GreatVessel_Aorta", "Coronary_LM", "Coronary_LAD", "Coronary_LAD_Septal", "Coronary_LCX", "Coronary_RCA",
            "Coronary_RCA_Marginal", "Coronary_RCA_PDA", "Coronary_RCA_PL", "Coronary_RCA_Septal"]
    bad = [n for n in arts if not (red(hsv(n)[0]) and hsv(n)[1] >= 0.5)]
    c.cond("glTF materials red", not bad, "hue 345-15, S >= 0.5", f"glTF: {len(arts) - len(bad)}/{len(arts)} red (aorta hue {hsv('GreatVessel_Aorta')[0]:.0f}, S {hsv('GreatVessel_Aorta')[1]:.2f})" + (f"; off: {bad}" if bad else ""))
    viewer(c, "aorta", "red", 0.5)
    viewer(c, "leftMain", "red", 0.5, severity="soft")
    if fe.get("REALISTIC"):
        c.note("coronary targets are coloured by the risk ramp in the viewer (allowed by the rule)")

    c = new("COL-02")
    vns = ["GreatVessel_SVC", "GreatVessel_IVC", "CardiacVeins"]
    bad = [n for n in vns if not (blue(hsv(n)[0]) and hsv(n)[1] >= 0.35)]
    c.cond("glTF materials blue", not bad, "hue 200-250, S >= 0.35", f"glTF: {len(vns) - len(bad)}/{len(vns)} blue" + (f"; off: {bad}" if bad else ""))
    viewer(c, "systemicVein", "blue", 0.35)
    viewer(c, "cardiacVein", "blue", 0.35)
    if "showVeins_default" in fe:
        c.cond("cardiac veins shown", fe["showVeins_default"], "viewer shows CardiacVeins by default",
               f"sceneControls showVeins default = {str(fe['showVeins_default']).lower()} (veins hidden until toggled)", severity="soft")
    if fe.get("CLINICAL"):
        cl = {k: fe["CLINICAL"].get(k) for k in ("aorta", "systemicVein", "pulmonaryArtery", "pulmonaryVeins", "cardiacVein")}
        c.note("Clinical look (achromatic by design, not graded): " + ", ".join(f"{k} {v}" for k, v in cl.items() if v))

    c = new("COL-03")
    hA, sA, _ = hsv("GreatVessel_PulmonaryArtery")
    hV, sV, _ = hsv("GreatVessel_PulmonaryVeins")
    c.cond("glTF PA blue", blue(hA), "PA hue 200-250", f"glTF PA hue {hA:.0f}")
    c.cond("glTF PV red", red(hV), "PV hue 345-15", f"glTF PV hue {hV:.0f}")
    viewer(c, "pulmonaryArtery", "blue", 0.35)
    viewer(c, "pulmonaryVeins", "red", 0.35)
    if fe.get("_source"):
        c.note("viewer colours parsed from " + fe["_source"])
    return checks


def hex_hsv(hx: str) -> tuple[float, float, float]:
    r, g, b = (int(hx[i : i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return h * 360, s, v


def frontend_colours() -> dict:
    """Web-viewer colours per tissue kind, parsed from frontend/src (best effort; {} if not parseable).

    Reads the per-tissue looks in three/anatomy/tissue.ts (CLINICAL / REALISTIC), resolving ANATOMY.* from
    theme/tokens.ts and REAL.* from three/anatomy/palette.ts, and the showVeins default in
    three/stage/sceneControls.ts. The frontend is edited by other agents; the result reflects the working
    tree at run time.
    """
    consts: dict[str, dict[str, str]] = {}
    for rel, name in (("theme/tokens.ts", "ANATOMY"), ("three/anatomy/palette.ts", "REAL")):
        f = FRONTEND / rel
        if f.exists():
            m = re.search(rf"export const {name}\s*=\s*\{{(.*?)\}}", f.read_text(encoding="utf-8"), re.S)
            if m:
                consts[name] = dict(re.findall(r"(\w+)\s*:\s*'(#[0-9A-Fa-f]{6})'", m.group(1)))
    out: dict = {}
    tis = FRONTEND / "three" / "anatomy" / "tissue.ts"
    if tis.exists():
        t = tis.read_text(encoding="utf-8")
        for look in ("CLINICAL", "REALISTIC"):
            m = re.search(rf"const {look}\b[^=]*=\s*\{{(.*?)\n\}};", t, re.S)
            if not m:
                continue
            body, kinds = m.group(1), {}
            for km in re.finditer(r"\n  (\w+): \{(.*?)(?=\n  \w+: \{|\Z)", body, re.S):
                cm = re.search(r"color:\s*(?:([A-Z]+)\.(\w+)|'(#[0-9A-Fa-f]{6})')", km.group(2))
                if not cm:
                    continue
                hx = cm.group(3) or consts.get(cm.group(1), {}).get(cm.group(2))
                if hx:
                    kinds[km.group(1)] = hx
            out[look] = kinds
        out["_source"] = "frontend/src/three/anatomy/tissue.ts (+ palette.ts, theme/tokens.ts)"
    sc = FRONTEND / "three" / "stage" / "sceneControls.ts"
    if sc.exists():
        m = re.search(r"showVeins:\s*(true|false)\s*,", sc.read_text(encoding="utf-8"))
        if m:
            out["showVeins_default"] = m.group(1) == "true"
    return out


# =============================================================================================
# Output
# =============================================================================================
def md_escape(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def to_markdown(checks: list[Check], fixes: dict[str, str] | None = None) -> str:
    fixes = fixes or {}
    rows = ["| Check | Title | Sev | Expected | Measured | Verdict | Suggested fix |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for c in checks:
        meas = c.measured_text()
        if c.notes:
            meas += " — " + " / ".join(n for n in c.notes if n)
        fix = fixes.get(c.id, "") if c.verdict != "PASS" else ""
        rows.append(f"| {c.id} | {md_escape(c.title)} | {c.severity[0].upper()} | {md_escape(c.expected_text())} | {md_escape(meas)} | **{c.verdict}** | {md_escape(fix)} |")
    return "\n".join(rows) + "\n"


def summary(checks: list[Check]) -> dict[str, int]:
    out = {"PASS": 0, "MINOR": 0, "FAIL": 0, "N/A": 0}
    for c in checks:
        out[c.verdict] += 1
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--glb", type=Path, default=GLB)
    ap.add_argument("--raw", action="store_true", help="read anatomy/build/cardiotwin_anatomy.raw.glb instead of decoding the published GLB")
    ap.add_argument("--markdown", type=Path)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--only", help="comma-separated check-id prefixes (e.g. COR,VEN-02)")
    ap.add_argument("--render", type=Path, help="re-render --markdown from a saved --json result without re-measuring")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:  # pragma: no cover
        pass

    import yaml

    if args.render:
        saved = json.loads(args.render.read_text(encoding="utf-8"))
        rows = ["| Check | Title | Sev | Expected | Measured | Verdict | Suggested fix |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for c in saved["checks"]:
            meas = "; ".join(sb["text"] + ("" if sb["ok"] else " \u2717") for sb in c["subs"])
            if c["notes"]:
                meas += " \u2014 " + " / ".join(n for n in c["notes"] if n)
            fix = FIXES.get(c["id"], "") if c["verdict"] != "PASS" else ""
            exp = "; ".join(sb["expected"] for sb in c["subs"])
            rows.append(f"| {c['id']} | {md_escape(c['title'])} | {c['severity'][0].upper()} | {md_escape(exp)} | {md_escape(meas)} | **{c['verdict']}** | {md_escape(fix)} |")
        out = "\n".join(rows) + "\n"
        if args.markdown:
            args.markdown.write_text(out, encoding="utf-8")
        print("SUMMARY " + "  ".join(f"{k} {v}" for k, v in saved["summary"].items()) + f"  (source: {saved['source']})")
        return 0

    ych = {c["id"]: c for c in yaml.safe_load(YAML.read_text(encoding="utf-8"))["checks"]} if YAML.exists() else {}
    if args.raw:
        meshes, _ = read_plain_glb(RAW_GLB)
        source = str(RAW_GLB.relative_to(REPO))
    else:
        try:
            meshes, source = decode_with_node(args.glb)
        except Exception as e:  # noqa: BLE001
            print(f"[measure] Node decoding unavailable ({e}); falling back to the raw GLB", file=sys.stderr)
            meshes, _ = read_plain_glb(RAW_GLB)
            source = str(RAW_GLB.relative_to(REPO))
    manifest = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
    vessels = load_vessels(PUBLIC / "vessels.json")
    M = Model(meshes, manifest, vessels, source)
    checks = run_checks(M, ych)
    if args.only:
        pref = tuple(p.strip() for p in args.only.split(","))
        checks = [c for c in checks if c.id.startswith(pref)]
    checks.sort(key=lambda c: (["POS", "CHM", "VLV", "GV", "COR", "VEN", "COL"].index(c.id.split("-")[0]), int(c.id.split("-")[1])))
    for c in checks:
        print(f"{c.id:7s} {c.verdict:5s} {c.title}")
        for s in c.subs:
            print(f"          {'ok ' if s.ok else 'XX '} {s.text}   [expect {s.expected}; {s.severity}]")
        for n in c.notes:
            if n:
                print(f"          note: {n}")
    cnt = summary(checks)
    print("\nSUMMARY " + "  ".join(f"{k} {v}" for k, v in cnt.items()) + f"  (source: {source})")
    if args.markdown:
        args.markdown.write_text(to_markdown(checks, FIXES), encoding="utf-8")
    if args.json:
        args.json.write_text(json.dumps({"source": source, "summary": cnt, "checks": [
            {"id": c.id, "title": c.title, "severity": c.severity, "verdict": c.verdict, "notes": c.notes,
             "subs": [{"name": s.name, "value": s.value if not isinstance(s.value, float) or math.isfinite(s.value) else None,
                       "ok": s.ok, "expected": s.expected, "severity": s.severity, "text": s.text} for s in c.subs]}
            for c in checks]}, indent=1, default=float), encoding="utf-8")
    return 0


#: Pipeline fix per check (shown in the markdown table when the verdict is not PASS).
FIXES: dict[str, str] = {
    "POS-01": "No change.",
    "POS-03": "Derive base_center from the mitral/tricuspid hinge-ring centres (mo.heart_long_axis uses the centroid of all valve vertices, which the chordae pull toward the apex).",
    "POS-04": "No change (apex behind rib 5 at the MCL, within +/-1 space).",
    "POS-06": "BodyParts3D source position: the RA roof / SVC junction sits at the CC2 level. Document it, or tilt the Layer_Heart group ~5 deg clockwise (frontal view) about the apex in build_anatomy.py and re-run POS-06/POS-10.",
    "POS-07": "No change.",
    "POS-09": "build_anatomy.py: after assembly, push display-only neighbours out of the heart and great vessels: move Lung_L/Lung_R mediastinal vertices and Spine_Thoracic anterior vertices along their normals until the signed distance to the heart, aorta and coronaries is >= 1 mm (lungs are ghosted, so edit the lungs, not the heart).",
    "POS-10": "Lower the Diaphragm central-tendon vertices under the heart so the gap is 0-5 mm (diaphragm is display-only; it currently cuts up to 2.7 mm into the diaphragmatic surface).",
    "POS-11": "No change.",
    "VLV-02": "No change.",
    "VLV-04": "Source geometry: the tricuspid hinge is ~1 cm more basal than the mitral hinge (should be 0-15 mm more apical). Translate Valve_Tricuspid and its hinge region ~12 mm along u_ba, or accept and document as a BodyParts3D limitation.",
    "VLV-05": "BodyParts3D has no aortic valve and the aorta ends in an oblique cap ~29 mm above the mitral valve: loft an aortic root (annulus + three sinuses) from the GreatVessel_Aorta cap down to the anterior mitral hinge, add a Valve_Aortic node (3 cusps), re-derive AoV from it.",
    "VLV-06": "Pulmonary hinge ring 31 mm (sanity band 17-25 mm): scale Valve_Pulmonary radially ~0.8 about its axis, or accept (low-grade reference band). Tricuspid hinge should be >= mitral: widen the tricuspid ring or accept.",
    "GV-01": "Follows from VLV-05: extending the truncated root below the current cap lengthens the ascending aorta to ~5 cm.",
    "GV-02": "Aorta is a uniform 22 mm tube (cadaveric collapse, no sinus bulge): offset the ascending aorta wall outward by ~5 mm and sculpt a sinus-of-Valsalva bulge (D ~32 mm) over the first 2 cm above the annulus before the voxel remesh.",
    "GV-04": "Nudge the arch 2 mm away from the trachea (or shrink the trachea locally) so they touch without intersecting.",
    "GV-05": "The descending aorta overlaps the posterior heart outline by ~1 mm at T6-T8 while also sitting 5 mm inside the vertebral bodies (POS-09): shift the descending aorta ~3 mm left (+X) rather than back.",
    "GV-08": "Follows from GV-02 (aorta too narrow): once the ascending aorta is ~30 mm the PA:Ao ratio drops to ~0.75.",
    "GV-09": "Check the right/left PA branch lengths after the PA skeleton is re-labelled (the right PA gives its upper-lobe trunk early in this mesh).",
    "GV-10": "Add the BodyParts3D brachiocephalic veins (FMA4751, FMA4761) so the SVC starts at the CC1 confluence; the SVC-RA junction sits ~2 cm high (CC2), which is a heart-position issue (POS-06).",
    "GV-11": "Same as GV-10 (the SVC is 37 mm instead of ~70 mm because it starts low and joins a high RA).",
    "GV-13": "No geometry change needed (soft). Optionally trim the pulmonary-vein flares at the LA junction.",
    "COR-02": "Follows from VLV-05: with the aortic root extended down to the real annulus, the ostia rise to the normal 14-17 mm.",
    "COR-08": "Label LAD branches in extract_centerlines.py: LV-side first-order branches become D1/D2 (SCCT 9/10), RV-side ones RV branches; add a second diagonal >= 1.5 mm if only one qualifies.",
    "COR-09": "Septal perforators leave the LAD pointing back toward the base (118-136 deg): rotate each septal's first 10 mm to 45-90 deg from the LAD tangent and sink them >= r below the epicardium.",
    "COR-10": "extract_centerlines.decompose: choose the LCX trunk by adherence to the left AV groove (min distance to the mitral hinge ring), not by longest path; relabel the apical-running continuation as OM1 (SCCT 12) and end the LCX trunk in the posterior AV groove before the crux.",
    "COR-11": "Follows from COR-10 (the 135 mm 'trunk' is LCX 60 mm + OM1 75 mm).",
    "COR-12": "Follows from COR-10: the relabelled OM1 (d0 ~2 mm) satisfies the count; mark small LCX side branches as OM2/atrial branches.",
    "COR-13": "Re-route the proximal-mid RCA into the right AV groove: pull its centreline to ~8-10 mm outside the tricuspid hinge ring (it runs 15-32 mm away on the anterior RV) and re-sweep the tube with the same radii.",
    "COR-15": "Flatten the proximal loop (shepherd's crook, a 5% variant): clamp the first 30 mm of the RCA to <= 3 mm above the ostium, or declare the variant in manifest.json.",
    "COR-16": "No change.",
    "COR-20": "Taper is too steep on LAD (d/p 0.26) and LCX (0.29): re-assign centreline radii with a smooth power-law taper per trunk (pLAD 3.5 -> dLAD 1.6 mm, pLCX 3.1 -> dLCX 1.6 mm) and clamp each child's origin below its parent's local diameter.",
    "COR-21": "Coronary trunks are sunk into the heart wall (proximal RCA inside the right auricle, LAD/LCX origins under/inside the left auricle up to ~3 cm deep): offset each coronary tube along the epicardial normal so its centreline sits r + 0.5-1 mm outside H_epi, carve the auricle where it swallows the vessel, and add an epicardial-fat shell in the grooves.",
    "COR-22": "Implement CONTRACTS v1.1 7.1: extract_centerlines.py assigns scct/code per segment with the SCCT 2014 boundaries (REFERENCE 5.9), build_anatomy.py bakes a _SEGMENT vertex attribute on every Coronary_* mesh by nearest-centreline lookup, make_manifest.py adds manifest.segments[].",
    "COR-23": "See COR-24 (segment 2 is only just LAD-majority).",
    "COR-24": "Territories are pure nearest-artery softmax, so RCA_PL/RCA_Marginal claim 48% of the LV: blend the softmax with the AHA-17 standard map (Cerqueira 2002, Ortiz-Perez 2008 specificities), split the septum by the septal perforators (anterior 2/3 LAD, posterior 1/3 RCA) and cap the RCA_PL reach on the inferolateral wall.",
    "VEN-01": "CS is collapsed (4.7 mm): offset the CS wall outward to ~9-10 mm; synthesise a left marginal vein alongside OM1 (not in BodyParts3D).",
    "VEN-04": "Move the coronary sinus 5-8 mm toward the atrium (-u_ba) so >= 75% of it lies on the LA side of the mitral hinge (it is 73% on the ventricular side now).",
    "VEN-05": "Nudge the CS ostium ~5 mm anterior so it lies in front of the IVC orifice (Koch's triangle base).",
    "VEN-06": "Follows from COR-10/VEN-04: once the LCX follows the AV groove and the CS moves atrially, the LCX lies between CS and mitral annulus.",
    "VEN-08": "Veins are cadaveric/collapsed: dilate CS (x1.9), GCV (x1.6) and the MCV ostium (x1.5) with a radial offset before the union in VEN-10.",
    "VEN-09": "The BodyParts3D 'coronary sinus' part is 68 mm long: relabel its left 20-30 mm as GCV (Vieussens at ~30-40 mm from the ostium); the MCV (129 mm) is fine to keep. No LMV (see VEN-01).",
    "VEN-10": "Union the five CS-tree parts into one lumen (voxel remesh at 0.3 mm as done for the aorta) and push vein vertices out of the myocardium (offset so the centreline sits r + 1 mm outside H_epi; today 54% of vein vertices lie inside the wall, p95 depth 2 mm).",
    "VEN-11": "Add BodyParts3D FMA4714 (small cardiac vein) to the CardiacVeins parts in anatomy/config/anatomy.json.",
    "COL-01": "GLB is correct. The viewer's Realistic look (three/anatomy/tissue.ts) paints the aorta REAL.adventitia (pale, hue ~22, S 0.18) on purpose (palette.ts: arteries never red so nothing reads as risk). To meet the atlas convention use a dark, desaturated arterial red for the aorta (e.g. hue 0-8, S ~0.55, L well below the ramp) and keep Clinical/clay achromatic; record the decision in DESIGN_SYSTEM 7.9.",
    "COL-02": "Realistic look already paints SVC/IVC/CardiacVeins atlas blue (#3A4E78). Remaining gap: sceneControls.showVeins defaults to false, so the cardiac veins are hidden unless toggled; default it to true in the Realistic look (the owner wants the veins visible).",
    "COL-03": "Realistic look paints the pulmonary artery with the same pale adventitia as the aorta: give GreatVessel_PulmonaryArtery a (muted) venous blue like the systemic veins; the pulmonary veins (#6E3D3B, red hue) already follow the convention.",
}

if __name__ == "__main__":
    sys.exit(main())
