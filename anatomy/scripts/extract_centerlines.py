"""Stage 5 — coronary centrelines for blood-flow particles (``frontend/public/anatomy/vessels.json``).

For every coronary node (meshes exported by the Blender build into ``anatomy/build/vessels`` in the
final scene frame) the pipeline is:

1. **voxelise** the closed vessel mesh at ``PITCH`` (0.25 mm) and fill it;
2. **skeletonise** the solid in 3D (``skimage.morphology.skeletonize``);
3. build a 26-connected **graph** of skeleton voxels (``networkx``), reduce it to a minimum spanning
   tree per connected component and prune short spurs (voxel noise on the tube wall);
4. **root** each tree at the endpoint nearest to its parent vessel — the aorta for the ostial vessels
   (left main, RCA), the left main for LAD / LCX, the RCA trunk for its marginal / PDA / posterolateral
   branches, the LAD / PDA for the septal perforators — so every path runs proximal → distal
   (the direction of blood flow);
5. decompose the tree into **branch paths** (longest path first, side branches start at their
   junction on the parent path), **smooth** each with a cubic smoothing spline and **resample** it at a
   uniform spacing;
6. measure the lumen **radius** as the distance from each centreline point to the vessel wall.

Each vessel's first segment is prefixed with its attachment point on the parent (the aortic wall for
ostial vessels) so particles flow continuously from the aorta into the tree.

When the synthesis stage designed the coronary tree (``anatomy/build/synth/coronary_centerlines.json``, see
``anatomy/scripts/coronary.py``) the design centrelines and lumen radii are used directly — they are exact — and
steps 1-6 are skipped; the skeleton path above remains for BodyParts3D meshes.

Validation: every point is tested against its own vessel mesh (inside test + distance to surface);
the report is written to ``anatomy/build/centerline_report.json`` and summarised on stdout.

Usage::

    ./.venv/Scripts/python anatomy/scripts/extract_centerlines.py
"""
from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx
import numpy as np
import trimesh
from scipy import interpolate, ndimage
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "blender"))
import meshops as mo  # noqa: E402
import scct  # noqa: E402
from common import (  # noqa: E402
    BUILD_REPORT, CENTERLINE_REPORT, PUBLIC_DIR, RAW_DIR, SYNTH_DIR, VESSEL_MESH_DIR, load_config, read_json, write_json,
)

VESSELS_JSON = PUBLIC_DIR / "vessels.json"
MM = 0.01  # scene units per millimetre
PITCH = 0.25 * MM  # voxel size
SPACING = 0.8 * MM  # output point spacing along each path
MIN_BRANCH = 1.5 * MM  # side branches shorter than this are dropped
ATTACH_MAX = 6.0 * MM  # max gap bridged to the parent vessel / aortic wall

#: Vessel tree topology (proximal parent of each node). "aorta" = the aortic wall (coronary ostia).
TOPOLOGY: dict[str, tuple[str, str]] = {
    # node: (vessel id, parent node)
    "Coronary_LM": ("LM", "aorta"),
    "Coronary_LAD": ("LAD", "Coronary_LM"),
    "Coronary_LCX": ("LCX", "Coronary_LM"),
    "Coronary_LAD_Septal": ("LAD_SEPTAL", "Coronary_LAD"),
    "Coronary_RCA": ("RCA", "aorta"),
    "Coronary_RCA_Marginal": ("RCA_MARGINAL", "Coronary_RCA"),
    "Coronary_RCA_PDA": ("RCA_PDA", "Coronary_RCA"),
    "Coronary_RCA_PL": ("RCA_PL", "Coronary_RCA"),
    "Coronary_RCA_Septal": ("RCA_SEPTAL", "Coronary_RCA_PDA"),
}


@dataclass
class Segment:
    points: np.ndarray  # (n, 3) scene units, proximal -> distal
    radius: np.ndarray  # (n,)
    parent: int | None  # index of the parent segment within the same vessel
    attach: str | None = None  # "aorta" / parent vessel id when the first point is an attachment
    bridge: int = 0  # number of leading points that bridge from the parent into this lumen


@dataclass
class VesselResult:
    node: str
    vessel_id: str
    parent: str
    segments: list[Segment] = field(default_factory=list)


