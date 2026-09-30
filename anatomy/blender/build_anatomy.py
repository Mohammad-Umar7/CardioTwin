"""Stages 2–4 — build the CardioTwin anatomy scene headlessly in Blender and export it as glTF.

Run (from the repository root)::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
        --python anatomy/blender/build_anatomy.py -- [--no-blend]

What it does, driven entirely by ``anatomy/config/anatomy.json``:

1. imports every BodyParts3D STL of every node (``bpy.ops.wm.stl_import``), deletes loose fragments
   and inverted internal pockets, and merges the parts of each node;
2. crops the whole-body skin to the thorax (outermost shell only, upper limbs removed with an oblique
   shoulder cut), trims the pectoral tendons at the same plane and the aorta / IVC / trachea to the thorax;
3. maps BodyParts3D millimetres (+X left, +Y posterior, +Z superior) into the contract frame
   (1 unit = 10 cm, origin = heart-wall bounding-box centre) — on glTF export Blender +Z becomes +Y
   (superior) and Blender −Y becomes +Z (anterior);
4. welds, re-orients normals outward, decimates every node to its triangle budget and applies smooth,
   face-area-weighted normals;
5. opens the heart wall along its long axis into ``Heart_Wall_Anterior`` / ``Heart_Wall_Posterior``,
   capping each cut so the myocardial thickness reads as solid tissue;
6. stores approximate LAD / LCX / RCA perfusion-territory weights on both halves as the ``Territory``
   colour attribute (exported as ``COLOR_0``);
7. parents nodes under the ``Layer_*`` empties, assigns one named placeholder PBR material per node and
   exports ``anatomy/build/cardiotwin_anatomy.raw.glb`` plus per-vessel PLY meshes for the centreline
   stage and a machine-readable ``build_report.json``.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))

import meshops as mo  # noqa: E402
from common import (  # noqa: E402
    BUILD_BLEND,
    BUILD_DIR,
    BUILD_REPORT,
    RAW_DIR,
    RAW_GLB,
    VESSEL_MESH_DIR,
    NodeSpec,
    load_config,
    node_specs,
    write_json,
)

ANTERIOR = np.array([0.0, -1.0, 0.0])  # BodyParts3D / Blender world: anterior is -Y
T0 = time.perf_counter()

#: Placeholder PBR looks per material category (base colour RGBA, roughness, metallic).
#: The web app restyles everything; these only make the raw GLB readable in any glTF viewer.
MATERIAL_LOOKS: dict[str, tuple[tuple[float, float, float, float], float, float]] = {
    "Skin": ((0.80, 0.58, 0.47, 0.30), 0.55, 0.0),
    "Muscle": ((0.48, 0.10, 0.09, 1.0), 0.60, 0.0),
    "Bone": ((0.86, 0.82, 0.72, 1.0), 0.55, 0.0),
    "Cartilage": ((0.70, 0.78, 0.80, 1.0), 0.35, 0.0),
    "Lung": ((0.82, 0.52, 0.52, 0.45), 0.45, 0.0),
    "Airway": ((0.78, 0.74, 0.68, 1.0), 0.50, 0.0),
    "Diaphragm": ((0.55, 0.17, 0.15, 1.0), 0.60, 0.0),
    "Myocardium": ((0.50, 0.08, 0.08, 1.0), 0.45, 0.0),
    "Valve": ((0.88, 0.78, 0.66, 1.0), 0.40, 0.0),
    "Papillary": ((0.56, 0.12, 0.11, 1.0), 0.45, 0.0),
    "Artery": ((0.70, 0.08, 0.08, 1.0), 0.35, 0.0),
    "PulmonaryArtery": ((0.22, 0.32, 0.72, 1.0), 0.35, 0.0),
    "PulmonaryVein": ((0.72, 0.22, 0.22, 1.0), 0.35, 0.0),
    "Vein": ((0.18, 0.26, 0.66, 1.0), 0.35, 0.0),
    "CardiacVein": ((0.22, 0.28, 0.62, 1.0), 0.35, 0.0),
    "Coronary": ((0.82, 0.12, 0.10, 1.0), 0.30, 0.0),
}


def log(msg: str) -> None:
    print(f"[build {time.perf_counter() - T0:7.1f}s] {msg}", flush=True)


# ============================================================================================
# Mesh <-> NumPy helpers
# ============================================================================================
def mesh_arrays(me: bpy.types.Mesh) -> mo.Mesh:
    """Vertex positions and loop-triangle indices of a mesh (float64 / int64)."""
    me.calc_loop_triangles()
    V = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", V)
    T = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get("vertices", T)
    return V.reshape(-1, 3).astype(np.float64), T.reshape(-1, 3).astype(np.int64)


def new_mesh(name: str, V: np.ndarray, F: np.ndarray) -> bpy.types.Mesh:
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", np.asarray(V, dtype=np.float32).ravel())
    me.loops.add(len(F) * 3)
    me.loops.foreach_set("vertex_index", np.asarray(F, dtype=np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set("loop_start", np.arange(0, len(F) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    return me


def new_object(name: str, me: bpy.types.Mesh) -> bpy.types.Object:
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def world_vertices(ob: bpy.types.Object) -> np.ndarray:
    V, _ = mesh_arrays(ob.data)
    M = np.array(ob.matrix_world)
    return V @ M[:3, :3].T + M[:3, 3]


def tri_count(ob: bpy.types.Object) -> int:
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def apply_modifiers(ob: bpy.types.Object) -> None:
    """Bake the modifier stack into the mesh without relying on operator context."""
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    evaluated = ob.evaluated_get(dg)
    baked = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    name = old.name
    ob.modifiers.clear()
    ob.data = baked
    bpy.data.meshes.remove(old)
    baked.name = name


# ============================================================================================
# Stage 2a — import & per-part cleanup
# ============================================================================================
def import_part(pid: str) -> mo.Mesh:
    before = set(bpy.data.objects)
    bpy.ops.wm.stl_import(filepath=str(RAW_DIR / f"{pid}.stl"))
    created = [o for o in bpy.data.objects if o not in before]
    if len(created) != 1:
        raise RuntimeError(f"STL import of {pid} produced {len(created)} objects")
    ob = created[0]
    V, F = mesh_arrays(ob.data)
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return V, F


class PartCache:
    """Imports and cleans each BodyParts3D part once."""

    def __init__(self, cleanup: dict):
        self.cleanup = cleanup
        self.parts: dict[str, mo.Mesh] = {}
        self.stats: dict[str, dict] = {}

    def get(self, pid: str, *, clean: bool = True) -> mo.Mesh:
        key = f"{pid}:{int(clean)}"
        if key not in self.parts:
            V, F = import_part(pid)
            stats = {"faces_raw": int(len(F))}
            if clean:
                (V, F), cstats = mo.filter_components(
                    V,
                    F,
                    min_fraction=self.cleanup["min_component_fraction"],
                    min_faces=self.cleanup["min_component_faces"],
                    drop_inverted=self.cleanup["drop_inverted_components"],
                )
                stats.update(cstats)
            stats["faces_clean"] = int(len(F))
            self.parts[key] = (V, F)
            self.stats[pid] = stats
        return self.parts[key]


# ============================================================================================
# Stage 2b — crops (source frame, millimetres)
# ============================================================================================
def bm_from_arrays(V: np.ndarray, F: np.ndarray) -> bmesh.types.BMesh:
    me = new_mesh("_tmp", V, F)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def bm_arrays(bm: bmesh.types.BMesh) -> mo.Mesh:
    me = bpy.data.meshes.new("_tmp")
    bm.to_mesh(me)
    V, F = mesh_arrays(me)
    bpy.data.meshes.remove(me)
    return V, F


def bm_bisect(bm, point, normal, *, clear_outer: bool = False, clear_inner: bool = False, cap: bool = False):
    """Bisect with a plane; optionally delete one side and cap the opening. Returns the cap faces.

    Kept faces keep their source winding (BodyParts3D parts are closed and outward-facing) and every
    cap face is oriented towards the removed side, so a closed outward input stays closed and
    outward. Normals are deliberately *not* recalculated here: bmesh's heuristic picks outwardness
    from one extreme face and turned the thin right pectoralis sheet inside out.
    """
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(
        bm, geom=geom, dist=1e-6, plane_co=Vector(point), plane_no=Vector(normal),
        clear_outer=clear_outer, clear_inner=clear_inner,
    )
    if not cap:
        return []
    cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    if not cut_edges:
        return []
    filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=cut_edges, normal=Vector(normal))
    faces = [f for f in filled["geom"] if isinstance(f, bmesh.types.BMFace)]
    # Loops that triangle_fill leaves open (self-touching or collinear cut loops) are closed as n-gons.
    left_open = [e for e in cut_edges if e.is_valid and e.is_boundary]
    if left_open:
        holes = bmesh.ops.holes_fill(bm, edges=left_open, sides=0)
        faces += [f for f in holes["faces"] if f.is_valid]
    outward = Vector(normal) if clear_outer else -Vector(normal)
    for f in faces:
        f.normal_update()
        if f.normal.dot(outward) < 0.0:
            f.normal_flip()
    return faces


def crop_thorax_limits(V, F, crops):
    """Trim internal structures (aorta, IVC, trachea) to the thoracic floor / neck base, capped."""
    z0, z1 = crops["inner_z_mm"]
    bm = bm_from_arrays(V, F)
    if V[:, 2].min() < z0:
        bm_bisect(bm, (0, 0, z0), (0, 0, -1), clear_outer=True, cap=True)
    if V[:, 2].max() > z1:
        bm_bisect(bm, (0, 0, z1), (0, 0, 1), clear_outer=True, cap=True)
    out = bm_arrays(bm)
    bm.free()
    return out


def crop_arm_planes(V, F, crops, *, only_above_axilla: bool = False):
    """Remove the upper limbs with the oblique shoulder planes (both sides)."""
    arm = crops["arm_plane"]
    bm = bm_from_arrays(V, F)
    for side in (1, -1):
        p, n = mo.arm_plane(arm["axilla_xz_mm"], arm["shoulder_xz_mm"], side)
        if only_above_axilla:
            bm_bisect(bm, p, n)
            z_lim = arm["axilla_xz_mm"][1] - arm["below_axilla_margin_mm"]
            doomed = [
                f for f in bm.faces
                if (f.calc_center_median() - Vector(p)).dot(Vector(n)) > 0 and f.calc_center_median().z > z_lim
            ]
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
        else:
            bm_bisect(bm, p, n, clear_outer=True, cap=True)
    out = bm_arrays(bm)
    bm.free()
    return out


def crop_skin_outer_shell(V, F, crops):
    """Thoracic skin: outermost shell only, cropped to the thorax, upper limbs removed.

    BodyParts3D's skin is a whole-body model whose largest connected component contains many
    internal surfaces. The true epidermal surface is a separate shell; it is found by casting
    horizontal rays from outside the body towards its axis and keeping the component that is hit
    first most often.
    """
    z0, z1 = crops["thorax_z_mm"]
    c = mo.face_centers(V, F)
    V, F = mo.compact(V, F, (c[:, 2] > z0 - 15) & (c[:, 2] < z1 + 15))
    labels = mo.face_components(F, len(V))
    bvh = BVHTree.FromPolygons(V.tolist(), F.tolist(), all_triangles=True)
    centre = mo.bbox_center(V)
    radius = float(np.abs(V[:, :2] - centre[:2]).max() * 3.0)
    votes: dict[int, int] = {}
    for z in np.linspace(z0 + 20, z1 - 20, 14):
        for a in np.radians(np.arange(0, 360, 6)):
            d = Vector((math.cos(a), math.sin(a), 0.0))
            origin = Vector((centre[0], centre[1], z)) + d * radius
            _, _, idx, _ = bvh.ray_cast(origin, -d)
            if idx is not None:
                votes[int(labels[idx])] = votes.get(int(labels[idx]), 0) + 1
    outer = max(votes, key=votes.get)
    share = votes[outer] / sum(votes.values())
    log(f"  skin: outer shell hit first by {share:.0%} of {sum(votes.values())} rays")
    if share < 0.8:
        raise RuntimeError("could not identify the outer skin shell unambiguously")
    V, F = mo.compact(V, F, labels == outer)
    bm = bm_from_arrays(V, F)
    bm_bisect(bm, (0, 0, z0), (0, 0, -1), clear_outer=True)
    bm_bisect(bm, (0, 0, z1), (0, 0, 1), clear_outer=True)
    V, F = bm_arrays(bm)
    bm.free()
    V, F = crop_arm_planes(V, F, crops, only_above_axilla=True)
    return mo.largest_component(V, F)


CROPS = {
    "skin_outer_shell": crop_skin_outer_shell,
    "arm_plane": crop_arm_planes,
    "thorax_limits": crop_thorax_limits,
}


# ============================================================================================
# Stage 2c — mesh finishing (scene frame)
# ============================================================================================
def orient_outward(bm: bmesh.types.BMesh) -> int:
    """Make winding consistent, then turn every inside-out connected component the right way out.

    ``recalc_face_normals`` only guarantees consistency; its outward guess can invert thin sheets,
    so the orientation of each component is decided by the sign of its enclosed volume.
    Returns the number of faces reversed by the volume test.
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    V = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    F = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64)
    inverted = np.nonzero(mo.inverted_component_faces(V, F))[0]
    if len(inverted):
        bmesh.ops.reverse_faces(bm, faces=[bm.faces[i] for i in inverted.tolist()])
    return int(len(inverted))


