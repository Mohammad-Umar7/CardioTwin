"""Stage 1b — correct and complete the BodyParts3D anatomy before the Blender build.

BodyParts3D is a segmentation of one (cadaveric) body. Some structures are collapsed, sunk into the
heart wall or simply absent. This stage writes *derived* meshes (``anatomy/build/synth/*.ply``, in the
BodyParts3D millimetre frame so the Blender build treats them exactly like source parts) and a
machine-readable report. Everything here is deterministic.

What is synthesised (each item is documented in ``anatomy/README.md`` and ``docs/anatomy``):

* **Cardiac veins** (``SYN_CardiacVeins``) — the five BodyParts3D vein parts are skeletonised, labelled
  (CS / GCV / AIV / MCV / PVLV / ACV), joined into one tree that drains through the coronary-sinus
  ostium, given in-vivo calibres (BodyParts3D veins are collapsed: CS 4.7 mm instead of ~9 mm) and
  re-seated *outside* the epicardium (54 % of the source vein vertices lay inside the myocardium).
  The coronary sinus is lifted onto the atrial side of the mitral hinge and its ostium placed in
  front of the IVC orifice. The course of every vein is the BodyParts3D course.
* **Aortic root and valve** (``SYN_AorticRoot``, ``SYN_AorticValve``) — BodyParts3D has no aortic
  root or valve: the aorta ends in a flat cap 29 mm from the mitral valve. A root with three sinuses
  of Valsalva (right / left / non-coronary, placed by the coronary ostia) is lofted from an annulus
  towards the anterior mitral leaflet up to the sino-tubular junction, with three semilunar cusps.
* **Ascending aorta calibre** (``SYN_AortaAscending``) — the 22 mm BodyParts3D tube is inflated
  radially about its own centreline (in-vivo 25-33 mm), fading back to the source calibre at the arch.
* **Epicardial fat** (``SYN_EpicardialFat``) — lobulated fat filling the atrioventricular and
  interventricular grooves (about 7 mm), with the coronary trunks and veins lying in shallow channels.

Usage::

    ./.venv/Scripts/python anatomy/scripts/synthesize.py
"""
from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import networkx as nx
import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "blender"))
import meshops as mo  # noqa: E402
from common import BUILD_DIR, RAW_DIR, load_config, write_json  # noqa: E402
from extract_centerlines import decompose, prune_spurs, smooth_resample  # noqa: E402

SYNTH_DIR = BUILD_DIR / "synth"
REPORT = SYNTH_DIR / "synth_report.json"
VEIN_LINES = SYNTH_DIR / "vein_centerlines.json"
MM = 0.01  # the synthesis works in scene units (Blender frame, 1 u = 10 cm) and writes millimetres
T0 = time.perf_counter()

#: BodyParts3D cardiac-vein parts and the label of their main course.
VEIN_PARTS = {"FMA4706": "CS", "FMA4707": "GCV", "FMA4713": "MCV", "FMA76751": "PVLV", "FMA71567": "ACV"}
#: Vein label codes for the ``_VEIN`` vertex attribute (manifest ``veins`` table).
VEIN_CODES = {"CS": 1, "GCV": 2, "AIV": 3, "MCV": 4, "PVLV": 5, "ACV": 6}
#: Coronary-sinus length from the ostium to the valve of Vieussens / vein of Marshall (CT 30 mm, 21-40;
#: REFERENCE.md §6.2). The BodyParts3D "coronary sinus" part is 68 mm long; beyond this it is labelled GCV.
CS_LENGTH_MM = 40.0
#: In-vivo lumen radii (mm) along each labelled course, from its drainage end: (radius at s=0, radius at
#: s=ref_mm, radius at the distal tip). REFERENCE.md §6.2-6.4 (CT / CMR calibres).
RADIUS_PROFILE_MM = {
    "CS": (5.0, 4.1, 4.0),
    "GCV": (3.0, 2.7, 2.5),
    "AIV": (2.0, 1.25, 0.8),
    "MCV": (2.4, 1.6, 0.8),
    "PVLV": (1.7, 1.2, 0.7),
    "ACV": (1.0, 0.8, 0.55),
}
PROFILE_REF_MM = {"CS": CS_LENGTH_MM, "GCV": 50.0, "AIV": 50.0, "MCV": 40.0, "PVLV": 30.0, "ACV": 20.0}


def log(msg: str) -> None:
    print(f"[synth {time.perf_counter() - T0:6.1f}s] {msg}", flush=True)


# =============================================================================================
# Inputs
# =============================================================================================
class Parts:
    """Cleaned BodyParts3D parts in scene units (Blender frame: +X left, -Y anterior, +Z superior)."""

    def __init__(self, cfg: dict):
        self.cleanup = cfg["cleanup"]
        self.cache: dict[str, mo.Mesh] = {}
        heart = self.mm("FMA7274")
        self.origin_mm = mo.bbox_center(heart[0])

    def mm(self, pid: str) -> mo.Mesh:
        if pid not in self.cache:
            V, F = mo.read_stl(RAW_DIR / f"{pid}.stl")
            (V, F), _ = mo.filter_components(
                V, F, min_fraction=self.cleanup["min_component_fraction"], min_faces=self.cleanup["min_component_faces"],
                drop_inverted=self.cleanup["drop_inverted_components"],
            )
            self.cache[pid] = (V, F)
        return self.cache[pid]

    def scene(self, pid: str) -> mo.Mesh:
        V, F = self.mm(pid)
        return (V - self.origin_mm) * MM, F

    def to_mm(self, V: np.ndarray) -> np.ndarray:
        return np.asarray(V) / MM + self.origin_mm