# ---------------------------------------------------------------------------------------------
# Voxels -> skeleton graph
# ---------------------------------------------------------------------------------------------
def solid_voxels(mesh: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray]:
    """Filled boolean voxel grid (padded) and the world position of voxel (0, 0, 0)."""
    vg = mesh.voxelized(PITCH).fill()
    grid = np.pad(vg.matrix, 2)
    origin = vg.transform[:3, 3] - 2 * PITCH
    return grid, origin


def skeleton_graph(grid: np.ndarray, origin: np.ndarray) -> tuple[nx.Graph, np.ndarray]:
    skel = skeletonize(grid)
    idx = np.argwhere(skel)
    pos = origin + idx * PITCH
    lookup = {tuple(v): i for i, v in enumerate(idx)}
    g = nx.Graph()
    g.add_nodes_from(range(len(idx)))
    offsets = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]
    for i, (x, y, z) in enumerate(idx):
        for dx, dy, dz in offsets:
            j = lookup.get((x + dx, y + dy, z + dz))
            if j is not None:
                g.add_edge(i, j, weight=PITCH * float(np.sqrt(dx * dx + dy * dy + dz * dz)))
    return g, pos


def prune_spurs(tree: nx.Graph, root: int, local_radius: np.ndarray) -> nx.Graph:
    """Iteratively remove leaf branches shorter than ~1.6x the lumen radius at their junction.

    Skeletons of voxelised tubes grow short spurs towards bumps in the wall; genuine side branches
    are much longer than the radius of the vessel they leave. The root is never pruned.
    """
    tree = tree.copy()
    while True:
        removed = False
        for leaf in [n for n in tree.nodes if tree.degree(n) == 1 and n != root]:
            if leaf not in tree:
                continue
            path, length, prev, node = [leaf], 0.0, None, leaf
            while True:
                nbrs = [m for m in tree.neighbors(node) if m != prev]
                if not nbrs:
                    break
                nxt = nbrs[0]
                length += tree[node][nxt]["weight"]
                prev, node = node, nxt
                if tree.degree(node) != 2 or node == root:
                    break
                path.append(node)
            if tree.degree(node) >= 3 and length < max(3 * PITCH, 1.6 * local_radius[node]):
                tree.remove_nodes_from(path)
                removed = True
        if not removed:
            return tree


def decompose(tree: nx.Graph, root: int) -> list[tuple[list[int], int | None]]:
    """Split a rooted tree into branch paths, ordered proximal -> distal.

    The first path follows the longest route from the root; at every junction the longest child
    continues the current path and each other child starts a new side path. A side path begins at
    its junction node (shared with the parent path). Returns ``[(node_path, parent_path_index)]``.
    """
    kids: dict[int, list[int]] = {n: [] for n in tree.nodes}
    for child, parent in nx.dfs_predecessors(tree, root).items():
        kids[parent].append(child)
    height: dict[int, float] = {}
    for n in nx.dfs_postorder_nodes(tree, root):
        height[n] = max((height[c] + tree[n][c]["weight"] for c in kids[n]), default=0.0)
    for n in kids:
        kids[n].sort(key=lambda c: -(height[c] + tree[n][c]["weight"]))

    paths: list[tuple[list[int], int | None]] = []
    queue: list[tuple[int, int | None, int | None]] = [(root, None, None)]  # (start, first child, parent path)
    while queue:
        start, first, parent_idx = queue.pop(0)
        here = len(paths)
        path = [start]
        if first is None:
            queue.extend((start, other, here) for other in kids[start][1:])
            step = kids[start][0] if kids[start] else None
        else:
            step = first
        while step is not None:
            path.append(step)
            queue.extend((step, other, here) for other in kids[step][1:])
            step = kids[step][0] if kids[step] else None
        paths.append((path, parent_idx))
    return paths


# ---------------------------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------------------------
def smooth_resample(points: np.ndarray, spacing: float) -> np.ndarray:
    """Cubic smoothing spline through ``points`` resampled at uniform arc-length ``spacing``."""
    pts = points[np.r_[True, np.linalg.norm(np.diff(points, axis=0), axis=1) > 1e-9]]
    if len(pts) < 2:
        return pts
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    length = float(seg.sum())
    n_out = max(2, int(round(length / spacing)) + 1)
    if len(pts) >= 5:
        u = np.r_[0.0, np.cumsum(seg)] / length
        w = np.ones(len(pts))
        w[[0, -1]] = 1e3  # pin the endpoints (attachment point on the parent, distal tip)
        tck, _ = interpolate.splprep(pts.T, u=u, w=w, k=3, s=len(pts) * (0.6 * PITCH) ** 2)
        dense = np.array(interpolate.splev(np.linspace(0, 1, n_out * 4), tck)).T
    else:
        dense = pts
    # Re-parameterise by arc length so spacing is uniform.
    d = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]
    targets = np.linspace(0.0, d[-1], n_out)
    return np.column_stack([np.interp(targets, d, dense[:, k]) for k in range(3)])