def finish_topology(ob: bpy.types.Object, *, merge_dist: float, recalc_normals: bool) -> None:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=merge_dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=merge_dist)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    if recalc_normals:
        flipped = orient_outward(bm)
        if flipped:
            log(f"  {ob.name}: {flipped} faces of inside-out components reversed")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def remesh_seamless(ob: bpy.types.Object, voxel: float) -> None:
    """Fuse touching parts into one watertight surface (voxel remesh) and relax voxel stair-steps.

    Used for tubes that BodyParts3D splits into abutting segments (ascending aorta / arch /
    descending aorta), whose coincident end caps otherwise show as hard seam rings.
    """
    mod = ob.modifiers.new("Remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    smooth = ob.modifiers.new("Relax", "CORRECTIVE_SMOOTH")
    smooth.smooth_type = "SIMPLE"
    smooth.use_only_smooth = True
    smooth.factor = 0.5
    smooth.iterations = 6
    smooth.use_pin_boundary = True
    apply_modifiers(ob)


def decimate_to(ob: bpy.types.Object, budget: int) -> None:
    n = tri_count(ob)
    if n <= budget:
        return
    mod = ob.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = budget / n
    mod.use_collapse_triangulate = True
    apply_modifiers(ob)


def taubin_object(ob: bpy.types.Object, iterations: int) -> None:
    """Taubin-smooth an object's mesh in place (see :func:`meshops.taubin_smooth`)."""
    V, F = mesh_arrays(ob.data)
    V = mo.taubin_smooth(V, F, iterations=iterations)
    ob.data.vertices.foreach_set("co", V.astype(np.float32).ravel())
    ob.data.update()


def reorient_after_decimation(ob: bpy.types.Object) -> None:
    """Edge collapses on thin sheets can leave a few faces wound against their neighbours; restore
    consistent, outward winding (see :func:`orient_outward`)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    flipped = orient_outward(bm)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    if flipped:
        log(f"  {ob.name}: {flipped} faces reversed after decimation")


def smooth_normals(ob: bpy.types.Object, flat_faces: set[int] | None = None, *, sharp_deg: float = 75.0) -> None:
    """Smooth shading with Blender's corner-angle-weighted vertex normals.

    Edges folding more than ``sharp_deg`` (the rims of thin walls at vessel and valve openings, the
    edges of cut caps) are marked sharp so the normals split there instead of averaging two opposite
    surfaces into a dark seam; ``flat_faces`` (cut caps) stay flat. Face-area weighting is avoided:
    after decimation it lets a few large triangles dominate and inverted ~4 % of the heart-wall
    vertex normals against their faces.
    """
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    limit = math.radians(sharp_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    smooth = np.ones(len(me.polygons), dtype=bool)
    if flat_faces:
        smooth[list(flat_faces)] = False
    me.polygons.foreach_set("use_smooth", smooth)
    me.update()


def orient_open_shell_outward(ob: bpy.types.Object) -> None:
    """Flip an open shell (the skin) if most face normals point towards the body axis."""
    V, F = mesh_arrays(ob.data)
    c = mo.face_centers(V, F)
    radial = c[:, :2] - mo.bbox_center(V)[:2]
    radial /= np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-9)
    n = mo.face_normals(V, F)
    if float((n[:, :2] * radial).sum(axis=1).mean()) < 0:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(ob.data)
        bm.free()


# ============================================================================================
# Stage 2d — heart split & perfusion territories
# ============================================================================================
#: Open edges tolerated on a capped heart half (a few from non-manifold source vertices on the plane).
MAX_OPEN_CAP_EDGES = 8


def split_heart(ob: bpy.types.Object, plane_co, plane_no) -> dict[str, tuple[bpy.types.Object, set[int]]]:
    """Cut the heart wall into anterior / posterior halves, capping each opening.

    Returns ``{"anterior": (object, cap_face_indices), "posterior": (...)}``; cap faces are flat and
    their rim edges are marked sharp so smooth shading does not bleed across the cut.
    """
    halves = {}
    for side, clear_outer in (("anterior", False), ("posterior", True)):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        # clear_outer removes the side the normal points to (anterior); clear_inner the opposite side.
        caps = bm_bisect(bm, plane_co, plane_no, clear_outer=clear_outer, clear_inner=not clear_outer, cap=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        # Scan-fill leaves zero-area slivers where cut points are collinear.
        bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        open_edges = sum(1 for e in bm.edges if e.is_boundary)
        if open_edges > MAX_OPEN_CAP_EDGES:
            # A cut loop that could not be capped means the wall touches itself on the cutting plane
            # (e.g. over-smoothed thin atrial wall): fail loudly instead of publishing a hole.
            raise RuntimeError(f"heart {side}: {open_edges} open edges after capping the cut")
        me = bpy.data.meshes.new(f"Heart_Wall_{side.title()}")
        bm.to_mesh(me)
        bm.free()
        if me.validate(verbose=False, clean_customdata=False):
            log(f"  heart {side}: mesh validation repaired invalid geometry")
        # Identify cap faces geometrically (all three vertices on the cutting plane) and mark the
        # rim edges sharp so the flat cap does not bleed into the smooth wall shading.
        V, _ = mesh_arrays(me)
        on_plane = np.abs((V - plane_co) @ plane_no) < 1e-5
        tris = np.empty(len(me.polygons) * 3, dtype=np.int32)
        me.polygons.foreach_get("vertices", tris)
        tris = tris.reshape(-1, 3)
        is_cap = on_plane[tris].all(axis=1)
        cap_idx = set(np.nonzero(is_cap)[0].tolist())
        me.edges.foreach_set("use_edge_sharp", rim_edge_mask(me, tris, is_cap))
        half = new_object(f"Heart_Wall_{side.title()}", me)
        halves[side] = (half, cap_idx)
        log(f"  heart {side}: {len(me.polygons)} tris, cap {len(cap_idx)} tris (from {len(caps)} filled)")
    return halves


def rim_edge_mask(me: bpy.types.Mesh, tris: np.ndarray, is_cap: np.ndarray) -> np.ndarray:
    """Boolean per mesh edge: True where a cap triangle meets a wall triangle."""
    n = len(me.vertices)
    tri_edges = np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), axis=1)
    keys = tri_edges[:, 0].astype(np.int64) * n + tri_edges[:, 1]
    cap_flag = np.tile(is_cap, 3)
    cap_keys = set(keys[cap_flag].tolist())
    wall_keys = set(keys[~cap_flag].tolist())
    rim = cap_keys & wall_keys
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = np.sort(ev.reshape(-1, 2), axis=1)
    return np.fromiter((k in rim for k in (ev[:, 0] * n + ev[:, 1]).tolist()), dtype=bool, count=len(ev))


def _kdtree(targets: np.ndarray) -> KDTree:
    tree = KDTree(len(targets))
    for i, p in enumerate(targets):
        tree.insert(p, i)
    tree.balance()
    return tree


def nearest_distance(points: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """Euclidean distance from every point to its nearest target point (mathutils KD-tree)."""
    tree = _kdtree(targets)
    return np.fromiter((tree.find(p)[2] for p in points), dtype=np.float64, count=len(points))


def nearest_index(points: np.ndarray, targets: np.ndarray) -> np.ndarray:
    tree = _kdtree(targets)
    return np.fromiter((tree.find(p)[1] for p in points), dtype=np.int64, count=len(points))


def wall_thickness(ob: bpy.types.Object, *, cone_deg: float = 35.0, n_tilted: int = 6) -> np.ndarray:
    """Local myocardial thickness per vertex of a closed wall mesh.

    Rays are cast from each vertex into the solid — along the inward normal and ``n_tilted`` rays
    tilted by ``cone_deg`` around it — and the shortest distance to the opposite surface is kept.
    In a genuinely thick wall every direction is long (>= thickness), whereas at thin vessel rims and
    auricle edges, where the normal runs along the wall, a tilted ray exits within a few millimetres.
    """
    me = ob.data
    V, F = mesh_arrays(me)
    N = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("normal", N)
    N = N.reshape(-1, 3).astype(np.float64)
    bvh = BVHTree.FromPolygons(V.tolist(), F.tolist(), all_triangles=True)
    eps = 1e-4
    c, s_ = math.cos(math.radians(cone_deg)), math.sin(math.radians(cone_deg))
    angles = [2 * math.pi * k / n_tilted for k in range(n_tilted)]
    out = np.full(len(V), np.inf)
    for i, (p, n) in enumerate(zip(V, N)):
        inward = Vector(-n)
        t1 = inward.orthogonal().normalized()
        t2 = inward.cross(t1)
        origin = Vector(p) + inward * eps
        dirs = [inward] + [(inward * c + (t1 * math.cos(a) + t2 * math.sin(a)) * s_) for a in angles]
        best = np.inf
        for d in dirs:
            hit = bvh.ray_cast(origin, d, 0.5)
            if hit[0] is not None and hit[3] < best:
                best = hit[3]
        out[i] = best + eps
    return out


def territory_colors(
    heart_V: np.ndarray,
    heart_F: np.ndarray,
    groups: dict[str, np.ndarray],
    order: list[str],
    *,
    thickness: np.ndarray,
    cfg: dict,
    scale: float,
    inflow_outflow_V: np.ndarray,
    ventricular_V: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-vertex (LAD, LCX, RCA) weights, the ventricular mask and a QA array.

    The QA array holds ``(landmark rule, thickness rule, final mask)`` per vertex and is stored as a
    Blender-only colour attribute for inspection (``preview.py --views qa``); it is not exported.

    A vertex is ventricular myocardium when either
    * its wall is thick (``thickness >= ventricular_thickness_mm``: LV free wall and septum are
      8–12 mm, atrial walls ~2 mm; see :func:`wall_thickness`), or
    * it is closer to the ventricular landmarks (papillary muscles, septal perforators, LAD, PDA,
      marginal branches, apex) than to the inflow / outflow landmarks (venae cavae, pulmonary veins,
      aortic and pulmonary roots) — this catches the thin right-ventricular free wall.
    Atria and great-vessel roots fade to zero. See :func:`meshops.territory_weights`.
    """
    lm = cfg["atrial_landmarks"]
    dist = np.column_stack([nearest_distance(heart_V, groups[gid]) for gid in order])
    d_in = nearest_distance(heart_V, inflow_outflow_V)
    d_vent = nearest_distance(heart_V, ventricular_V)
    by_landmark = mo.smoothstep(-lm["width_mm"] * scale, lm["width_mm"] * scale, d_in - d_vent + lm["bias_mm"] * scale)
    t0, t1 = cfg["ventricular_thickness_mm"]
    by_thickness = mo.smoothstep(t0 * scale, t1 * scale, np.where(np.isfinite(thickness), thickness, 0.0))
    ventricular = mo.smooth_vertex_values(np.maximum(by_landmark, by_thickness), heart_F, iterations=cfg["smooth_iterations"])
    qa = np.column_stack([by_landmark, by_thickness, ventricular])
    weights = mo.territory_weights(
        dist,
        sigma=cfg["sigma_mm"] * scale,
        fade_start=cfg["fade_start_mm"] * scale,
        fade_tau=cfg["fade_tau_mm"] * scale,
        extra_fade=ventricular,
    )
    weights = mo.smooth_vertex_values(weights, heart_F, iterations=cfg["smooth_iterations"])
    return np.clip(weights, 0.0, 1.0), ventricular, qa


def set_color_attribute(ob: bpy.types.Object, name: str, rgb: np.ndarray) -> None:
    me = ob.data
    for existing in list(me.color_attributes):
        me.color_attributes.remove(existing)
    attr = me.color_attributes.new(name=name, type="FLOAT_COLOR", domain="POINT")
    rgba = np.ones((len(me.vertices), 4), dtype=np.float32)
    rgba[:, :3] = rgb
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


# ============================================================================================
# Stage 2e — materials, hierarchy, export
# ============================================================================================
def make_material(name: str, category: str) -> bpy.types.Material:
    (r, g, b, a), rough, metal = MATERIAL_LOOKS[category]
    mat = bpy.data.materials.new(name)
    if not mat.node_tree:  # Blender < 5 creates materials without a node tree by default
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Alpha"].default_value = a
    if a < 1.0:
        mat.surface_render_method = "BLENDED"
    # Every mesh is a closed solid except the skin shell, so only the skin needs double-sided shading.
    mat.use_backface_culling = category != "Skin"
    mat.diffuse_color = (r, g, b, a)
    mat["ct_category"] = category
    return mat


def recenter_origin(ob: bpy.types.Object) -> None:
    """Move the object origin to its bounding-box centre (vertices keep their world position)."""
    V = world_vertices(ob)
    c = Vector(mo.bbox_center(V).tolist())
    ob.data.transform(Matrix.Translation(-c))
    ob.location = c


def export_glb(path: Path) -> None:
    kwargs = dict(
        filepath=str(path), export_format="GLB", use_selection=False, export_yup=True, export_apply=True,
        export_texcoords=False, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_vertex_color="NAME", export_vertex_color_name="Territory", export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_attributes=False, export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False,
    )
    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{k: v for k, v in kwargs.items() if k in valid})