class Surface:
    """Closest-point queries on a closed, outward-oriented mesh (signed distance > 0 outside)."""

    def __init__(self, V: np.ndarray, F: np.ndarray):
        self.tm = trimesh.Trimesh(V, F, process=False)
        self.fn = self.tm.face_normals

    def closest(self, P: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(closest point, outward unit normal there, signed distance) for each query point."""
        q, d, tri = trimesh.proximity.closest_point(self.tm, P)
        n = self.fn[tri]
        sign = np.sign(np.einsum("ij,ij->i", P - q, n))
        sign[sign == 0] = 1.0
        return q, n, d * sign


def heart_frame(parts: Parts) -> dict:
    """Long axis and mitral hinge plane (same definitions as the build and anatomy/checks)."""
    wall_V, _ = parts.scene("FMA7274")
    valve_V = np.concatenate([parts.scene(p)[0] for p in ("FMA7235", "FMA7234")])
    base, apex, axis = mo.heart_long_axis(wall_V, valve_V)
    u_ba = -axis  # base -> apex
    tree = cKDTree(wall_V)
    rings = {}
    for key, pid in (("MA", "FMA7235"), ("TA", "FMA7234")):
        V, _ = parts.scene(pid)
        touch = tree.query(V)[0] <= 1.0 * MM
        proj = (V - base) @ u_ba
        sel = touch & (proj <= np.quantile(proj, 0.25))
        P = V[sel]
        c = P.mean(axis=0)
        _, _, vt = np.linalg.svd(P - c, full_matrices=False)
        n = vt[2] if vt[2] @ (-u_ba) > 0 else -vt[2]  # towards the atria
        r = float(np.median(np.linalg.norm((P - c) - np.outer((P - c) @ n, n), axis=1)))
        rings[key] = {"c": c, "n": n, "r": r}
    return {"base": base, "apex": apex, "u_ba": u_ba, **rings}


# =============================================================================================
# Skeletons of the source vein parts
# =============================================================================================
PITCH = 0.3 * MM


def tree_paths(V: np.ndarray, F: np.ndarray, root_hint) -> list[tuple[np.ndarray, int | None]]:
    """Centreline paths of one connected vessel piece, rooted at the leaf chosen by ``root_hint``.

    ``root_hint(points) -> index`` picks the drainage end among the skeleton leaves.
    """
    mesh = trimesh.Trimesh(V, F, process=False)
    vg = mesh.voxelized(PITCH).fill()
    grid = np.pad(vg.matrix, 2)
    origin = vg.transform[:3, 3] - 2 * PITCH
    edt = ndimage.distance_transform_edt(grid)
    # extract_centerlines' helpers use its own PITCH; rebuild the graph at this pitch
    from skimage.morphology import skeletonize

    skel = skeletonize(grid)
    idx = np.argwhere(skel)
    if len(idx) < 4:
        return []
    pos = origin + idx * PITCH
    lookup = {tuple(v): i for i, v in enumerate(idx)}
    g = nx.Graph()
    g.add_nodes_from(range(len(idx)))
    offs = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) > (0, 0, 0)]
    for i, (x, y, z) in enumerate(idx):
        for dx, dy, dz in offs:
            j = lookup.get((x + dx, y + dy, z + dz))
            if j is not None:
                g.add_edge(i, j, weight=PITCH * math.sqrt(dx * dx + dy * dy + dz * dz))
    local_r = edt[idx[:, 0], idx[:, 1], idx[:, 2]] * PITCH
    comp = max(nx.connected_components(g), key=len)
    tree = nx.minimum_spanning_tree(g.subgraph(comp), weight="weight")
    leaves = [n for n in tree.nodes if tree.degree(n) <= 1] or list(tree.nodes)
    root = leaves[int(root_hint(pos[leaves]))]
    tree = prune_spurs(tree, root, np.maximum(local_r, 3 * PITCH))
    out = []
    for path, parent in decompose(tree, root):
        P = pos[path]
        L = float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())
        if parent is not None and L < 4.0 * MM:
            continue
        out.append((smooth_resample(P, 0.8 * MM), parent))
    # re-index parents after dropping short twigs (nearest earlier path to each start point)
    fixed = []
    for i, (P, parent) in enumerate(out):
        if i == 0:
            fixed.append((P, None))
            continue
        d = [np.min(np.linalg.norm(out[j][0] - P[0], axis=1)) for j in range(i)]
        fixed.append((P, int(np.argmin(d))))
    return fixed


def arclen(P: np.ndarray) -> np.ndarray:
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]


def resample(P: np.ndarray, spacing: float) -> np.ndarray:
    s = arclen(P)
    n = max(2, int(round(s[-1] / spacing)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.column_stack([np.interp(t, s, P[:, k]) for k in range(3)])


def smooth_polyline(P: np.ndarray, iterations: int = 10, pin_ends: bool = True) -> np.ndarray:
    P = P.copy()
    for _ in range(iterations):
        Q = P.copy()
        Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
        if not pin_ends:
            Q[0], Q[-1] = P[0], P[-1]
        P = Q
    return P


# =============================================================================================
# Tube sweeping
# =============================================================================================
def frames(P: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rotation-minimising frames (double reflection, Wang et al. 2008) along a polyline."""
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    n = len(P)
    N = np.zeros_like(P)
    a = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N[0] = mo.unit(np.cross(T[0], a))
    for i in range(n - 1):
        v1 = P[i + 1] - P[i]
        c1 = v1 @ v1
        if c1 < 1e-20:
            N[i + 1] = N[i]
            continue
        rL = N[i] - (2 / c1) * (v1 @ N[i]) * v1
        tL = T[i] - (2 / c1) * (v1 @ T[i]) * v1
        v2 = T[i + 1] - tL
        c2 = v2 @ v2
        N[i + 1] = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-20 else rL
        N[i + 1] = mo.unit(N[i + 1] - (N[i + 1] @ T[i + 1]) * T[i + 1])
    B = np.cross(T, N)
    return T, N, B


def sweep_tube(P: np.ndarray, R: np.ndarray, sides: int, *, cap_start: str = "flat", cap_end: str = "round") -> mo.Mesh:
    """Closed tube along ``P`` with radii ``R``; caps are 'flat' or 'round' (hemispherical)."""
    T, N, B = frames(P)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ca, sa = np.cos(ang), np.sin(ang)
    verts = []
    ring_list = []

    def add_ring(c, r, n_, b_):
        start = len(verts)
        for k in range(sides):
            verts.append(c + r * (ca[k] * n_ + sa[k] * b_))
        ring_list.append(start)

    # round start cap rings (inside the parent usually, so 'flat' is the default)
    if cap_start == "round":
        for f in (0.35, 0.7, 0.92):
            t = math.sqrt(1 - f * f)
            add_ring(P[0] - T[0] * R[0] * t, R[0] * f, N[0], B[0])
    for i in range(len(P)):
        add_ring(P[i], R[i], N[i], B[i])
    if cap_end == "round":
        for f in (0.92, 0.7, 0.35):
            t = math.sqrt(1 - f * f)
            add_ring(P[-1] + T[-1] * R[-1] * t, R[-1] * f, N[-1], B[-1])
    V = np.array(verts)
    F = []
    for a, b in zip(ring_list[:-1], ring_list[1:]):
        for k in range(sides):
            k2 = (k + 1) % sides
            F.append((a + k, b + k, b + k2))
            F.append((a + k, b + k2, a + k2))
    # end fans
    c0 = len(V)
    first = P[0] - T[0] * R[0] * (1.0 if cap_start == "round" else 0.0)
    last = P[-1] + T[-1] * R[-1] * (1.0 if cap_end == "round" else 0.0)
    V = np.vstack([V, first, last])
    a, b = ring_list[0], ring_list[-1]
    for k in range(sides):
        k2 = (k + 1) % sides
        F.append((c0, a + k2, a + k))
        F.append((c0 + 1, b + k, b + k2))
    F = np.array(F, dtype=np.int64)
    if mo.signed_volume(V, F) < 0:
        F = F[:, ::-1]
    return V, F


# =============================================================================================
# Cardiac veins
# =============================================================================================
def radius_profile(label: str, s_mm: np.ndarray, s0_mm: float = 0.0) -> np.ndarray:
    r0, r1, r2 = RADIUS_PROFILE_MM[label]
    ref = PROFILE_REF_MM[label]
    s = s_mm + s0_mm
    return np.where(s <= ref, r0 + (r1 - r0) * s / ref, r1 + (r2 - r1) * np.clip((s - ref) / 60.0, 0, 1)) * MM


def build_veins(parts: Parts, hf: dict, surf: Surface) -> tuple[mo.Mesh, dict]:
    """One cardiac-vein tree (list of labelled, radius-annotated paths) and its tube mesh."""
    ivc_V, _ = parts.scene("FMA10951")
    ivc_top = ivc_V[ivc_V[:, 2] >= ivc_V[:, 2].max() - 3.0 * MM].mean(axis=0)
    lm_V, _ = parts.scene("FMA4685")
    rca_V, _ = parts.scene("FMA3802")
    aorta_V, _ = parts.scene("FMA3736")
    # LM bifurcation ~ the left-main vertex farthest from the aorta
    lm_bif = lm_V[np.argmax(cKDTree(aorta_V).query(lm_V)[0])]

    paths: list[dict] = []  # {label, P, parent (index into paths), s0 (mm offset for the profile)}

    # --- coronary sinus: root = end nearest the IVC orifice (the ostium) ---------------------
    V, F = parts.scene("FMA4706")
    cs_pieces = tree_paths(V, F, lambda L: np.argmin(np.linalg.norm(L - ivc_top, axis=1)))
    cs_main = cs_pieces[0][0]
    s = arclen(cs_main) / MM
    k_split = int(np.searchsorted(s, CS_LENGTH_MM))
    paths.append({"label": "CS", "P": cs_main[: k_split + 1], "parent": None, "s0": 0.0})
    cs_idx = 0
    if k_split < len(cs_main) - 2:
        paths.append({"label": "GCV", "P": cs_main[k_split:], "parent": cs_idx, "s0": 0.0, "continues": True})
    gcv_from_cs = len(paths) - 1 if k_split < len(cs_main) - 2 else None
    log(f"veins: CS part {s[-1]:.0f} mm -> CS {min(s[-1], CS_LENGTH_MM):.0f} mm + GCV {max(0.0, s[-1] - CS_LENGTH_MM):.0f} mm")

    trunk_pts = lambda: np.vstack([p["P"] for p in paths if p["label"] in ("CS", "GCV", "AIV")])  # noqa: E731

    # --- great cardiac vein / anterior interventricular vein --------------------------------
    V, F = parts.scene("FMA4707")
    cs_end = paths[-1]["P"][-1]
    g_pieces = tree_paths(V, F, lambda L: np.argmin(np.linalg.norm(L - cs_end, axis=1)))
    base_idx = len(paths)
    for i, (P, parent) in enumerate(g_pieces):
        if i == 0:
            # split the main course at the turn beside the LM bifurcation: GCV (AV groove) | AIV (IV groove)
            k_turn = int(np.argmin(np.linalg.norm(P - lm_bif, axis=1)))
            P = np.vstack([cs_end, P]) if np.linalg.norm(P[0] - cs_end) > 0.2 * MM else P
            k_turn = int(np.argmin(np.linalg.norm(P - lm_bif, axis=1)))
            parent_idx = gcv_from_cs if gcv_from_cs is not None else cs_idx
            paths.append({"label": "GCV", "P": P[: k_turn + 1], "parent": parent_idx, "s0": float(arclen(paths[parent_idx]["P"])[-1] / MM) if gcv_from_cs is not None else 0.0})
            gcv_idx = len(paths) - 1
            paths.append({"label": "AIV", "P": P[k_turn:], "parent": gcv_idx, "s0": 0.0, "continues": True})
            continue
        par = base_idx + (parent if parent is not None else 0)
        # sub-branches of the GCV part hang off whichever labelled piece is nearest
        best = min(range(base_idx, len(paths)), key=lambda j: np.min(np.linalg.norm(paths[j]["P"] - P[0], axis=1)))
        paths.append({"label": paths[best]["label"], "P": P, "parent": best, "s0": 25.0, "side": True})
    log(f"veins: GCV part -> {sum(1 for p in paths if p['label'] in ('GCV', 'AIV'))} labelled paths")

    # --- tributaries of the CS/GCV trunk ------------------------------------------------------
    for pid, label in (("FMA4713", "MCV"), ("FMA76751", "PVLV")):
        V, F = parts.scene(pid)
        labels = mo.face_components(F, len(V))
        for lab in np.unique(labels):
            sel = labels == lab
            if sel.sum() < 60:
                continue
            Vc, Fc = mo.compact(V, F, sel)
            tp = trunk_pts()
            tt = cKDTree(tp)
            pieces = tree_paths(Vc, Fc, lambda L: np.argmin(tt.query(L)[0]))
            if not pieces:
                continue
            first = len(paths)
            for i, (P, parent) in enumerate(pieces):
                if i == 0:
                    d, j = tt.query(P[0])
                    # which trunk path does it drain into?
                    owner = min((k for k, p in enumerate(paths) if p["label"] in ("CS", "GCV", "AIV") and not p.get("side")),
                                key=lambda k: np.min(np.linalg.norm(paths[k]["P"] - tp[j], axis=1)))
                    if d > 0.3 * MM:  # bridge the gap onto the trunk centreline
                        P = np.vstack([tp[j], P])
                    paths.append({"label": label, "P": P, "parent": owner, "s0": 0.0})
                else:
                    paths.append({"label": label, "P": P, "parent": first + (parent or 0), "s0": 20.0, "side": True})
    # --- anterior cardiac veins: separate small trees draining straight into the RA -----------
    V, F = parts.scene("FMA71567")
    labels = mo.face_components(F, len(V))
    rt = cKDTree(rca_V)
    for lab in np.unique(labels):
        sel = labels == lab
        if sel.sum() < 40:
            continue
        Vc, Fc = mo.compact(V, F, sel)
        pieces = tree_paths(Vc, Fc, lambda L: np.argmin(rt.query(L)[0]))
        first = len(paths)
        for i, (P, parent) in enumerate(pieces):
            paths.append({"label": "ACV", "P": P, "parent": None if i == 0 else first + (parent or 0), "s0": 0.0 if i == 0 else 10.0, "side": i > 0})
    log(f"veins: {len(paths)} labelled paths " + str({k: sum(1 for p in paths if p['label'] == k) for k in VEIN_CODES}))

    # --- radii ---------------------------------------------------------------------------------
    for p in paths:
        s_mm = arclen(p["P"]) / MM
        r = radius_profile(p["label"], s_mm, p["s0"])
        if p["parent"] is not None:
            par = paths[p["parent"]]
            k = int(np.argmin(np.linalg.norm(par["P"] - p["P"][0], axis=1)))
            if p.get("continues"):
                r = np.minimum(r, par["R"][-1])
            else:
                r = np.minimum(r, 0.8 * par["R"][k])
        p["R"] = np.maximum(r, 0.45 * MM)

    # --- lift the coronary sinus onto the atrial side of the mitral hinge ----------------------
    ma_c, ma_n = hf["MA"]["c"], hf["MA"]["n"]
    for p in paths:
        if p["label"] not in ("CS", "GCV") or p.get("side"):
            continue
        h = (p["P"] - ma_c) @ ma_n
        near_ring = np.linalg.norm((p["P"] - ma_c) - np.outer(h, ma_n), axis=1) < hf["MA"]["r"] + 25 * MM
        need = np.where(near_ring, np.maximum(0.0, p["R"] + 2.0 * MM - h), 0.0)
        need = ndimage.gaussian_filter1d(need, 6, mode="nearest")
        p["P"] = p["P"] + np.outer(need, ma_n)

    # --- CS ostium in front of (anterior to) and medial to the IVC orifice ---------------------
    cs = paths[cs_idx]
    s_cs = arclen(cs["P"]) / MM
    o = cs["P"][0]
    target = o.copy()
    target[1] = min(o[1], ivc_top[1] - 6.0 * MM)  # Blender -Y = anterior
    target[0] = max(o[0], ivc_top[0] + 3.0 * MM)  # +X = medial (patient-left of the right-sided IVC)
    target[2] = max(o[2], ivc_top[2] + 2.0 * MM)
    w = 1.0 - mo.smoothstep(0.0, 16.0, s_cs)
    cs["P"] = cs["P"] + np.outer(w, target - o)

    # --- seat every vein on the epicardium (centre >= radius + clearance outside the wall) ----
    squeezed = 0
    for p in paths:
        P, R = p["P"], p["R"]
        ostium = p is cs
        n_os = max(2, int(6.0 / 0.8))
        for _ in range(4):
            q, n, sd = surf.closest(P)
            push = np.maximum(0.0, R + 0.25 * MM - sd)
            if ostium:  # the ostium itself opens into the right atrium
                push[:n_os] *= np.linspace(0.0, 1.0, n_os)[: len(push[:n_os])]
            disp = ndimage.gaussian_filter1d(n * ndimage.maximum_filter1d(push, 5)[:, None], 2.0, axis=0, mode="nearest")
            P = P + disp
        # tube-wall test: sample the tube surface and push out where it still dips into the wall; the
        # displacement field is smoothed along the vein so the course stays smooth
        ang = np.linspace(0, 2 * np.pi, 12, endpoint=False)
        for _ in range(5):
            T, N, B = frames(P)
            ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
            q, n, sd = surf.closest(ring.reshape(-1, 3))
            depth = np.maximum(0.0, -sd + 0.15 * MM).reshape(len(P), -1)
            dirs = n.reshape(len(P), -1, 3)
            disp = (dirs * depth[..., None]).max(axis=1)
            if ostium:
                disp[:n_os] = 0.0
            if depth.max() < 0.05 * MM:
                break
            P = P + ndimage.gaussian_filter1d(disp, 1.5, axis=0, mode="nearest")
        # a vein squeezed into a crevice (e.g. the GCV under the left auricle) is compressed rather than
        # pushed into the opposite wall: shrink the lumen there by the depth that could not be cleared
        T, N, B = frames(P)
        ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
        _, _, sd = surf.closest(ring.reshape(-1, 3))
        left = np.maximum(0.0, -sd.reshape(len(P), -1) + 0.1 * MM).max(axis=1)
        if ostium:
            left[:n_os] = 0.0
        if left.max() > 0:
            squeezed += int((left > 0).sum())
            R = np.maximum(R - ndimage.maximum_filter1d(left, 5), 0.55 * R)
            R = ndimage.gaussian_filter1d(R, 2.0, mode="nearest")
        # the moves stretch the path unevenly: resample at 0.8 mm and relax it so the course stays smooth
        s_old = arclen(P)
        P2 = resample(smooth_polyline(P, 6), 0.8 * MM)
        R2 = np.interp(arclen(P2) / max(arclen(P2)[-1], 1e-9) * s_old[-1], s_old, R)
        p["P"], p["R"] = smooth_polyline(P2, 8), R2
    log(f"veins: {squeezed} centreline points narrowed where a groove is narrower than the vein")

    # --- the coronary sinus is the last CS_LENGTH_MM of the course (arc length after re-seating) ------
    if gcv_from_cs is not None:
        gc = paths[gcv_from_cs]
        both_P = np.vstack([cs["P"], gc["P"][1:]])
        k = int(np.searchsorted(arclen(both_P) / MM, CS_LENGTH_MM))
        cs["P"], gc["P"] = both_P[: k + 1], both_P[k:]
        cs["R"] = np.maximum(radius_profile("CS", arclen(cs["P"]) / MM), 0.45 * MM)
        gc["R"] = np.minimum(radius_profile("GCV", arclen(gc["P"]) / MM), cs["R"][-1])
        for p in paths:
            if p["parent"] in (cs_idx, gcv_from_cs) and not p.get("continues"):
                p["parent"] = min((cs_idx, gcv_from_cs), key=lambda j: np.min(np.linalg.norm(paths[j]["P"] - p["P"][0], axis=1)))

    # --- reconnect children to their (moved) parents, parents first ---------------------------------
    for p in paths:
        if p["parent"] is None:
            continue
        par = paths[p["parent"]]
        k = len(par["P"]) - 1 if p.get("continues") else int(np.argmin(np.linalg.norm(par["P"] - p["P"][0], axis=1)))
        delta = par["P"][k] - p["P"][0]
        w = np.clip(1.0 - arclen(p["P"]) / (8.0 * MM), 0.0, 1.0)
        p["P"] = p["P"] + np.outer(w, delta)
        if p.get("continues"):
            p["R"] = np.minimum(p["R"], par["R"][-1])

    # --- tubes -----------------------------------------------------------------------------------
    meshes = []
    for p in paths:
        sides = 20 if p["R"].max() > 2.0 * MM else 14 if p["R"].max() > 1.0 * MM else 10
        if p is cs:
            t0 = mo.unit(p["P"][0] - p["P"][3])
            ext = p["P"][0] + np.outer(np.linspace(1.0, 0.25, 4) * p["R"][0], t0)
            meshes.append(sweep_tube(np.vstack([ext, p["P"]]), np.r_[np.full(4, p["R"][0]), p["R"]], sides, cap_start="flat", cap_end="round"))
            continue
        start = "flat" if p["parent"] is not None or p["label"] == "CS" else "round"
        if p["label"] == "ACV" and p["parent"] is None:
            start = "flat"  # the drainage end sits in the right atrial wall
        meshes.append(sweep_tube(p["P"], p["R"], sides, cap_start=start, cap_end="round"))
    V, F = mo.concat(meshes)
    info = {
        "paths": [
            {"label": p["label"], "code": VEIN_CODES[p["label"]], "parent": p["parent"],
             "length_mm": round(float(arclen(p["P"])[-1] / MM), 1),
             "radius_mm": [round(float(p["R"][0] / MM), 2), round(float(p["R"][-1] / MM), 2)]}
            for p in paths
        ],
        "cs_ostium_scene": np.round(paths[cs_idx]["P"][0], 5).tolist(),
        "ivc_top_scene": np.round(ivc_top, 5).tolist(),
    }
    lines = [{"label": p["label"], "code": VEIN_CODES[p["label"]], "parent": p["parent"], "side": bool(p.get("side")),
              "points_mm": np.round(parts.to_mm(p["P"]), 4).tolist(), "radius_mm": np.round(p["R"] / MM, 4).tolist()}
             for p in paths]
    return (V, F), {"info": info, "lines": lines}


# =============================================================================================
# Aorta: ascending calibre, root with sinuses of Valsalva, aortic valve
# =============================================================================================
#: Aortic root design (mm). Heights are along the root axis from the annulus; the annulus plane is parallel
#: to BodyParts3D's (tilted) proximal cap and ROOT_EXTENSION_MM below it, which puts the left-main / RCA ostia
#: at ~14 / ~18 mm above the annulus (MDCT 14.4 +/- 2.9 / 17.2 +/- 3.3 mm, REFERENCE.md §5.1).
ROOT_EXTENSION_MM = 11.0
#: The annulus is displaced towards the patient's right (fading out by the STJ) so it sits between the tricuspid
#: and mitral annuli (valve order TA.x < AoV.x < MA.x, REFERENCE.md §4.2) instead of over the mitral centre.
ROOT_RIGHTWARD_MM = 3.0
ROOT_HEIGHT_MM = 21.0          # annulus -> sino-tubular junction (STJ)
ROOT_R_ANNULUS_MM = 11.5       # annulus D 23 mm
ROOT_R_SINUS_MM = 14.6         # inter-sinus (commissural) radius at mid-sinus height: inscribed D ~29 mm
ROOT_R_STJ_MM = 13.0           # STJ D 26 mm
SINUS_BULGE_MM = 2.6           # extra radius at the centre of each sinus (sinus D ~34 mm)
ASC_MIN_RADIUS_MM = 12.8       # ascending aorta rounded to >= 25.6 mm (in-vivo 33 +/- 4, >= 25 accepted)
CUSP_THICKNESS_MM = 0.8


def poly_centroid(L: np.ndarray, c: np.ndarray, d: np.ndarray) -> tuple[np.ndarray, float]:
    e1 = mo.unit(np.cross(d, [1.0, 0.0, 0.0] if abs(d[0]) < 0.9 else [0.0, 1.0, 0.0]))
    e2 = np.cross(d, e1)
    x, y = (L - c) @ e1, (L - c) @ e2
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    cr = x * y2 - x2 * y
    A = cr.sum() / 2.0
    if abs(A) < 1e-12:
        return L.mean(axis=0), 0.0
    return c + ((x + x2) * cr).sum() / (6 * A) * e1 + ((y + y2) * cr).sum() / (6 * A) * e2, abs(A)


def march_centreline(tm: trimesh.Trimesh, start: np.ndarray, direction: np.ndarray, step: float = 2.0 * MM) -> np.ndarray:
    """Centreline of a fat tube by marching cross-section (area) centroids from ``start`` along ``direction``."""
    d = mo.unit(direction)
    p = start + d * 3.0 * MM
    C: list[np.ndarray] = []
    for _ in range(200):
        sec = tm.section(plane_origin=p, plane_normal=d)
        if sec is None:
            break
        cands = [poly_centroid(L, p, d) for L in sec.discrete]
        cc, _area = min(cands, key=lambda ca: np.linalg.norm(ca[0] - p))
        if C and np.linalg.norm(cc - C[-1]) > 3 * step:
            break
        C.append(cc)
        if len(C) >= 3:
            d = mo.unit(0.5 * d + 0.5 * mo.unit(C[-1] - C[-3]))
        p = cc + d * step
    return np.array(C)


def inflate_ascending(V: np.ndarray, F: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Round the (cadaveric, elliptical) ascending aorta to at least ASC_MIN_RADIUS_MM about its centreline,
    full effect over the proximal half, fading to the source shape where it joins the arch."""
    tree = cKDTree(C)
    _, k = tree.query(V)
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    rad = V - C[k]
    rad -= (rad * T[k]).sum(axis=1)[:, None] * T[k]
    rho = np.linalg.norm(rad, axis=1)
    s = arclen(C)
    L = s[-1]
    g = 1.0 - mo.smoothstep(0.7 * L, 1.0 * L, s[k])
    g = np.where(k == len(C) - 1, 0.0, g)  # the distal end joins the (unchanged) arch
    target = rho + g * np.maximum(0.0, ASC_MIN_RADIUS_MM * MM - rho)
    return V + rad / np.maximum(rho, 1e-9)[:, None] * (target - rho)[:, None]


def build_aorta(parts: Parts, hf: dict) -> tuple[mo.Mesh, mo.Mesh, mo.Mesh, dict]:
    V, F = parts.scene("FMA3736")
    tm = trimesh.Trimesh(V, F, process=False)
    c0 = V.mean(axis=0)
    _, _, vt = np.linalg.svd(V - c0, full_matrices=False)
    a0 = vt[0] * np.sign(vt[0][2])  # pointing superiorly
    fn, fa, fc = tm.face_normals, tm.area_faces, tm.triangles_center
    cap = fn @ (-a0) > 0.8
    cap_c = (fc[cap] * fa[cap, None]).sum(axis=0) / fa[cap].sum()
    n_cap = mo.unit((fn[cap] * fa[cap, None]).sum(axis=0))  # outward (inferior, tilted)
    C = march_centreline(tm, cap_c, a0)
    a_root = mo.unit(C[min(4, len(C) - 1)] - C[0])
    V_asc = inflate_ascending(V, F, C)
    log(f"aorta: ascending centreline {arclen(C)[-1] / MM:.0f} mm; cap tilt {math.degrees(math.acos(abs(n_cap @ a_root))):.0f} deg")

    # --- ostia (first points of the source LM / RCA parts nearest the aorta) -------------------
    ostia = {}
    for key, pid in (("LM", "FMA4685"), ("RCA", "FMA3802")):
        X, _ = parts.scene(pid)
        ostia[key] = X[np.argmin(cKDTree(V).query(X)[0])]

    # --- root frame -----------------------------------------------------------------------------
    c_ann = cap_c - a_root * ROOT_EXTENSION_MM * MM
    right = np.array([-1.0, 0.0, 0.0])
    shift = mo.unit(right - (right @ a_root) * a_root) * ROOT_RIGHTWARD_MM * MM
    e1 = mo.unit(np.cross(a_root, [1.0, 0.0, 0.0]))
    e2 = np.cross(a_root, e1)

    def azimuth(p):
        d = p - c_ann
        return math.atan2(d @ e2, d @ e1)

    th_R, th_L = azimuth(ostia["RCA"]), azimuth(ostia["LM"])
    # non-coronary sinus: bisector of the larger arc between the two coronary sinuses
    diff = (th_L - th_R) % (2 * math.pi)
    th_N = th_R + diff / 2 + (math.pi if diff < math.pi else 0.0)
    centres = sorted([("R", th_R % (2 * math.pi)), ("L", th_L % (2 * math.pi)), ("N", th_N % (2 * math.pi))], key=lambda x: x[1])
    ang = np.array([c[1] for c in centres])
    comm = [(ang[i] + ((ang[(i + 1) % 3] - ang[i]) % (2 * math.pi)) / 2) % (2 * math.pi) for i in range(3)]  # after sinus i

    def lobe(theta):
        """0 at commissures, 1 at sinus centres."""
        out = np.zeros_like(theta)
        for i in range(3):
            lo = comm[(i - 1) % 3]
            hi = comm[i]
            width = (hi - lo) % (2 * math.pi)
            t = ((theta - lo) % (2 * math.pi)) / width
            inside = t <= 1.0
            out = np.where(inside, np.sin(np.pi * np.clip(t, 0, 1)) ** 2, out)
        return out

    H = ROOT_HEIGHT_MM * MM

    def base_radius(u):
        r = np.where(u < 0.4, ROOT_R_ANNULUS_MM + (ROOT_R_SINUS_MM - ROOT_R_ANNULUS_MM) * mo.smoothstep(0.0, 0.4, u),
                     ROOT_R_SINUS_MM + (ROOT_R_STJ_MM - ROOT_R_SINUS_MM) * mo.smoothstep(0.4, 1.0, u))
        return r * MM

    def bulge(u):
        return SINUS_BULGE_MM * MM * np.sin(np.pi * np.clip(u / 0.95, 0, 1)) ** 1.3

    def wall(u, theta):
        """Root wall point (annulus plane parallel to the source cap, tilt fading out by the STJ)."""
        u = np.asarray(u, float)
        theta = np.asarray(theta, float)
        R = base_radius(u) + bulge(u) * lobe(theta)
        e = np.cos(theta)[..., None] * e1 + np.sin(theta)[..., None] * e2
        z0 = -(R[..., None] * e @ n_cap) / (a_root @ n_cap)
        h = z0 * (1.0 - u) + u * H
        return c_ann + R[..., None] * e + h[..., None] * a_root + (1.0 - u)[..., None] * shift

    # --- root surface (closed: flat annulus cap, open top closed by a cap inside the ascending aorta) -
    nu, nt = 36, 96
    us = np.linspace(0.0, 1.0, nu)
    ts = np.linspace(0.0, 2 * math.pi, nt, endpoint=False)
    UU, TT = np.meshgrid(us, ts, indexing="ij")
    W = wall(UU, TT).reshape(-1, 3)
    faces = []
    for i in range(nu - 1):
        for j in range(nt):
            a, b = i * nt + j, i * nt + (j + 1) % nt
            c_, d_ = (i + 1) * nt + j, (i + 1) * nt + (j + 1) % nt
            faces += [(a, c_, d_), (a, d_, b)]
    bottom, top = len(W), len(W) + 1
    W = np.vstack([W, W[:nt].mean(axis=0), W[-nt:].mean(axis=0)])
    for j in range(nt):
        faces.append((bottom, (j + 1) % nt, j))
        faces.append((top, (nu - 1) * nt + j, (nu - 1) * nt + (j + 1) % nt))
    RF = np.array(faces, dtype=np.int64)
    if mo.signed_volume(W, RF) < 0:
        RF = RF[:, ::-1]

    # --- aortic valve: three closed semilunar cusps -----------------------------------------------
    cusp_meshes = []
    for i, (name, th) in enumerate(centres):
        lo, hi = comm[(i - 1) % 3], comm[i]
        width = (hi - lo) % (2 * math.pi)
        nt_c, nv_c = 28, 12
        tt = np.linspace(-1.0, 1.0, nt_c)
        vv = np.linspace(0.0, 1.0, nv_c)
        phi = lo + (tt + 1.0) / 2.0 * width
        u_h = 0.03 + 0.86 * np.abs(tt) ** 1.6
        hinge = wall(u_h, phi) - 0.5 * MM * (np.cos(phi)[:, None] * e1 + np.sin(phi)[:, None] * e2)
        comm_lo, comm_hi = hinge[0], hinge[-1]
        centre = c_ann + a_root * 0.62 * H + 0.38 * shift
        free = np.where((tt < 0)[:, None], centre + np.abs(tt)[:, None] * (comm_lo - centre), centre + np.abs(tt)[:, None] * (comm_hi - centre))
        S = hinge[:, None, :] * (1 - vv)[None, :, None] + free[:, None, :] * vv[None, :, None]
        belly = 3.0 * MM * np.sin(np.pi * vv)[None, :] * (1 - tt ** 2)[:, None]
        S = S - belly[..., None] * a_root
        du = np.gradient(S, axis=0)
        dv = np.gradient(S, axis=1)
        nrm = np.cross(du, dv)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-12)
        half = 0.5 * CUSP_THICKNESS_MM * MM
        A_, B_ = (S + half * nrm).reshape(-1, 3), (S - half * nrm).reshape(-1, 3)
        n = nt_c * nv_c
        Vc = np.vstack([A_, B_])
        fc_ = []
        def idx(a, b, _n=nv_c):
            return a * _n + b
        for a in range(nt_c - 1):
            for b in range(nv_c - 1):
                p00, p10, p01, p11 = idx(a, b), idx(a + 1, b), idx(a, b + 1), idx(a + 1, b + 1)
                fc_ += [(p00, p10, p11), (p00, p11, p01)]
                fc_ += [(n + p00, n + p11, n + p10), (n + p00, n + p01, n + p11)]
        border = [idx(a, 0) for a in range(nt_c)] + [idx(nt_c - 1, b) for b in range(1, nv_c)] + \
                 [idx(a, nv_c - 1) for a in range(nt_c - 2, -1, -1)] + [idx(0, b) for b in range(nv_c - 2, 0, -1)]
        for k in range(len(border)):
            p, q = border[k], border[(k + 1) % len(border)]
            fc_ += [(p, n + p, n + q), (p, n + q, q)]
        Fc = np.array(fc_, dtype=np.int64)
        if mo.signed_volume(Vc, Fc) < 0:
            Fc = Fc[:, ::-1]
        cusp_meshes.append((Vc, Fc))
    valve = mo.concat(cusp_meshes)
    info = {
        "annulus_centre_scene": np.round(c_ann, 5).tolist(),
        "root_axis": np.round(a_root, 4).tolist(),
        "annulus_normal": np.round(-n_cap, 4).tolist(),
        "sinus_order": [c[0] for c in centres],
        "ostium_height_mm": {k: round(float(((p - c_ann) @ n_cap) / (a_root @ n_cap) / MM), 1) for k, p in ostia.items()},
        "ascending_min_radius_mm": ASC_MIN_RADIUS_MM,
        "root_mm": {"annulus_D": 2 * ROOT_R_ANNULUS_MM, "intersinus_D": 2 * ROOT_R_SINUS_MM,
                    "sinus_D": 2 * (ROOT_R_SINUS_MM + SINUS_BULGE_MM), "stj_D": 2 * ROOT_R_STJ_MM, "height": ROOT_HEIGHT_MM},
    }
    log(f"aorta: root sinuses {info['sinus_order']}, ostium heights {info['ostium_height_mm']} mm")
    return (V_asc, F), (W, RF), valve, info


# =============================================================================================
def main() -> int:
    cfg = load_config()
    SYNTH_DIR.mkdir(parents=True, exist_ok=True)
    parts = Parts(cfg)
    log(f"origin (heart-wall bbox centre) {np.round(parts.origin_mm, 4).tolist()} mm")
    hf = heart_frame(parts)
    wall_V, wall_F = parts.scene("FMA7274")
    surf = Surface(wall_V, wall_F)
    report: dict = {"origin_mm": np.round(parts.origin_mm, 4).tolist()}

    (vV, vF), veins = build_veins(parts, hf, surf)
    mo.write_ply(SYNTH_DIR / "SYN_CardiacVeins.ply", parts.to_mm(vV), vF)
    write_json(VEIN_LINES, {"frame": "BodyParts3D millimetres", "codes": VEIN_CODES, "paths": veins["lines"]}, indent=None)
    report["veins"] = veins["info"]
    log(f"veins: {len(vF)} tube triangles -> {SYNTH_DIR / 'SYN_CardiacVeins.ply'}")

    asc, root, valve, aorta_info = build_aorta(parts, hf)
    for name, (V, F) in (("SYN_AortaAscending", asc), ("SYN_AorticRoot", root), ("SYN_AorticValve", valve)):
        mo.write_ply(SYNTH_DIR / f"{name}.ply", parts.to_mm(V), F)
    report["aorta"] = aorta_info

    write_json(REPORT, report)
    log("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