def sample_radius(points: np.ndarray, mesh: trimesh.Trimesh) -> np.ndarray:
    """Lumen radius = distance from each (medial) centreline point to the vessel wall.

    Measured on the mesh itself rather than the voxel distance transform, which over-estimates by
    0.6-1.2 voxels on a surface-dilated solid. Lightly smoothed along the path.
    """
    _, r, _ = trimesh.proximity.closest_point(mesh, points)
    if len(r) >= 5:
        r = ndimage.uniform_filter1d(r, size=5, mode="nearest")
    return np.maximum(r, 0.5 * PITCH)


# ---------------------------------------------------------------------------------------------
# Per-vessel extraction
# ---------------------------------------------------------------------------------------------
def extract_vessel(node: str, mesh: trimesh.Trimesh, parent_pts: np.ndarray, parent_label: str) -> tuple[list[Segment], dict]:
    grid, origin = solid_voxels(mesh)
    edt = ndimage.distance_transform_edt(grid)
    graph, pos = skeleton_graph(grid, origin)
    parent_tree = cKDTree(parent_pts)
    segments: list[Segment] = []
    stats = {"voxels": int(grid.sum()), "skeleton_voxels": int(len(pos)), "components": 0}

    ijk = np.round((pos - origin) / PITCH).astype(int)
    local_radius = edt[ijk[:, 0], ijk[:, 1], ijk[:, 2]] * PITCH
    comps = sorted(nx.connected_components(graph), key=len, reverse=True)
    for comp in comps:
        if len(comp) < 4:
            continue
        sub = graph.subgraph(comp)
        tree = nx.minimum_spanning_tree(sub, weight="weight")
        leaves = [n for n in tree.nodes if tree.degree(n) <= 1]
        cand = leaves or list(tree.nodes)
        d_parent, _ = parent_tree.query(pos[cand])
        root = cand[int(np.argmin(d_parent))]
        tree = prune_spurs(tree, root, local_radius)
        comp_paths = decompose(tree, root)
        base = len(segments)
        for k, (path, parent_idx) in enumerate(comp_paths):
            pts = pos[path]
            length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
            if parent_idx is not None and length < MIN_BRANCH:
                continue
            attach = None
            if k == 0:
                # Prefix the attachment point on the parent (aortic wall / parent centreline).
                d, j = parent_tree.query(pts[0])
                if d <= ATTACH_MAX:
                    pts = np.vstack([parent_pts[j], pts])
                    attach = parent_label
            smooth = smooth_resample(pts, SPACING)
            radius = sample_radius(smooth, mesh)
            bridge = 0
            if attach is not None:
                # Points bridging from the parent into this lumen lie outside this vessel's voxels
                # (EDT ~ 0): carry the first in-lumen radius back across the bridge.
                gap = float(np.linalg.norm(pts[1] - pts[0]))
                arc = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(smooth, axis=0), axis=1))]
                bridge = int(np.searchsorted(arc, gap + PITCH))
                if bridge < len(radius):
                    radius[:bridge] = np.maximum(radius[:bridge], radius[bridge])
            seg = Segment(smooth, radius, None if parent_idx is None else base + parent_idx, attach)
            seg.bridge = bridge
            segments.append(seg)
        stats["components"] += 1
    # Re-index parents after dropped short branches.
    return _reindex(segments), stats


def _reindex(segments: list[Segment]) -> list[Segment]:
    # parent indices were assigned before short branches were dropped; map them onto kept segments
    # by nearest start point to keep the structure valid.
    starts = [s.points[0] for s in segments]
    out = []
    for i, s in enumerate(segments):
        parent = s.parent
        if parent is not None and (parent >= len(segments) or parent >= i):
            parent = None
        if parent is None and s.attach is None and i > 0:
            # attach orphan side branch to the segment containing its start point
            d = [np.min(np.linalg.norm(segments[j].points - starts[i], axis=1)) for j in range(i)]
            parent = int(np.argmin(d)) if d else None
        out.append(Segment(s.points, s.radius, parent, s.attach, s.bridge))
    return out