# ============================================================================================
# Main
# ============================================================================================
def build(args: argparse.Namespace) -> None:
    cfg = load_config()
    specs = node_specs(cfg)
    crops = cfg["crops"]
    cleanup = cfg["cleanup"]
    terr_cfg = cfg["territories"]
    scale = cfg["frame"]["units_per_mm"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"

    cache = PartCache(cleanup)

    # --- origin: heart-wall bounding-box centre (after cleanup) -------------------------------
    heart_specs = [s for s in specs if s.raw.get("split")]
    heart_part = heart_specs[0].parts[0]
    hV, _ = cache.get(heart_part)
    origin_mm = mo.bbox_center(hV)
    log(f"origin (heart-wall bbox centre) = {np.round(origin_mm, 2).tolist()} mm")

    def to_scene(V: np.ndarray) -> np.ndarray:
        return (V - origin_mm) * scale

    merge_dist = cleanup["merge_distance_mm"] * scale
    objects: dict[str, bpy.types.Object] = {}
    flat_faces: dict[str, set[int]] = {}
    node_stats: dict[str, dict] = {}

    # --- regular nodes ------------------------------------------------------------------------
    for spec in specs:
        if spec.raw.get("split"):
            continue
        parts = [cache.get(pid) for pid in spec.parts]
        smoothing = spec.raw.get("taubin", {})
        crop = spec.raw.get("crop")
        if crop:
            # Crop each closed part on its own: a single cut loop per part caps cleanly, whereas the
            # overlapping loops of touching parts (e.g. the two heads of pectoralis) do not.
            parts = [CROPS[crop["type"]](V, F, crops) for V, F in parts]
        V, F = mo.concat(parts)
        ob = new_object(spec.node, new_mesh(spec.node, to_scene(V), F))
        closed = crop is None or crop["type"] != "skin_outer_shell"
        finish_topology(ob, merge_dist=merge_dist, recalc_normals=closed)
        if not closed:
            orient_open_shell_outward(ob)
        before = tri_count(ob)
        if spec.raw.get("remesh_mm"):
            remesh_seamless(ob, spec.raw["remesh_mm"] * scale)
        if smoothing.get("pre"):  # on the welded source, so no vertex pair can collapse into a hole
            taubin_object(ob, int(smoothing["pre"]))
        decimate_to(ob, spec.budget)
        if closed:
            reorient_after_decimation(ob)
        if smoothing.get("post"):
            taubin_object(ob, int(smoothing["post"]))
        objects[spec.node] = ob
        node_stats[spec.node] = {"triangles_source": before}
        log(f"{spec.node:28s} {before:8d} -> {tri_count(ob):7d} tris")

    # --- heart wall: decimate whole, then open along the long axis ----------------------------
    wall_budget = sum(s.budget for s in heart_specs)
    V, F = cache.get(heart_part)
    wall = new_object("Heart_Wall", new_mesh("Heart_Wall", to_scene(V), F))
    finish_topology(wall, merge_dist=merge_dist, recalc_normals=True)
    wall_src = tri_count(wall)
    # BodyParts3D's wall carries segmentation terraces (~1 mm) that read as wood grain under specular
    # light: a Taubin pass on the welded source, and a short one after decimation to relax collapse
    # facets (mean surface shift ~0.3 mm; the coronaries stay seated on the epicardium).
    wall_smooth = heart_specs[0].raw.get("taubin", {})
    if wall_smooth.get("pre"):
        taubin_object(wall, int(wall_smooth["pre"]))
    decimate_to(wall, wall_budget)
    reorient_after_decimation(wall)
    if wall_smooth.get("post"):
        taubin_object(wall, int(wall_smooth["post"]))
    wall_V = world_vertices(wall)
    wall_thick = wall_thickness(wall)
    finite = wall_thick[np.isfinite(wall_thick)] / scale
    log(f"wall thickness (mm): p10 {np.percentile(finite, 10):.1f}  median {np.median(finite):.1f}  p90 {np.percentile(finite, 90):.1f}")
    valve_V = to_scene(mo.concat([cache.get(p) for p in ("FMA7235", "FMA7234")])[0])
    base, apex, axis = mo.heart_long_axis(world_vertices(wall), valve_V)
    plane_co, plane_no = mo.heart_cut_plane(base, apex, ANTERIOR)
    log(f"heart long axis {np.round(axis, 3).tolist()}, cut normal {np.round(plane_no, 3).tolist()}")
    halves = split_heart(wall, plane_co, plane_no)
    bpy.data.meshes.remove(wall.data)
    for spec in heart_specs:
        half, caps = halves[spec.raw["split"]["side"]]
        half.name = spec.node
        half.data.name = spec.node
        objects[spec.node] = half
        flat_faces[spec.node] = caps
        node_stats[spec.node] = {"triangles_source": wall_src, "cap_triangles": len(caps)}

    # --- perfusion territories on both halves --------------------------------------------------
    order = terr_cfg["groups"]
    groups = {
        gid: np.concatenate([world_vertices(objects[s.node]) for s in specs if s.coronary_group == gid])
        for gid in order
    }
    lm_cfg = terr_cfg["atrial_landmarks"]
    inflow_V = np.concatenate([to_scene(cache.get(p)[0]) for p in lm_cfg["inflow_outflow_parts"]])
    vent_V = np.concatenate([to_scene(cache.get(p)[0]) for p in lm_cfg["ventricular_parts"]])
    groove_V = np.concatenate([to_scene(cache.get(p)[0]) for p in lm_cfg["av_groove_parts"]])
    near_groove = nearest_distance(vent_V, groove_V) < lm_cfg["av_groove_exclusion_mm"] * scale
    log(f"  ventricular landmarks: {len(vent_V)} points, {int(near_groove.sum())} beside the AV groove ignored")
    vent_V = vent_V[~near_groove]
    if lm_cfg.get("include_apex"):
        vent_V = np.concatenate([vent_V, apex[None]])
    for spec in heart_specs:
        ob = objects[spec.node]
        hV, hF = mesh_arrays(ob.data)
        rgb, ventricular, qa_values = territory_colors(
            hV, hF, groups, order,
            thickness=wall_thick[nearest_index(hV, wall_V)],
            cfg=terr_cfg,
            scale=scale,
            inflow_outflow_V=inflow_V,
            ventricular_V=vent_V,
        )
        set_color_attribute(ob, terr_cfg["attribute"], rgb)
        # QA-only attribute (not exported): R = landmark rule, G = thickness rule, B = final mask.
        qa = ob.data.color_attributes.new(name="QA_Ventricular", type="FLOAT_COLOR", domain="POINT")
        rgba = np.ones((len(ob.data.vertices), 4), dtype=np.float32)
        rgba[:, :3] = qa_values
        qa.data.foreach_set("color", rgba.ravel())
        ob.data.color_attributes.active_color = ob.data.color_attributes[terr_cfg["attribute"]]
        dominant = np.bincount(rgb.argmax(axis=1)[rgb.sum(axis=1) > 0.5], minlength=3)
        stats = {
            "territory_dominant_vertices": dict(zip(order, dominant.tolist())),
            "ventricular_vertex_fraction": round(float((ventricular > 0.5).mean()), 4),
        }
        node_stats[spec.node].update(stats)
        log(f"  territories {spec.node}: {stats}")

    # --- normals, materials, extras, hierarchy -------------------------------------------------
    layers = {}
    for layer in cfg["layers"]:
        empty = bpy.data.objects.new(layer["node"], None)
        empty.empty_display_type = "PLAIN_AXES"
        empty["ct_layer"] = layer["id"]
        empty["ct_label"] = layer["label"]
        scene.collection.objects.link(empty)
        layers[layer["id"]] = empty

    for spec in specs:
        ob = objects[spec.node]
        smooth_normals(ob, flat_faces.get(spec.node))
        mat = make_material(f"{spec.node}_Mat", spec.material)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        ob["ct_id"] = spec.id
        ob["ct_layer"] = spec.layer
        ob["ct_label"] = spec.label
        ob["ct_target"] = spec.target or ""
        ob["ct_category"] = spec.material
        recenter_origin(ob)
        ob.parent = layers[spec.layer]
    bpy.context.view_layer.update()  # refresh matrix_world after re-centring / parenting

    # --- per-vessel meshes for the centreline stage (glTF frame) --------------------------------
    VESSEL_MESH_DIR.mkdir(parents=True, exist_ok=True)
    for spec in specs:
        if spec.is_coronary:
            V, F = mesh_arrays(objects[spec.node].data)
            M = np.array(objects[spec.node].matrix_world)
            mo.write_ply(VESSEL_MESH_DIR / f"{spec.node}.ply", mo.to_gltf(V @ M[:3, :3].T + M[:3, 3]), F)
    for name in ("GreatVessel_Aorta",):
        V, F = mesh_arrays(objects[name].data)
        M = np.array(objects[name].matrix_world)
        mo.write_ply(VESSEL_MESH_DIR / f"{name}.ply", mo.to_gltf(V @ M[:3, :3].T + M[:3, 3]), F)

    # --- report --------------------------------------------------------------------------------
    report_nodes = []
    total = 0
    for spec in specs:
        ob = objects[spec.node]
        Vw = world_vertices(ob)
        g = mo.to_gltf(Vw)
        lo, hi = mo.bbox(g)
        n = tri_count(ob)
        total += n
        report_nodes.append({
            "node": spec.node, "id": spec.id, "layer": spec.layer, "parent": layers[spec.layer].name,
            "material": ob.data.materials[0].name, "category": spec.material,
            "triangles": n, "vertices": len(ob.data.vertices), "budget": spec.budget,
            "bbox_min": np.round(lo, 5).tolist(), "bbox_max": np.round(hi, 5).tolist(),
            "center": np.round((lo + hi) / 2, 5).tolist(),
            "parts": list(spec.parts), **node_stats[spec.node],
        })
    report = {
        "version": cfg["version"],
        "blender": bpy.app.version_string,
        "frame": {
            "units_per_mm": scale,
            "origin_mm_bodyparts3d": np.round(origin_mm, 4).tolist(),
            "axes": cfg["frame"]["axes"],
        },
        "heart": {
            "base_center": np.round(mo.to_gltf(base[None])[0], 5).tolist(),
            "apex": np.round(mo.to_gltf(apex[None])[0], 5).tolist(),
            "long_axis": np.round(mo.to_gltf(axis[None])[0], 5).tolist(),
            "cut_plane": {
                "point": np.round(mo.to_gltf(plane_co[None])[0], 5).tolist(),
                "normal": np.round(mo.to_gltf(plane_no[None])[0], 5).tolist(),
            },
        },
        "territories": {**terr_cfg, "encoding": "COLOR_0.rgb = (LAD, LCX, RCA) weights; r+g+b = territory confidence"},
        "triangles_total": total,
        "triangle_budget_total": cfg["triangle_budget_total"],
        "nodes": report_nodes,
        "parts": cache.stats,
    }
    write_json(BUILD_REPORT, report)
    log(f"total triangles: {total:,} (budget {cfg['triangle_budget_total']:,})")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    export_glb(RAW_GLB)
    log(f"exported {RAW_GLB} ({RAW_GLB.stat().st_size / 1e6:.2f} MB)")
    if not args.no_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_BLEND), compress=True)
        log(f"saved {BUILD_BLEND}")


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="build_anatomy.py")
    ap.add_argument("--no-blend", action="store_true", help="do not save anatomy/build/cardiotwin_build.blend")
    return ap.parse_args(argv)


if __name__ == "__main__":
    try:
        build(parse_args())
    except Exception:  # make Blender exit non-zero so build.py notices
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