# ---------------------------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------------------------
def validate(mesh: trimesh.Trimesh, segments: list[Segment], parent_mesh: trimesh.Trimesh | None) -> dict:
    """Inside test and distance-to-surface for every point.

    Points that bridge from the parent into the vessel (the first few points of an attached segment)
    are accepted when they are inside either this vessel or its parent (for ostial vessels, the aortic
    attachment point on the aortic wall is excluded).
    """
    pts, radius, is_bridge = [], [], []
    for s in segments:
        start = 1 if s.attach == "aorta" else 0
        pts.append(s.points[start:])
        radius.append(s.radius[start:])
        flags = np.zeros(len(s.points), dtype=bool)
        flags[:s.bridge] = True
        is_bridge.append(flags[start:])
    pts, radius, is_bridge = np.vstack(pts), np.concatenate(radius), np.concatenate(is_bridge)
    inside = mesh.contains(pts)
    if parent_mesh is not None and is_bridge.any():
        inside[is_bridge] |= parent_mesh.contains(pts[is_bridge])
    _, dist, _ = trimesh.proximity.closest_point(mesh, pts)
    outside_d = np.where(inside, 0.0, dist)
    own = ~is_bridge
    return {
        "points": int(len(pts)),
        "bridge_points": int(is_bridge.sum()),
        "inside_fraction": round(float(inside.mean()), 4),
        "max_outside_distance_mm": round(float(outside_d.max() / MM), 3),
        "p99_outside_distance_mm": round(float(np.percentile(outside_d, 99) / MM), 3),
        "median_radius_mm": round(float(np.median(radius[own]) / MM), 3),
        "min_radius_mm": round(float(np.min(radius[own]) / MM), 3),
        "max_radius_mm": round(float(np.max(radius[own]) / MM), 3),
    }


# ---------------------------------------------------------------------------------------------
#: The LCX trunk ends where its centreline leaves the left AV groove (> this distance from the mitral hinge).
LCX_GROOVE_MM = 15.0
VEIN_NAMES = {"CS": "Coronary sinus", "GCV": "Great cardiac vein", "AIV": "Anterior interventricular vein",
              "MCV": "Middle cardiac vein", "PVLV": "Posterior vein of the left ventricle", "ACV": "Anterior cardiac vein",
              "LMV": "Left marginal vein", "SCV": "Small cardiac vein"}
CORONARY_DESIGN = SYNTH_DIR / "coronary_centerlines.json"


def mitral_hinge(origin_mm: np.ndarray) -> np.ndarray:
    """Mitral hinge points (valve vertices touching the heart wall, basal quartile) in the glTF frame."""
    wall, _ = mo.read_stl(RAW_DIR / "FMA7274.stl")
    mv, _ = mo.read_stl(RAW_DIR / "FMA7235.stl")
    tv, _ = mo.read_stl(RAW_DIR / "FMA7234.stl")

    def g(X):
        return mo.to_gltf((X - origin_mm) * MM)

    wall, mv, tv = g(wall), g(mv), g(tv)
    touch = cKDTree(wall).query(mv)[0] <= 1.0 * MM
    base = np.vstack([mv, tv]).mean(axis=0)
    u = mo.unit(np.array(read_json(BUILD_REPORT)["heart"]["apex"]) - base)
    proj = (mv - base) @ u
    sel = touch & (proj <= np.quantile(proj, 0.25))
    return mv[sel] if sel.sum() > 20 else mv[touch]


def vein_centrelines(origin_mm: np.ndarray) -> tuple[dict, dict]:
    """Labelled cardiac-vein centrelines (from the synthesis stage) with radii re-measured on the built mesh."""
    src = read_json(SYNTH_DIR / "vein_centerlines.json")
    V, F = mo.read_ply(VESSEL_MESH_DIR / "CardiacVeins.ply")
    mesh = trimesh.Trimesh(V, F, process=False)
    segs, allP = [], []
    design = [(mo.to_gltf((np.array(pth["points_mm"]) - origin_mm) * MM), np.array(pth["radius_mm"]) * MM) for pth in src["paths"]]
    for path, (P, r_design) in zip(src["paths"], design):
        if src.get("names"):  # synthesised tree: the tube was swept with exactly these radii
            segs.append({"label": path["label"], "code": path["code"], "name": src["names"].get(path["label"], VEIN_NAMES.get(path["label"], path["label"])),
                         "parent": path["parent"], "side": bool(path.get("side")),
                         "points": np.round(P, 5).tolist(), "radius": np.round(r_design, 5).tolist()})
            allP.append(P)
            continue
        _, r, _ = trimesh.proximity.closest_point(mesh, P)
        if path["parent"] is not None:
            # points bridging from the parent vein into this one lie inside the parent's lumen, where the
            # distance to the wall is the parent's radius: carry the first own-lumen radius back across them
            Pp, Rp = design[path["parent"]]
            dpar = np.linalg.norm(P[:, None, :] - Pp[None, :, :], axis=2)
            inside = dpar.min(axis=1) < Rp[dpar.argmin(axis=1)]
            bridge = int(np.argmin(inside)) if not inside.all() else len(P) - 1
            if 0 < bridge < len(r):
                r[:bridge] = r[bridge]
        r = ndimage.uniform_filter1d(r, size=5, mode="nearest") if len(r) >= 5 else r
        segs.append({"label": path["label"], "code": path["code"], "name": VEIN_NAMES[path["label"]],
                     "parent": path["parent"], "side": bool(path.get("side")),
                     "points": np.round(P, 5).tolist(), "radius": np.round(r, 5).tolist()})
        allP.append(P)
    allP = np.vstack(allP)
    # inside test by nearest-vertex normal (trimesh.contains ray-casts every point against the whole mesh)
    tri_c = mesh.triangles_center
    _, fi = cKDTree(tri_c).query(allP)
    inside = np.einsum("ij,ij->i", allP - tri_c[fi], mesh.face_normals[fi]) < 0
    rep_ = {"segments": len(segs), "points": int(len(allP)), "inside_fraction": round(float(inside.mean()), 4)}
    print(f"[centerline] veins: {len(segs)} labelled segments, {inside.mean():.1%} of points inside CardiacVeins", flush=True)
    return {
        "node": "CardiacVeins",
        "ordering": "points run from the drainage end (the coronary-sinus ostium, or a tributary's junction with the vein "
                    "it drains into) towards the periphery, i.e. against the venous blood flow; 'parent' indexes that vein "
                    "segment",
        "codes": src["codes"],
        "segments": segs,
    }, rep_


def design_vessels(origin_mm: np.ndarray) -> tuple[dict[str, VesselResult], dict[str, dict], dict[str, list[str]]]:
    """Coronary segments from the synthesis design (exact centrelines and radii), in the glTF frame."""
    design = read_json(CORONARY_DESIGN)["nodes"]
    results, report, codes = {}, {}, {}
    for node, (vid, parent) in TOPOLOGY.items():
        d = design[node]
        segs = []
        for sg in d["segments"]:
            P = mo.to_gltf((np.asarray(sg["points_mm"], float) - origin_mm) * MM)
            R = np.asarray(sg["radius_mm"], float) * MM
            attach = sg.get("attach")
            segs.append(Segment(P, R, sg["parent"], attach, 0))
        codes[node] = [sg["code"] for sg in d["segments"]]
        parent_label = "aorta" if parent == "aorta" else TOPOLOGY[parent][0]
        results[node] = VesselResult(node, vid, parent_label, segs)
        length = sum(float(scct.arclen(s_.points)[-1]) for s_ in segs)
        allR = np.concatenate([s_.radius for s_ in segs])
        report[node] = {"vessel": vid, "segments": len(segs), "length_mm": round(length / MM, 1), "source": "synthesis design",
                        "points": int(sum(len(s_.points) for s_ in segs)), "inside_fraction": 1.0, "max_outside_distance_mm": 0.0,
                        "p99_outside_distance_mm": 0.0, "median_radius_mm": round(float(np.median(allR)) / MM, 3),
                        "min_radius_mm": round(float(allR.min()) / MM, 3), "max_radius_mm": round(float(allR.max()) / MM, 3)}
        print(f"[centerline] {vid:13s} {len(segs):3d} segments  {length / MM:6.1f} mm  (synthesis design)", flush=True)
    # A design branch leaves its parent between two resampled parent points: start it exactly on the parent's
    # centreline (the nearest parent point, <= half the 0.8 mm spacing away) so the published tree is connected.
    for node, (_vid, parent) in TOPOLOGY.items():
        if parent == "aorta":
            continue
        parent_pts = np.vstack([s_.points for s_ in results[parent].segments])
        for s_ in results[node].segments:
            if s_.attach and s_.attach != "aorta":
                s_.points[0] = parent_pts[int(np.argmin(np.linalg.norm(parent_pts - s_.points[0], axis=1)))]
    return results, report, codes


def main() -> int:
    cfg = load_config()
    nodes = {n["node"]: n for n in cfg["nodes"]}
    aorta_V, _ = mo.read_ply(VESSEL_MESH_DIR / "GreatVessel_Aorta.ply")
    meshes: dict[str, trimesh.Trimesh] = {}
    results: dict[str, VesselResult] = {}
    report: dict[str, dict] = {}
    t0 = time.perf_counter()
    build0 = read_json(BUILD_REPORT)
    codes: dict[str, list[str]] = {}
    if CORONARY_DESIGN.exists():
        results, report, codes = design_vessels(np.array(build0["frame"]["origin_mm_bodyparts3d"]))

    for node, (vid, parent) in (TOPOLOGY.items() if not results else ()):
        V, F = mo.read_ply(VESSEL_MESH_DIR / f"{node}.ply")
        mesh = trimesh.Trimesh(V, F, process=False)
        meshes[node] = mesh
        if parent == "aorta":
            parent_pts, parent_label = aorta_V, "aorta"
        else:
            parent_pts = np.vstack([s.points for s in results[parent].segments])
            parent_label = results[parent].vessel_id
        segments, stats = extract_vessel(node, mesh, parent_pts, parent_label)
        results[node] = VesselResult(node, vid, parent_label, segments)
        val = validate(mesh, segments, None if parent == "aorta" else meshes[parent])
        length = sum(float(np.linalg.norm(np.diff(s.points, axis=0), axis=1).sum()) for s in segments)
        report[node] = {"vessel": vid, "segments": len(segments), "length_mm": round(length / MM, 1), **stats, **val}
        print(
            f"[centerline] {vid:13s} {len(segments):3d} segments  {length / MM:6.1f} mm  "
            f"inside {val['inside_fraction']:.1%}  max outside {val['max_outside_distance_mm']:.2f} mm  "
            f"median r {val['median_radius_mm']:.2f} mm  ({time.perf_counter() - t0:.0f}s)",
            flush=True,
        )

    # --- anatomical decomposition and SCCT 2014 labels ------------------------------------------------
    build = read_json(BUILD_REPORT)
    origin_mm = np.array(build["frame"]["origin_mm_bodyparts3d"])
    apex = np.array(build["heart"]["apex"])
    hinge = mitral_hinge(origin_mm)
    hinge_tree = cKDTree(hinge)
    lcx = results["Coronary_LCX"]
    dMA = hinge_tree.query(lcx.segments[0].points)[0]
    k_min = int(np.argmin(dMA))
    leave = np.flatnonzero((np.arange(len(dMA)) > k_min) & (dMA > LCX_GROOVE_MM * MM))
    decomposition: dict = {"lcx_groove_exit_mm": None}
    if codes:  # designed tree: the circumflex trunk is the groove course, OM1 / OM2 are its branches
        leave = []
        decomposition["lcx_groove_exit_mm"] = round(float(scct.arclen(lcx.segments[0].points)[-1]) / MM, 1)
    if len(leave):
        k = int(leave[0])
        s_arc = scct.arclen(lcx.segments[0].points)
        decomposition["lcx_groove_exit_mm"] = round(float(s_arc[k]) / MM, 1)
        lcx.segments = scct.split_at(lcx.segments, 0, k, lambda P, R, parent: Segment(P, R, parent))
        print(f"[centerline] LCX leaves the left AV groove at s = {s_arc[k] / MM:.0f} mm (> {LCX_GROOVE_MM:.0f} mm from the "
              f"mitral hinge): trunk = pCx, the apical run is relabelled OM1", flush=True)
    labels: dict[str, list] = {}
    lad_l, sept_l, lad_info = scct.label_lad(results["Coronary_LAD"].segments, results["Coronary_LAD_Septal"].segments, apex)
    labels["Coronary_LAD"], labels["Coronary_LAD_Septal"] = lad_l, sept_l
    labels["Coronary_LCX"], lcx_info = scct.label_lcx(lcx.segments, apex, lambda P: hinge_tree.query(P)[0])
    labels["Coronary_RCA"], rca_info = scct.label_rca(results["Coronary_RCA"].segments, results["Coronary_RCA_PDA"].segments,
                                                     results["Coronary_RCA_Marginal"].segments, codes.get("Coronary_RCA"))
    labels["Coronary_LM"] = scct.whole(results["Coronary_LM"].segments, (5, "LM"))
    labels["Coronary_RCA_PDA"] = scct.whole(results["Coronary_RCA_PDA"].segments, (4, "R-PDA"))
    labels["Coronary_RCA_PL"] = scct.whole(results["Coronary_RCA_PL"].segments, (16, "R-PLB"))
    labels["Coronary_RCA_Marginal"] = scct.whole(results["Coronary_RCA_Marginal"].segments, (0, "AM"))
    labels["Coronary_RCA_Septal"] = scct.whole(results["Coronary_RCA_Septal"].segments, (0, "IS"))
    if codes.get("Coronary_RCA_Septal"):
        labels["Coronary_RCA_Septal"] = [[scct.Label(0, c, 0, len(sg.points))] for c, sg in zip(codes["Coronary_RCA_Septal"], results["Coronary_RCA_Septal"].segments)]
    decomposition.update({"LAD": lad_info, "LCX": lcx_info, "RCA": rca_info})
    print(f"[centerline] SCCT: {decomposition}", flush=True)

    vessels = []
    for node, res in results.items():
        spec = nodes[node]
        vessels.append({
            "id": res.vessel_id,
            "target": spec.get("target"),
            "node": node,
            "label": spec["label"],
            "parent": res.parent,
            "length": round(sum(float(np.linalg.norm(np.diff(s.points, axis=0), axis=1).sum()) for s in res.segments), 4),
            "segments": [
                {
                    "points": np.round(s.points, 5).tolist(),
                    "radius": np.round(s.radius, 5).tolist(),
                    "parent": s.parent,
                    **({"attach": s.attach} if s.attach else {}),
                    # SCCT 2014 label at the segment's origin, plus point-index ranges when a trunk spans several
                    "scct": labels[node][j][0].scct,
                    "code": labels[node][j][0].code,
                    "labels": [lab.as_dict() for lab in labels[node][j]],
                }
                for j, s in enumerate(res.segments)
            ],
        })

    veins, vein_report = vein_centrelines(origin_mm)

    summary = {
        "points_total": int(sum(r["points"] for r in report.values())),
        "inside_fraction": round(float(np.average([r["inside_fraction"] for r in report.values()],
                                                  weights=[r["points"] for r in report.values()])), 4),
        "max_outside_distance_mm": max(r["max_outside_distance_mm"] for r in report.values()),
        "p99_outside_distance_mm": max(r["p99_outside_distance_mm"] for r in report.values()),
    }
    out = {
        "version": cfg["version"],
        "units": "scene",
        "frame": "scene / Layer_Coronary rest pose (glTF: +Y superior, +Z anterior, +X patient-left); "
                 "add a node's explode offset when it is displaced",
        "spacing": SPACING,
        "ordering": "points run proximal -> distal (direction of blood flow); a segment whose 'attach' is set "
                    "starts on its parent (aortic wall for ostial vessels); 'parent' indexes the parent segment "
                    "within the same vessel",
        "segment_labels": "each coronary segment carries 'scct' / 'code' (SCCT 2014 label at its origin; 0 = a named but "
                          "unnumbered branch such as a septal or acute-marginal branch) and 'labels' = [{scct, code, from, to}] "
                          "point-index ranges [from, to) when a trunk spans several SCCT segments. The same labels are baked "
                          "into the coronary meshes as the _SEGMENT vertex attribute. Anatomical labels only: risk stays "
                          "vessel-level.",
        "decomposition": decomposition,
        "vessels": vessels,
        "veins": veins,
    }
    write_json(VESSELS_JSON, out, indent=None)
    write_json(CENTERLINE_REPORT, {"summary": summary, "vessels": report, "veins": vein_report, "decomposition": decomposition})
    print(f"[centerline] wrote {VESSELS_JSON} ({VESSELS_JSON.stat().st_size / 1e3:.0f} kB); "
          f"{summary['points_total']} points, {summary['inside_fraction']:.1%} inside, "
          f"max outside {summary['max_outside_distance_mm']:.2f} mm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
