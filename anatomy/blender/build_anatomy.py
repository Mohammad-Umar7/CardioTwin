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
import json
import math
import os
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
    SYNTH_DIR,
    SYNTH_PREFIX,
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
    "Fat": ((0.86, 0.68, 0.30, 1.0), 0.40, 0.0),
    "Oesophagus": ((0.70, 0.40, 0.36, 1.0), 0.50, 0.0),
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
        if key not in self.parts and pid.startswith(SYNTH_PREFIX):
            # Derived / synthesised part written by anatomy/scripts/synthesize.py (BodyParts3D mm frame).
            path = SYNTH_DIR / f"{pid}.ply"
            if not path.exists():
                raise RuntimeError(f"{path} missing: run anatomy/scripts/synthesize.py (build stage 'synth') first")
            V, F = mo.read_ply(path)
            self.parts[key] = (V, F)
            self.stats[pid] = {"faces_raw": int(len(F)), "faces_clean": int(len(F)), "synthesised": True}
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


def close_surface(ob: bpy.types.Object, iterations: int = 12) -> tuple[int, int]:
    """Close a surface a hole-tolerant Boolean left with slits and non-manifold seams: weld, drop degenerate faces, then
    repeatedly cut out the faces round every open or over-shared edge and fill the holes they leave. Face attributes
    of the surviving faces are kept (a fill face gets the default). Returns the non-manifold edges before / after."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
    before = sum(1 for e in bm.edges if not e.is_manifold)
    for _ in range(iterations):
        bad = [e for e in bm.edges if not e.is_manifold]
        if not bad:
            break
        faces = list({f for e in bad for f in e.link_faces})
        if faces:
            bmesh.ops.delete(bm, geom=faces, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        loose_e = [e for e in bm.edges if not e.link_faces]
        if loose_e:
            bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    after = sum(1 for e in bm.edges if not e.is_manifold)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.validate(verbose=False)
    ob.data.update()
    return before, after


def carve_tunnels(wall: bpy.types.Object, V_mm: np.ndarray, F: np.ndarray, to_scene, plane=None,
                  plane_clear: float = 0.04) -> dict:
    """Carve the channels of the vessels that pass under a fused structure out of the heart wall.

    In BodyParts3D the tip of the left auricle is fused onto the ventricle over the proximal LAD, the circumflex and the
    great cardiac vein, so their designed courses run through solid wall there. ``synthesize.py`` writes a cutter
    (``SYN_TunnelCutter``: the vessel tubes + 0.7 mm over those stretches, + 0.35 mm as a shallow bed where a vein
    still dips into a ridge of the wall after its capped lift) and the wall yields to it (exact Boolean difference):
    the auricle overlies the vessels as in vivo, and no vessel runs inside the myocardium."""
    if not len(F):
        return {"stretches": 0}
    Vc = to_scene(V_mm)
    skipped = 0
    if plane is not None:  # a channel crossing the long-axis cut would leave a hole in the cap: keep those solid
        comp = mo.face_components(F, len(Vc))
        keep = np.ones(len(F), dtype=bool)
        for c in np.unique(comp):
            fs = comp == c
            d = (Vc[np.unique(F[fs])] - plane[0]) @ plane[1]
            if d.min() < plane_clear and d.max() > -plane_clear:
                keep[fs] = False
                skipped += 1
        Vc, F = mo.compact(Vc, F, keep)
        if not len(F):
            return {"channels": 0, "skipped_at_cut_plane": skipped}
    cut = new_object("_TunnelCutter", new_mesh("_TunnelCutter", Vc, F))
    before = tri_count(wall)
    vol0 = abs(mo.signed_volume(*mesh_arrays(wall.data)))
    mod = wall.modifiers.new("tunnels", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cut
    try:
        mod.use_self = False
        mod.use_hole_tolerant = True
    except AttributeError:
        pass
    apply_modifiers(wall)
    me_cut = cut.data
    bpy.data.objects.remove(cut)
    bpy.data.meshes.remove(me_cut)
    seams = close_surface(wall)  # the hole-tolerant solver leaves slits where two channels meet: close the half again
    reorient_after_decimation(wall)
    V2, F2 = mesh_arrays(wall.data)
    vol1 = abs(mo.signed_volume(V2, F2))
    info = {"triangles": [before, tri_count(wall)], "volume_change_ml": round((vol1 - vol0) / 0.01 ** 3 / 1000.0, 2),
            "skipped_at_cut_plane": skipped, "non_manifold_edges": list(seams)}
    if tri_count(wall) < 0.8 * before or abs(vol1 - vol0) > 0.05 * vol0:
        raise RuntimeError(f"tunnel carving failed: {info}")
    return info


def carve_lung(lung: bpy.types.Object, masters: list[bpy.types.Object], margin: float, budget: int) -> dict:
    """Carve the cardiac impression into a (display-only) lung: every master (heart halves, fat, great vessels,
    coronaries, cardiac veins) is inflated by ``margin`` along its vertex normals and subtracted (exact Boolean),
    so nothing that the smooth push-out could not clear (deep dents, thin vessels between coarse lung vertices)
    still intersects the lung. The first pass uses coarse cutters for the big masters (a decimated shell cuts inside
    its source on convex ridges) and a very dense impression is decimated once more, which can pull the carved surface
    back into a master: a second pass with the full-resolution masters inflated by half the margin carves only what
    is left, and adds detail only there. The inflated masters intersect themselves in the grooves, which leaves slits
    and non-manifold seams in the result: those are cut out and re-filled until the lung is closed again."""
    before = tri_count(lung)
    decimate_to(lung, int(budget * 0.55))  # coarser first: the impression adds the detail where it is carved
    reorient_after_decimation(lung)

    def carve(inflate: float, coarse: bool) -> int:
        V0 = world_vertices(lung)
        lo, hi = V0.min(axis=0) - 0.02, V0.max(axis=0) + 0.02
        used = 0
        for m in masters:
            mV = world_vertices(m)
            if not np.any(np.all((mV >= lo) & (mV <= hi), axis=1)):
                continue
            _, mF = mesh_arrays(m.data)
            N = np.empty(len(m.data.vertices) * 3, dtype=np.float32)
            m.data.vertices.foreach_get("normal", N)
            R = np.array(m.matrix_world)[:3, :3]
            N = N.reshape(-1, 3) @ R.T
            N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
            # An open master has no inside for the exact solver (it can remove nearly the whole organ): skip it.
            e_ = np.sort(np.concatenate([mF[:, [0, 1]], mF[:, [1, 2]], mF[:, [2, 0]]]), axis=1)
            _, e_count = np.unique(e_, axis=0, return_counts=True)
            if int((e_count == 1).sum()) > 0:
                log(f"    carve {lung.name}: master {m.name} is open ({int((e_count == 1).sum())} boundary edges); skipped")
                continue
            # An inside-out master would be inflated inwards and, as an inverted cutter, subtract everything
            # outside it: turn it right way out for the cutter, and say so.
            if mo.signed_volume(mV, mF) < 0:
                N = -N
                mF = mF[:, ::-1].copy()
                log(f"    carve {lung.name}: master {m.name} is inside-out; flipped for the cutter")
            cut = new_object("_LungCutter", new_mesh("_LungCutter", mV + N * inflate, mF))
            if coarse and tri_count(cut) > 20000:  # a coarse impression of the big masters for the first pass (thin
                decimate_to(cut, 12000)             # vessel tubes are never decimated: collapsing a thin tube shrinks it)
            mod = lung.modifiers.new("impression", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.object = cut
            try:
                mod.use_hole_tolerant = True
            except AttributeError:
                pass
            apply_modifiers(lung)
            me_cut = cut.data
            bpy.data.objects.remove(cut)
            bpy.data.meshes.remove(me_cut)
            used += 1
        return used

    used = carve(margin, coarse=True)
    carved = tri_count(lung)
    if carved > 1.6 * budget:  # only if the impression came out very dense
        decimate_to(lung, int(1.6 * budget))
        reorient_after_decimation(lung)
    second = carve(0.5 * margin, coarse=False)
    # the Booleans leave slivers where an inflated master only grazes the lung (drop crumbs and inside-out pieces) and
    # slits where two impressions meet (fill the boundary loops), so the lung stays a closed surface
    LV, LF = mesh_arrays(lung.data)
    (LV, LF), dropped = mo.filter_components(LV, LF, min_fraction=0.004, min_faces=60, drop_inverted=True)
    old_me = lung.data
    lung.data = new_mesh(lung.name, LV, LF)
    bpy.data.meshes.remove(old_me)
    open_before, open_after = close_surface(lung)
    # the repair can leave a small piece on its own: keep the lobes, then wind every lobe outward by its signed volume
    # (bmesh's normal recalculation guesses from one extreme face and turned a carved lung inside out)
    LV, LF = mesh_arrays(lung.data)
    (LV, LF), _ = mo.filter_components(LV, LF, min_fraction=0.02, min_faces=200, drop_inverted=False)
    old_me = lung.data
    lung.data = new_mesh(lung.name, LV, LF)
    bpy.data.meshes.remove(old_me)
    reorient_after_decimation(lung)
    return {"masters": used, "triangles": [before, carved, tri_count(lung)], "second_pass_masters": second,
            "crumbs_dropped": dropped, "open_edges": [open_before, open_after]}


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


def decimate_to(ob: bpy.types.Object, budget: int, protect: np.ndarray | None = None, factor: float = 0.85) -> None:
    """Collapse-decimate to ``budget`` triangles. ``protect`` (per-vertex weight 0-1) keeps detail where it is 1
    (Blender's Decimate vertex-group weighting), e.g. the extrapulmonary pulmonary trunk of the whole
    pulmonary arterial tree."""
    n = tri_count(ob)
    if n <= budget:
        return
    mod = ob.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = budget / n
    mod.use_collapse_triangulate = True
    if protect is not None:
        vg = ob.vertex_groups.new(name="_protect")
        for i, w in enumerate(np.asarray(protect, dtype=float).tolist()):
            if w > 0:
                vg.add([i], float(w), "REPLACE")
        mod.vertex_group = vg.name
        mod.invert_vertex_group = True  # weight 1 = protected
        mod.vertex_group_factor = factor
    apply_modifiers(ob)
    if protect is not None and "_protect" in ob.vertex_groups:
        ob.vertex_groups.remove(ob.vertex_groups["_protect"])
    m = tri_count(ob)
    if m > budget * 1.05:  # the vertex-group weighting can undershoot the ratio: a plain pass takes it to budget
        decimate_to(ob, budget)


def taubin_object(ob: bpy.types.Object, iterations: int) -> None:
    """Taubin-smooth an object's mesh in place (see :func:`meshops.taubin_smooth`)."""
    V, F = mesh_arrays(ob.data)
    V = mo.taubin_smooth(V, F, iterations=iterations)
    ob.data.vertices.foreach_set("co", V.astype(np.float32).ravel())
    ob.data.update()


def drop_loose_fragments(ob: bpy.types.Object, min_faces: int = 40) -> int:
    """Delete connected pieces of fewer than ``min_faces`` triangles. The voxel remesh breaks the sub-voxel distal
    tips of thin tubes (the cardiac-vein tributaries end at ~0.5 mm) into crumbs, which decimation then reduces to
    loose, open, randomly wound triangles; the tube itself ends a fraction of a millimetre earlier."""
    V, F = mesh_arrays(ob.data)
    labels = mo.face_components(F, len(V))
    _, inv, counts = np.unique(labels, return_inverse=True, return_counts=True)
    small = counts[inv] < min_faces
    if not small.any():
        return 0
    doomed = np.zeros(len(V), dtype=bool)
    doomed[F[small].ravel()] = True
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(doomed)[0]], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return int(small.sum())


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


def heal_small_defects(bm: bmesh.types.BMesh, iterations: int = 3) -> int:
    """Close the sub-millimetre defects that collapse decimation leaves on thin wall regions (and that a cap can
    inherit on the cutting plane): open slits, fins and edges shared by three faces. The faces round each defect
    are removed and the clean hole left behind is filled and triangulated. Returns the number of vertices removed."""
    removed = 0
    for _ in range(iterations):
        bad = {v for e in bm.edges if e.is_boundary or len(e.link_faces) > 2 for v in e.verts}
        if not bad:
            break
        removed += len(bad)
        bmesh.ops.delete(bm, geom=list(bad), context="VERTS")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            filled = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            faces = [f for f in filled["faces"] if f.is_valid]
            if faces:
                bmesh.ops.triangulate(bm, faces=faces)
    return removed


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
        healed = heal_small_defects(bm)
        if healed:
            log(f"  heart {side}: healed {healed} vertices of decimation slits / non-manifold edges")
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
        # face attribute read by the tissue look (anatomy/blender/looks.py): the cut faces get a cut-muscle look
        # (no leading underscore: Blender-only, not exported to glTF)
        cap_attr = me.attributes.new(name="ct_cap", type="FLOAT", domain="FACE")
        cap_attr.data.foreach_set("value", is_cap.astype(np.float32))
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
    pulmonary_trunk_V: np.ndarray | None = None,
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

    Finally, wall within ``pulmonary_trunk_gate_mm`` of the pulmonary trunk is never ventricular: the
    left atrial appendage wraps around the trunk and, being solid in BodyParts3D, passes the thickness
    rule — without the gate it glowed in the LAD's colour (it is supplied by atrial LCX branches).
    """
    lm = cfg["atrial_landmarks"]
    dist = np.column_stack([nearest_distance(heart_V, groups[gid]) for gid in order])
    d_in = nearest_distance(heart_V, inflow_outflow_V)
    d_vent = nearest_distance(heart_V, ventricular_V)
    by_landmark = mo.smoothstep(-lm["width_mm"] * scale, lm["width_mm"] * scale, d_in - d_vent + lm["bias_mm"] * scale)
    t0, t1 = cfg["ventricular_thickness_mm"]
    by_thickness = mo.smoothstep(t0 * scale, t1 * scale, np.where(np.isfinite(thickness), thickness, 0.0))
    ventricular = np.maximum(by_landmark, by_thickness)
    if pulmonary_trunk_V is not None and len(pulmonary_trunk_V):
        g0, g1 = cfg["pulmonary_trunk_gate_mm"]
        ventricular = ventricular * mo.smoothstep(g0 * scale, g1 * scale, nearest_distance(heart_V, pulmonary_trunk_V))
    ventricular = mo.smooth_vertex_values(ventricular, heart_F, iterations=cfg["smooth_iterations"])
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


#: AHA-17 standard coronary territories (Cerqueira et al., AHA 2002; right-dominant): segment -> group index
#: in the territory order (LAD, LCX, RCA). REFERENCE.md §5.10.
AHA_STANDARD = {1: 0, 2: 0, 7: 0, 8: 0, 13: 0, 14: 0, 17: 0, 3: 2, 4: 2, 9: 2, 10: 2, 15: 2, 5: 1, 6: 1, 11: 1, 12: 1, 16: 1}


#: Samples of the LV cavity profile along its axis (apex -> mitral centre) and rays per sample.
LV_PROFILE_SAMPLES, LV_PROFILE_RAYS = 17, 36


def lv_cavity_profile(WV: np.ndarray, WF: np.ndarray, mv_V: np.ndarray, base: np.ndarray, apex: np.ndarray,
                      scale: float) -> dict:
    """The LV's own frame for the heartbeat's wall thickening: its axis from the apex to the mitral hinge centre
    (valve vertices touching the wall, basal quartile; the AHA-17 definition) and, at each of LV_PROFILE_SAMPLES
    heights along it, the radii of its cavity and of the wall around it: the median distances from the axis to the
    first wall surface each of LV_PROFILE_RAYS rays across it meets (the endocardium; 0 where the axis runs inside
    the myocardium, at the apex) and to where the ray leaves that wall again (the epicardium of the free wall, the
    RV face of the septum)."""
    u_ba = mo.unit(apex - base)
    touch = nearest_distance(mv_V, WV) <= 1.0 * scale
    proj = (mv_V - base) @ u_ba
    hinge = mv_V[touch & (proj <= np.quantile(proj, 0.25))]
    ma_c = hinge.mean(axis=0) if len(hinge) > 20 else mv_V.mean(axis=0)
    axis = ma_c - apex
    L = float(np.linalg.norm(axis))
    a = axis / L
    e1 = mo.unit(np.cross(a, [0.0, 0.0, 1.0]) if abs(a[2]) < 0.9 else np.cross(a, [1.0, 0.0, 0.0]))
    e2 = np.cross(a, e1)
    bvh = BVHTree.FromPolygons(WV.tolist(), WF.tolist(), all_triangles=True)
    endo, epi = [], []
    for u in np.linspace(0.0, 1.0, LV_PROFILE_SAMPLES):
        o = apex + a * (u * L)
        r_in, r_out = [], []
        for t in np.linspace(0.0, 2 * np.pi, LV_PROFILE_RAYS, endpoint=False):
            d = Vector(math.cos(t) * e1 + math.sin(t) * e2)
            loc, nrm, _, dist = bvh.ray_cast(Vector(o), d, 60.0 * scale)
            if loc is None:
                continue
            # a face seen from its front: the ray left the cavity; from its back: it started in the myocardium
            start = float(dist) if Vector(nrm).dot(d) < 0.0 else 0.0
            if start > 0.0:
                loc2, nrm2, _, dist2 = bvh.ray_cast(loc + d * (1e-3 * scale), d, 40.0 * scale)
                if loc2 is None or Vector(nrm2).dot(d) <= 0.0:
                    continue
                r_in.append(start)
                r_out.append(start + 1e-3 * scale + float(dist2))
            else:
                r_in.append(0.0)
                r_out.append(float(dist))
        endo.append(float(np.median(r_in)) if r_in else 0.0)
        epi.append(float(np.median(r_out)) if r_out else 0.0)
    endo, epi = np.array(endo), np.array(epi)
    endo[0] = 0.0
    epi = np.maximum(epi, endo)
    return {"apex": apex, "mitral_center": ma_c, "endo_radius": endo, "epi_radius": epi}


def papillary_proper(ob, WV: np.ndarray, WF: np.ndarray, scale: float) -> np.ndarray:
    """World vertices of the papillary muscles proper: the components that stand off the wall (their outer tenth more
    than 4 mm from it), not the trabeculae carneae, the moderator band or the muscles' roots that lie on it (the same
    selection as ``anatomy/checks/measure_model.py`` Model.aha)."""
    V = world_vertices(ob)
    _, F = mesh_arrays(ob.data)
    bvh = BVHTree.FromPolygons(WV.tolist(), WF.tolist(), all_triangles=True)
    lab = mo.vertex_components(F, len(V))
    keep = np.zeros(len(V), dtype=bool)
    for c in np.unique(lab):
        idx = np.flatnonzero(lab == c)
        if len(idx) < 30:
            continue
        d = np.array([bvh.find_nearest(Vector(V[i]))[3] for i in idx])
        if np.quantile(d, 0.9) > 4.0 * scale:
            keep[idx] = True
    return V[keep] if keep.sum() > 20 else V


def aha_segments(P: np.ndarray, *, ma_c: np.ndarray, apex: np.ndarray, pap_V: np.ndarray, lad_V: np.ndarray,
                 pda_V: np.ndarray, with_angle: bool = False, epi: np.ndarray | None = None):
    """AHA-17 segment (0 = outside the LV sampling region) and axial position t for points of the LV.

    Same construction as ``anatomy/checks/measure_model.py`` (Model.aha): rings along the mitral-centre ->
    apex axis split at the LV papillary-muscle tips / bases, sectors measured from the anterior
    interventricular groove (LAD) towards the septum (PDA side), apical cap beyond t = 0.95.
    """
    ax = apex - ma_c
    Lax = float(np.linalg.norm(ax))
    a = ax / Lax

    def radial(X):
        d = X - ma_c
        return d - np.outer(d @ a, a)

    d = pap_V - ma_c
    rho = np.linalg.norm(d - np.outer(d @ a, a), axis=1)
    lv_pap = pap_V[rho < 0.22] if (rho < 0.22).sum() > 20 else pap_V
    tp = (lv_pap - ma_c) @ a / Lax
    t_tip, t_base = float(np.quantile(tp, 0.05)), float(np.quantile(tp, 0.95))
    tl = (lad_V - ma_c) @ a / Lax
    rl = radial(lad_V)
    e1 = mo.unit(rl[np.argmin(np.abs(tl - 0.5))])
    e2 = mo.unit(np.cross(a, e1))
    if radial(pda_V).mean(axis=0) @ e2 < 0:
        e2 = -e2
    # per-t reference angle from the LAD (binned median keeps the unwrap stable on a mesh point cloud)
    bins = np.linspace(tl.min(), tl.max(), 24)
    centres, refs = [], []
    ang_l = np.arctan2(rl @ e2, rl @ e1)
    for lo, hi in zip(bins[:-1], bins[1:]):
        sel = (tl >= lo) & (tl < hi)
        if sel.sum() >= 3:
            centres.append((lo + hi) / 2)
            refs.append(float(np.angle(np.exp(1j * ang_l[sel]).mean())))
    refs = np.unwrap(np.array(refs))
    t = (P - ma_c) @ a / Lax
    rP = radial(P)
    ref = np.interp(t, centres, refs)
    th = np.degrees(np.arctan2(rP @ e2, rP @ e1) - ref) % 360
    seg = np.zeros(len(P), dtype=int)
    basal = (t >= 0) & (t < t_tip)
    mid = (t >= t_tip) & (t < t_base)
    apical = (t >= t_base) & (t <= 0.95)
    cap = t > 0.95
    sector6 = (th // 60).astype(int)
    bm_map = np.array([2, 3, 4, 5, 6, 1])
    seg[basal] = bm_map[sector6[basal]]
    seg[mid] = bm_map[sector6[mid]] + 6
    ap = np.full(len(P), 13)
    ap[(th >= 15) & (th < 105)] = 14
    ap[(th >= 105) & (th < 195)] = 15
    ap[(th >= 195) & (th < 285)] = 16
    seg[apical] = ap[apical]
    seg[cap & (t <= 1.05)] = 17
    # LV sampling region (same rule as anatomy/checks/measure_model.py lv_mask): within 1.1 x the radius of the
    # lateral epicardium (``epi``: epicardial vertices) in the same axial bin, so the right-ventricular free wall is
    # excluded. (Taking the radius over endocardial vertices too made the region narrower than the check's and gave
    # the basal anterior LV wall to the right-ventricular rule.)
    rho = np.linalg.norm(rP, axis=1)
    lateral = (th >= 180) & (th < 300)
    if epi is not None:
        lateral &= epi
    Rt = np.full(len(P), np.nan)
    edges = np.linspace(0.0, 1.0, 11)
    for lo_, hi_ in zip(edges[:-1], edges[1:]):
        sel = lateral & (t >= lo_) & (t < hi_)
        if sel.sum() > 20:
            Rt[(t >= lo_) & (t < hi_)] = np.quantile(rho[sel], 0.95) * 1.1
    Rt = np.where(np.isnan(Rt), np.nanmax(Rt) if np.isfinite(Rt).any() else np.inf, Rt)
    lv_region = (t >= 0) & (t <= 1.0) & (rho <= Rt)
    if with_angle:
        return seg, lv_region, th, t
    return seg, lv_region


def standard_blend(weights: np.ndarray, seg: np.ndarray, ventricular: np.ndarray, *, alpha: float,
                   septal: np.ndarray | None = None) -> np.ndarray:
    """Blend nearest-artery territory weights towards the AHA-17 standard map on LV myocardium.

    ``alpha`` is the weight of the standard map; the vertex's territory confidence (row sum) is kept, and
    septal segments (2, 3, 8, 9, 14) are split between LAD and RCA by the perforator proximity ``septal``
    (1 = LAD septal branches nearer) instead of the one-hot standard assignment.
    """
    conf = weights.sum(axis=1)
    std = np.zeros_like(weights)
    for s_, g in AHA_STANDARD.items():
        std[seg == s_, g] = 1.0
    if septal is not None:
        # septum: split between the LAD and RCA by which septal perforators are nearer (anterior two-thirds LAD,
        # inferior third RCA in the typical heart) instead of the one-hot segment assignment
        sep = np.isin(seg, (2, 3, 8, 9, 14))
        std[sep] = 0.0
        std[sep, 0] = septal[sep]
        std[sep, 2] = 1.0 - septal[sep]
    has_std = std.sum(axis=1) > 0
    near = np.where(conf[:, None] > 1e-6, weights / np.maximum(conf[:, None], 1e-6), 0.0)
    k = alpha * mo.smoothstep(0.0, 0.3, ventricular) * has_std
    mixed = (1.0 - k)[:, None] * near + k[:, None] * std
    mixed /= np.maximum(mixed.sum(axis=1, keepdims=True), 1e-6)
    # vertices with a standard segment but little nearest-artery confidence still get part of it
    conf_out = np.where(has_std, np.maximum(conf, alpha * ventricular), conf)
    return mixed * conf_out[:, None]


def vertex_areas(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    a = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    out = np.zeros(len(V))
    for k in range(3):
        np.add.at(out, F[:, k], a / 3.0)
    return out


def calibrate_shares(per_half: dict, target: np.ndarray, iterations: int = 14) -> list[float]:
    """Iterative proportional fitting of the LAD / LCX / RCA weights on the LV myocardium (AHA segment > 0 and
    ventricular) of both heart halves, so their area-weighted shares approach the population values (CT
    territory mass: LAD ~42.5 %, LCX ~28.8 %, RCA ~26.4 %; REFERENCE.md §5.10). Each vertex keeps its
    territory confidence (row sum); only the mix between the three arteries changes."""
    items = []
    for hV, hF, rgb, _ventricular, _qa, lv_seg in per_half.values():
        lv = lv_seg > 0
        items.append((rgb, lv, vertex_areas(hV, hF)))
    target = target / target.sum()
    for _ in range(iterations):
        tot = sum(((rgb[lv] * a[lv, None]).sum(axis=0) for rgb, lv, a in items), np.zeros(3))
        share = tot / max(tot.sum(), 1e-12)
        gain = np.clip((target / np.maximum(share, 1e-6)) ** 0.5, 0.8, 1.25)
        for rgb, lv, _a in items:
            conf = rgb[lv].sum(axis=1, keepdims=True)
            w = rgb[lv] * gain
            rgb[lv] = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-9) * conf
    tot = sum(((rgb[lv] * a[lv, None]).sum(axis=0) for rgb, lv, a in items), np.zeros(3))
    return [round(float(x), 3) for x in tot / tot.sum()]


# --------------------------------------------------------------------------------------------
# Epicardial fat
# --------------------------------------------------------------------------------------------
FAT = {
    # The fat forms the bed of the atrioventricular and interventricular grooves: along every groove artery its surface
    # rises to ``embed`` x the vessel radius above the vessel centreline (about two-thirds of each trunk is buried, its
    # crown stays exposed as a continuous ridge, REFERENCE.md 5.8); a groove vein lies half in it (``vein_embed``). The
    # bed falls off smoothly across the groove, feathering out 10-13 mm from the vessel as on an adult heart (a lean
    # 4-7 mm bed read as yellow paint along the vessels next to specimen photographs), with lobulated, lumpy fat;
    # the free walls away from the grooves stay bare. The inner surface is sunk into the myocardium, so the visible
    # margin is a thin edge.
    "embed": 0.35,
    "vein_embed": -0.1,
    "min_bed_mm": {"av": 3.0, "iv": 2.2, "branch": 1.0},   # a minimum bed thickness along each groove vessel
    "branch_min_radius_mm": 0.6,           # twigs thinner than this run on the bare epicardium (no fat net)
    "branch_prox_mm": {"default": 18.0, "AM": 40.0},   # branches keep a bed only over their proximal course
    "half_width_mm": {"av": (4.0, 13.0), "iv": (3.0, 10.0), "branch": (1.2, 5.0)},  # full height up to a, none beyond b
    "apex_thinning": 0.4,                   # interventricular fat thins towards the apex ...
    "apex_film_mm": (0.5, 12.0),            # ... which keeps a thin film (thickness, radius round the apex)
    "closing_rings": 2,                     # morphological closing of the thickness field (no bald spots inside the fat)
    "smooth_rings": 6,                      # feathering of the field over the wall mesh
    "lobule_mm": (3.2, 1.5),                # lobulation (value noise cell sizes), multiplicative amplitude and a
    "lobule_amp": (0.26, 0.14),             #   small additive bump (mm) so lobules show on thin fat too
    "lobule_bump_mm": 0.45,
    "sink_mm": 1.0,                         # inner surface depth inside the myocardium
    "remesh_mm": 0.38,
    "vessel_clear_mm": 0.8,                 # gap kept to the great vessels' walls (FAT_CLEAR_OF)
}
#: The great vessels the fat stays out of: their cut stumps show their lumens in the viewer, where fat that had grown
#: into them (the bed along the left main and the RCA runs up to their ostia on the aortic root, the AV-groove fat
#: reaches round the venae cavae) stood lit inside the dark lumen.
FAT_CLEAR_OF = ("GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "GreatVessel_SVC", "GreatVessel_IVC")


def clamp_to_vessels(V: np.ndarray, N: np.ndarray, t: np.ndarray, vessels: list, clear: float) -> np.ndarray:
    """Fat thickness ``t`` (scene units, per wall vertex) that stops ``clear`` short of the first great-vessel wall along
    the vertex normal; a wall vertex inside a vessel, or against its wall, carries none (the aortic root sits in the
    heart's base, so the wall round it lies partly inside the root)."""
    gV, gF = mo.concat([(world_vertices(v), mesh_arrays(v.data)[1]) for v in vessels])
    bvh = BVHTree.FromPolygons(gV.tolist(), gF.tolist(), all_triangles=True)
    out = t.copy()
    for i in np.nonzero(t > 0)[0]:
        p = Vector(V[i])
        loc, nrm, _, dist = bvh.find_nearest(p)
        if loc is not None and dist < 0.15 and (p - loc).dot(nrm) < clear:
            out[i] = 0.0
            continue
        hit = bvh.ray_cast(p, Vector(N[i]), float(t[i]) + clear)
        if hit[0] is not None:
            out[i] = max(0.0, hit[3] - clear)
    return out
#: Vessels that lie in a groove (and get a fat bed): arteries by code, veins by label.
FAT_GROOVE = {
    "av": {"arteries": {"LM", "pCx", "RCA"}, "veins": {"CS", "GCV", "SCV"}},
    "iv": {"arteries": {"LAD", "R-PDA"}, "veins": {"AIV", "MCV"}},
    # the proximal course of the branch arteries (and the acute marginal) gets a narrower bed; a vein alone on the free
    # wall gets none, so the right-ventricular and lateral walls are not netted with fat
    "branch": {"arteries": {"D", "D2", "OM1", "OM2", "AM", "R-PLB", "CB"}, "veins": set()},
}


def epicardial_mask(V: np.ndarray, N: np.ndarray, F: np.ndarray) -> np.ndarray:
    """True for vertices on the outer (epicardial) surface: at least two of three outward rays escape."""
    bvh = BVHTree.FromPolygons(V.tolist(), F.tolist(), all_triangles=True)
    out = np.zeros(len(V), dtype=bool)
    tilt = math.radians(25.0)
    for i, (p, n) in enumerate(zip(V, N)):
        n = Vector(n)
        t1 = n.orthogonal().normalized()
        t2 = n.cross(t1)
        o = Vector(p) + n * 1e-4
        free = 0
        for d in (n, (n * math.cos(tilt) + t1 * math.sin(tilt)), (n * math.cos(tilt) - t2 * math.sin(tilt))):
            if bvh.ray_cast(o, d, 1.5)[0] is None:
                free += 1
        out[i] = free >= 2
    return out


def value_noise(P: np.ndarray, cell: float, seed: int = 7) -> np.ndarray:
    """Smooth 3-D value noise in [0, 1] (trilinear interpolation of a hashed lattice, smoothstep weights)."""
    q = P / cell
    i0 = np.floor(q).astype(np.int64)
    f = q - i0
    w = f * f * (3 - 2 * f)
    rng = np.random.default_rng(seed)
    table = rng.random(4096)

    def h(ix, iy, iz):
        return table[(ix * 73856093 ^ iy * 19349663 ^ iz * 83492791) & 4095]
    out = np.zeros(len(P))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wt = (w[:, 0] if dx else 1 - w[:, 0]) * (w[:, 1] if dy else 1 - w[:, 1]) * (w[:, 2] if dz else 1 - w[:, 2])
                out += wt * h(i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
    return out


def groove_vessels(origin_mm: np.ndarray, scale: float) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Centreline points and radii (scene units) of the groove vessels, by groove kind (branch arteries: their
    proximal course only)."""
    out = {k: ([], []) for k in FAT_GROOVE}
    cor = json.loads((SYNTH_DIR / "coronary_centerlines.json").read_text(encoding="utf-8"))
    for node in cor["nodes"].values():
        for sg in node["segments"]:
            for kind, sel in FAT_GROOVE.items():
                if sg["code"] in sel["arteries"]:
                    P, R = np.array(sg["points_mm"]), np.array(sg["radius_mm"])
                    if kind == "branch":
                        s_ = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
                        prox = FAT["branch_prox_mm"].get(sg["code"], FAT["branch_prox_mm"]["default"])
                        keep = (R >= FAT["branch_min_radius_mm"]) & (s_ <= prox)
                        P, R = P[keep], R[keep]
                    if len(P):
                        out[kind][0].append((P - origin_mm) * scale)
                        out[kind][1].append(R * scale)
    veins = json.loads((SYNTH_DIR / "vein_centerlines.json").read_text(encoding="utf-8"))
    for sg in veins["paths"]:
        for kind, sel in FAT_GROOVE.items():
            if sg["label"] in sel["veins"] and (kind == "branch" or not sg["side"]):
                out.setdefault(kind + "_vein", ([], []))
                out[kind + "_vein"][0].append((np.array(sg["points_mm"]) - origin_mm) * scale)
                out[kind + "_vein"][1].append(np.array(sg["radius_mm"]) * scale)
    return {k: (np.concatenate(v[0]), np.concatenate(v[1])) for k, v in out.items() if v[0]}


def _vertex_neighbors(F: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    e = mo.unique_edges(F)
    return np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]])


def _graph_max(t: np.ndarray, src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    out = t.copy()
    np.maximum.at(out, dst, t[src])
    return out


def _graph_min(t: np.ndarray, src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    out = t.copy()
    np.minimum.at(out, dst, t[src])
    return out


def _graph_smooth(t: np.ndarray, src: np.ndarray, dst: np.ndarray, n: int, iterations: int) -> np.ndarray:
    deg = np.maximum(np.bincount(dst, minlength=n), 1).astype(float)
    for _ in range(iterations):
        t = 0.5 * t + 0.5 * np.bincount(dst, weights=t[src], minlength=n) / deg
    return t


def fat_thickness(V: np.ndarray, *, epi: np.ndarray, vessels: dict, base: np.ndarray, apex: np.ndarray, scale: float,
                  wall_sd, F: np.ndarray | None = None, sees=None, space: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Per-vertex fat thickness (scene units) and the mask of wall vertices that carry fat.

    A groove bed whose surface reaches ``embed`` x r above each groove vessel's centreline, falling off smoothly across
    the groove; thinning towards the apex, which keeps a thin film; lobulated (value noise, 3 and 1.5 mm lobules). The
    field is closed morphologically (no bald spot inside the fat: those showed as dark pits) and feathered over the
    wall mesh; finally it is capped at every groove vessel's crown, so each trunk runs as one continuous exposed ridge
    instead of dipping in and out of the fat (dashes).

    Fat lies on epicardial vertices (``epi``) and also in the depth of the grooves, whose outward rays hit an overhang
    (the auricles over the AV grooves, the ventricles either side of the interventricular grooves) so they fail the
    epicardial test although that is where the fat is thickest: a non-epicardial vertex takes a vessel's bed when the
    vessel lies in front of it with a clear line of sight (``sees(i, point)``; an endocardial vertex never sees an
    epicardial vessel), and its fat is limited to 80 % of the free space along its normal (``space``)."""
    axis = apex - base
    t_ax = np.clip((V - base) @ axis / (axis @ axis), 0.0, 1.0)
    t = np.zeros(len(V))
    carries = np.asarray(epi, float) > 0
    caps = []
    for kind_key, (P, R) in vessels.items():
        kind = kind_key.removesuffix("_vein")
        embed = FAT["vein_embed"] if kind_key.endswith("_vein") else FAT["embed"]
        tree = _kdtree(P)
        h_ax = wall_sd(P)
        h_v = h_ax + embed * R  # fat surface height above the wall at each vessel point
        h_v = np.maximum(h_v, FAT["min_bed_mm"].get(kind, 0.0) * scale)
        caps.append((tree, h_ax + embed * R, R))
        a, b = (x * scale for x in FAT["half_width_mm"][kind])
        for i, p in enumerate(V):
            groove_only = not epi[i]
            if groove_only and sees is None:
                continue
            best = 0.0
            for _, j, d in tree.find_n(p, 8):
                lat = max(0.0, d - h_v[j])  # distance beyond the vessel's footprint on the wall
                if lat >= b:
                    continue
                w = 1.0 - mo.smoothstep(a, b, np.array([lat]))[0]
                if h_v[j] * w <= best or (groove_only and not sees(i, P[j])):
                    continue
                best = float(h_v[j] * w)
            if best > 0.0 and groove_only:
                carries[i] = True
            t[i] = max(t[i], best)
    t *= 1.0 - FAT["apex_thinning"] * mo.smoothstep(0.7, 1.0, t_ax)
    film, r_film = FAT["apex_film_mm"][0] * scale, FAT["apex_film_mm"][1] * scale
    t = np.maximum(t, film * (1.0 - mo.smoothstep(0.5 * r_film, r_film, np.linalg.norm(V - apex, axis=1))))
    if F is not None:
        src, dst = _vertex_neighbors(F, len(V))
        for _ in range(FAT["closing_rings"]):
            t = _graph_max(t, src, dst)
        for _ in range(FAT["closing_rings"]):
            t = _graph_min(t, src, dst)
        t = _graph_smooth(t, src, dst, len(V), FAT["smooth_rings"])
    c1, c2 = FAT["lobule_mm"]
    a1, a2 = FAT["lobule_amp"]
    n1 = value_noise(V, c1 * scale)
    n2 = value_noise(V, c2 * scale, seed=11)
    # lobules show where the fat is thick; its thin margin is not modulated, so the outline stays a soft, smooth edge
    # instead of a ragged, map-like one
    covered = mo.smoothstep(0.6 * scale, 2.0 * scale, t)
    lob = 1.0 + (a1 * (2 * n1 - 1) + a2 * (2 * n2 - 1)) * covered
    t = t * lob + FAT["lobule_bump_mm"] * scale * (n1 - 0.5) * covered
    for tree, h_c, R in caps:  # no lobule rises over a groove vessel's crown
        for i in np.nonzero(t > 0)[0]:
            _, j, d = tree.find(Vector(V[i]))
            if d < R[j] * 1.1 + 0.8 * scale:
                t[i] = min(t[i], max(h_c[j], 0.0))
    if space is not None:  # never through an overhang
        t = np.minimum(t, 0.8 * space)
    return np.maximum(t, 0.0) * carries, carries


def build_fat_shell(V: np.ndarray, F: np.ndarray, N: np.ndarray, t: np.ndarray, scale: float) -> mo.Mesh:
    """Closed shell: the epicardial faces with fat, offset outward by ``t`` and sunk below by FAT['sink_mm']
    (the rim of the shell lies inside the myocardium, so the visible margin is feathered)."""
    region = (t[F] > 0.05 * scale).any(axis=1)
    Fr = F[region]
    used = np.unique(Fr)
    remap = -np.ones(len(V), dtype=np.int64)
    remap[used] = np.arange(len(used))
    Fr = remap[Fr]
    Vo = V[used] + N[used] * t[used, None]
    Vi = V[used] - N[used] * FAT["sink_mm"] * scale
    n = len(used)
    faces = [Fr, Fr[:, ::-1] + n]
    # stitch the boundary loops (edges used by one region face)
    e = np.concatenate([Fr[:, [0, 1]], Fr[:, [1, 2]], Fr[:, [2, 0]]])
    key = np.sort(e, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    b = e[cnt[inv.ravel()] == 1]
    faces.append(np.column_stack([b[:, 1], b[:, 0], b[:, 0] + n]))
    faces.append(np.column_stack([b[:, 1], b[:, 0] + n, b[:, 1] + n]))
    return np.vstack([Vo, Vi]), np.vstack(faces)


def make_epicardial_fat(wall, objects, fat_specs, base, apex, plane_co, plane_no, scale, flat_faces, node_stats, origin_mm) -> dict:
    """Epicardial fat on the (decimated, smoothed) heart wall, split into the two heart halves: the bed of the
    atrioventricular and interventricular grooves around the synthesised coronary arteries and cardiac veins
    (``anatomy/build/synth/*_centerlines.json``)."""
    me = wall.data
    V, F = mesh_arrays(me)
    N = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("normal", N)
    N = N.reshape(-1, 3).astype(np.float64)
    epi = epicardial_mask(V, N, F)
    bvh = BVHTree.FromPolygons(V.tolist(), F.tolist(), all_triangles=True)

    def wall_sd(P):
        out = np.empty(len(P))
        for i, p in enumerate(P):
            loc, nrm, _, dist = bvh.find_nearest(Vector(p))
            out[i] = dist if (Vector(p) - loc).dot(nrm) >= 0 else -dist
        return out

    # free space along each non-epicardial vertex's normal (to an overhang, or across a cavity), and line of sight
    # from a vertex to a vessel point: the fat fills the depth of a groove up to its overhang, never an endocardium
    space = np.full(len(V), np.inf)
    for i in np.flatnonzero(~epi):
        hit = bvh.ray_cast(Vector(V[i]) + Vector(N[i]) * 1e-4, Vector(N[i]), 0.5)
        if hit[0] is not None:
            space[i] = hit[3]

    # a groove vertex under an overhang lies beside the epicardium (on the groove's walls and bottom) and its normal
    # meets the overhang within a centimetre or so; an endocardial vertex looks across a cavity, and near a valve
    # orifice (an opening in the wall mesh) it could otherwise "see" a groove vessel through the opening
    epi_tree = KDTree(int(epi.sum()))
    for k, i in enumerate(np.flatnonzero(epi)):
        epi_tree.insert(Vector(V[i]), k)
    epi_tree.balance()
    groove_ok = np.zeros(len(V), dtype=bool)
    for i in np.flatnonzero(~epi):
        if 0.6 * scale <= space[i] <= 12.0 * scale:  # room for fat, and an overhang (not a cavity) above it
            groove_ok[i] = epi_tree.find(Vector(V[i]))[2] <= 2.5 * scale

    def sees(i, q):
        if not groove_ok[i]:
            return False
        o = Vector(V[i]) + Vector(N[i]) * 1e-4
        d = Vector(q) - o
        if d.dot(Vector(N[i])) <= 0.0:  # the vessel lies behind the surface
            return False
        hit = bvh.ray_cast(o, d.normalized(), d.length)
        return hit[0] is None

    vessels = groove_vessels(origin_mm, scale)
    t, carries = fat_thickness(V, epi=epi.astype(float), vessels=vessels, base=base, apex=apex, scale=scale, wall_sd=wall_sd,
                               F=F, sees=sees, space=space)
    log(f"  epicardial fat: {int(epi.sum())} epicardial vertices, {int((carries & ~epi).sum())} groove vertices under an overhang carry fat")
    great = [objects[n] for n in FAT_CLEAR_OF if n in objects]
    if great:
        t0 = t
        t = clamp_to_vessels(V, N, t, great, FAT["vessel_clear_mm"] * scale)
        log(f"  epicardial fat: {int(((t0 > 0) & (t < t0 - 1e-9)).sum())} groove vertices stop short of a great vessel")
    FV, FF = build_fat_shell(V, F, N, t, scale)
    fat = new_object("EpicardialFat", new_mesh("EpicardialFat", FV, FF))
    remesh_seamless(fat, FAT["remesh_mm"] * scale)
    # the voxel union can enclose small voids between the shell and the wall: drop inward-facing pockets and crumbs
    RV, RF = mesh_arrays(fat.data)
    (RV, RF), _ = mo.filter_components(RV, RF, min_fraction=0.004, min_faces=60, drop_inverted=True)
    old_me = fat.data
    fat.data = new_mesh("EpicardialFat", RV, RF)
    bpy.data.meshes.remove(old_me)
    taubin_object(fat, 6)
    budget = sum(s.budget for s in fat_specs)
    src = tri_count(fat)
    decimate_to(fat, budget)
    reorient_after_decimation(fat)
    taubin_object(fat, 2)
    if great:  # what the voxel union and the smoothing still bulge into a vessel, before the split (one seam)
        clear_info = push_out(fat, great, FAT["vessel_clear_mm"] * scale, passes=12, depth=0.03, two_sided=False)
        log(f"  epicardial fat clear of the great vessels: {clear_info}")
    # genus of the fat shell (handles = tunnels through it, which read as dark pits): report it
    FV2, FF2 = mesh_arrays(fat.data)
    e2 = mo.unique_edges(FF2)
    n_comp = len(np.unique(mo.vertex_components(FF2, len(FV2))))
    genus = int(round((2 * n_comp - (len(FV2) - len(e2) + len(FF2))) / 2))
    names = {s.raw["fat_side"]: s.node for s in fat_specs}
    halves = split_closed(fat, plane_co, plane_no, names)
    bpy.data.meshes.remove(fat.data)
    for side, (ob, caps) in halves.items():
        objects[names[side]] = ob
        flat_faces[names[side]] = caps
        node_stats[names[side]] = {"triangles_source": src, "cap_triangles": len(caps)}
    thick = t[t > 0.2 * scale] / scale
    vol = float(np.abs(mo.signed_volume(RV, RF))) / scale ** 3 / 1000.0
    return {"epicardial_vertex_fraction": round(float(epi.mean()), 3), "groove_vertices": int((carries & ~epi).sum()),
            "fat_vertices": int((t > 0.2 * scale).sum()),
            "thickness_mm_p50_p90_max": [round(float(np.percentile(thick, 50)), 1), round(float(np.percentile(thick, 90)), 1), round(float(thick.max()), 1)] if len(thick) else [],
            "volume_ml": round(vol, 1), "shell_triangles": src, "components": n_comp, "genus": genus}


def split_closed(ob: bpy.types.Object, plane_co, plane_no, names: dict[str, str]) -> dict[str, tuple[bpy.types.Object, set[int]]]:
    """Cut a closed mesh with the heart plane into anterior / posterior capped halves (see split_heart)."""
    out = {}
    for side, clear_outer in (("anterior", False), ("posterior", True)):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm_bisect(bm, plane_co, plane_no, clear_outer=clear_outer, clear_inner=not clear_outer, cap=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(names[side])
        bm.to_mesh(me)
        bm.free()
        me.validate(verbose=False, clean_customdata=False)
        V, _ = mesh_arrays(me)
        on_plane = np.abs((V - plane_co) @ plane_no) < 1e-5
        tris = np.empty(len(me.polygons) * 3, dtype=np.int32)
        me.polygons.foreach_get("vertices", tris)
        tris = tris.reshape(-1, 3)
        is_cap = on_plane[tris].all(axis=1)
        me.edges.foreach_set("use_edge_sharp", rim_edge_mask(me, tris, is_cap))
        ob_half = new_object(names[side], me)
        out[side] = (ob_half, set(np.nonzero(is_cap)[0].tolist()))
    return out


# --------------------------------------------------------------------------------------------
# Collisions: display-only neighbours yield to the structures they touch
# --------------------------------------------------------------------------------------------
def mesh_edges(F: np.ndarray) -> np.ndarray:
    return mo.unique_edges(F)


def push_out(yielder: bpy.types.Object, masters: list[bpy.types.Object], margin: float, *, spread: int = 10,
             mask=None, passes: int = 6, reach: float = 0.011, depth: float = 0.05, two_sided: bool = True) -> dict:
    """Make ``yielder`` give way to ``masters`` (display-only neighbours yield to the structures they touch).

    Two-sided test, because the yielder can be much coarser than the master (a lung triangle may cut through a
    10 mm vein without any lung vertex inside it):

    * yielder vertices inside (or closer than ``margin`` to) a master move out along the master's normal;
    * master vertices inside the yielder pull the yielder surface around them inward (along the yielder's
      normal) by their depth + ``margin``, with a quadratic falloff over ``reach``.

    The displacement field is spread over the yielder's mesh so each dent stays smooth. ``mask(V_world) ->
    bool`` limits which yielder vertices may move; only points within ``depth`` of the other surface count.
    ``two_sided=False`` skips the second test (a master that passes right through the yielder, a vena cava through the
    fat over its mouth, cannot be cleared by a dent). Returns the deepest penetration found before the first pass and
    the deepest one left after the last.
    """
    me = yielder.data
    V, F = mesh_arrays(me)
    M = np.array(yielder.matrix_world)
    Vw = V @ M[:3, :3].T + M[:3, 3]
    movable = np.ones(len(V), dtype=bool) if mask is None else mask(Vw)
    e = mesh_edges(F)
    deg = np.bincount(e.ravel(), minlength=len(V)).astype(float)
    deg[deg == 0] = 1.0
    trees, master_pts = [], []
    for m in masters:
        mV = world_vertices(m)
        _, mF = mesh_arrays(m.data)
        trees.append((BVHTree.FromPolygons(mV.tolist(), mF.tolist(), all_triangles=True), mV.min(axis=0) - 3 * margin - 0.01, mV.max(axis=0) + 3 * margin + 0.01))
        master_pts.append(mV)
    master_pts = np.concatenate(master_pts) if master_pts else np.zeros((0, 3))
    first_depth = None
    last_depth = 0.0
    it = 0
    for it in range(passes):
        need = np.zeros_like(Vw)
        mag = np.zeros(len(Vw))
        worst = 0.0
        # (a) yielder vertices inside a master
        for bvh, lo, hi in trees:
            cand = np.nonzero(movable & np.all((Vw >= lo) & (Vw <= hi), axis=1))[0]
            for i in cand:
                loc, nrm, _, dist = bvh.find_nearest(Vector(Vw[i]))
                if loc is None:
                    continue
                s_ = (Vector(Vw[i]) - loc).dot(nrm)
                if s_ < margin and dist < depth:
                    m_ = margin - s_
                    worst = max(worst, -s_)
                    if m_ > mag[i]:
                        mag[i] = m_
                        need[i] = np.array(nrm) * m_
        # (b) master vertices inside the yielder
        ybvh = BVHTree.FromPolygons(Vw.tolist(), F.tolist(), all_triangles=True)
        lo, hi = Vw.min(axis=0) - margin, Vw.max(axis=0) + margin
        cand = master_pts[np.all((master_pts >= lo) & (master_pts <= hi), axis=1)] if two_sided else master_pts[:0]
        pen_loc, pen_vec = [], []
        for q in cand:
            loc, nrm, _, dist = ybvh.find_nearest(Vector(q))
            if loc is None or dist > depth:
                continue
            s_ = (Vector(q) - loc).dot(nrm)
            if s_ < margin:
                worst = max(worst, -s_)
                pen_loc.append(np.array(loc))
                pen_vec.append(-np.array(nrm) * (margin - s_))
        if pen_loc:
            kd = _kdtree(np.array(pen_loc))
            pv = np.array(pen_vec)
            plo = np.min(pen_loc, axis=0) - reach
            phi = np.max(pen_loc, axis=0) + reach
            for i in np.nonzero(movable & np.all((Vw >= plo) & (Vw <= phi), axis=1))[0]:
                for _co, j, d in kd.find_range(Vector(Vw[i]), reach):
                    w = (1.0 - d / reach) ** 1.5
                    cand_v = pv[j] * w
                    m_ = float(np.linalg.norm(cand_v))
                    if m_ > mag[i]:
                        mag[i] = m_
                        need[i] = cand_v
        if first_depth is None:
            first_depth = worst
        last_depth = worst
        if not (mag > 1e-6).any():
            break
        disp = need.copy()
        hit = mag > 1e-6
        for _ in range(spread):
            acc = np.zeros_like(disp)
            for k in range(3):
                acc[:, k] = np.bincount(e[:, 0], weights=disp[e[:, 1], k], minlength=len(V)) + np.bincount(e[:, 1], weights=disp[e[:, 0], k], minlength=len(V))
            avg = acc / deg[:, None]
            disp = 0.5 * disp + 0.5 * avg
            disp[hit] = np.where((np.linalg.norm(disp[hit], axis=1) < mag[hit])[:, None], need[hit], disp[hit])
        disp[~movable] = 0.0
        Vw = Vw + disp
    Minv = np.linalg.inv(M)
    Vl = Vw @ Minv[:3, :3].T + Minv[:3, 3]
    me.vertices.foreach_set("co", Vl.astype(np.float32).ravel())
    me.update()
    return {"max_penetration_before_mm": round((first_depth or 0.0) / 0.01, 2),
            "max_penetration_last_pass_mm": round(last_depth / 0.01, 2), "passes": it + 1}


def trim_inside(ob: bpy.types.Object, host: bpy.types.Object, margin: float, depth: float = 0.08) -> dict:
    """Trim what of ``ob`` lies inside ``host``: a coronary artery starts at its ostium on the aortic root, so its
    first millimetres (a tube centred on the sinus wall) stood in the aortic lumen as a stub, lit inside the dark
    lumen. Faces wholly inside (or within ``margin`` of the wall) go; a vertex of a kept face left there moves onto the
    wall + ``margin``, so the artery starts flush on the host's outer surface; the cut end is capped there."""
    hV = world_vertices(host)
    _, hF = mesh_arrays(host.data)
    bvh = BVHTree.FromPolygons(hV.tolist(), hF.tolist(), all_triangles=True)
    M = np.array(ob.matrix_world)
    Minv = np.linalg.inv(M)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    inside = np.zeros(len(bm.verts), dtype=bool)
    target = {}
    for v in bm.verts:
        p = Vector((M @ np.array([*v.co, 1.0]))[:3])
        loc, nrm, _, dist = bvh.find_nearest(p)
        if loc is None or dist > depth:
            continue
        if (p - loc).dot(nrm) < margin:
            inside[v.index] = True
            target[v.index] = loc + nrm * margin
    drop = [f for f in bm.faces if all(inside[v.index] for v in f.verts)]
    moved = 0
    for f in bm.faces:
        if f in drop:
            continue
        for v in f.verts:
            if inside[v.index] and v.index in target:
                v.co = Vector((Minv @ np.array([*target.pop(v.index), 1.0]))[:3])
                moved += 1
    before = len(bm.faces)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    after = len(bm.faces)
    # close the cut end again (it lies on the wall, under the artery): the lung carve and the centreline stage take
    # closed vessels
    filled = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)["faces"]
    bmesh.ops.triangulate(bm, faces=filled)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return {"faces_trimmed": before - after, "vertices_moved_to_wall": moved, "cap_faces": len(filled)}


def resolve_collisions(rules: list[dict], objects: dict, *, base: np.ndarray, walls: list, scale: float) -> dict:
    """Apply the config's collision rules in order: a ``yielder`` gives way to its ``masters`` (push_out, with optional
    ``passes``, ``depth_mm``, ``reach_mm`` and ``two_sided``), or a ``trim`` node loses what lies inside its ``host``
    (trim_inside)."""
    out = {}
    for rule in rules:
        if "trim" in rule:
            if rule["trim"] in objects and rule["host"] in objects:
                out[f"{rule['trim']} trimmed by {rule['host']}"] = trim_inside(
                    objects[rule["trim"]], objects[rule["host"]], rule["margin_mm"] * scale)
            continue
        if "yielder" not in rule or rule["yielder"] not in objects:
            continue
        masters = [objects[m] for m in rule["masters"] if m in objects]
        mask = None
        if rule.get("mask") == "descending_aorta":
            def mask(Vw, _b=base):  # posterior, below the arch: the descending limb only (never the root, which
                # sits in the outflow tract since the synthesis moved it to the anterior mitral hinge)
                return (Vw[:, 1] > _b[1] + 0.35) & (Vw[:, 2] < _b[2] + 0.25)
        elif rule.get("mask") == "viewer_stump":
            # the part of a great vessel the viewer keeps (inside its great-vessel clip sphere, and of the aorta not
            # the descending limb or what lies below the AV plane, rig.ts DESCENDING_AORTA): never the arch or the
            # descending aorta it cuts away, which lie against the spine and the lower-lobe arteries
            clip_c_ = np.asarray(VIEWER_GREAT_VESSEL_CLIP[0], float) @ mo.BLENDER_TO_GLTF
            behind_, above_, floor_ = VIEWER_DESCENDING_AORTA

            def mask(Vw, _c=clip_c_, _r=VIEWER_GREAT_VESSEL_CLIP[1] + 0.05, _b=base):
                up, behind = Vw[:, 2] - _b[2], Vw[:, 1] - _b[1]  # Blender: +Z superior, +Y posterior
                kept = (up >= floor_) & ((behind <= behind_) | (up >= above_))
                return kept & (np.linalg.norm(Vw - _c, axis=1) < _r)
        elif rule.get("mask") == "away_from_heart":
            # the intrapulmonary branches (lingular and lower-lobe veins lie against the heart), never the ostia
            walls_ = np.concatenate([world_vertices(w) for w in walls])

            def mask(Vw, _w=walls_, _r=rule.get("mask_mm", 30.0) * scale):
                d_ = nearest_distance(Vw, _w)
                touch = Vw[d_ < 1.5 * scale]
                return nearest_distance(Vw, touch) > _r if len(touch) else np.ones(len(Vw), dtype=bool)
        kw = {k: rule[f"{k}_mm"] * scale for k in ("depth", "reach") if f"{k}_mm" in rule}
        if "passes" in rule:
            kw["passes"] = int(rule["passes"])
        if "two_sided" in rule:
            kw["two_sided"] = bool(rule["two_sided"])
        out[rule["yielder"] + " <- " + ",".join(rule["masters"])] = push_out(
            objects[rule["yielder"]], masters, rule["margin_mm"] * scale, mask=mask, **kw)
    return out


# --------------------------------------------------------------------------------------------
# Pulmonary vessel distance attributes (_DIST_HEART, _DIST_HILUM)
# --------------------------------------------------------------------------------------------
def geodesic(V: np.ndarray, F: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """Dijkstra distance along mesh edges from a set of seed vertices."""
    import heapq

    e = mesh_edges(F)
    w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    adj: list[list[tuple[int, float]]] = [[] for _ in range(len(V))]
    for (a, b), l in zip(e.tolist(), w.tolist()):
        adj[a].append((b, l))
        adj[b].append((a, l))
    dist = np.full(len(V), np.inf)
    heap = []
    for s in np.nonzero(seeds)[0].tolist():
        dist[s] = 0.0
        heap.append((0.0, s))
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, l in adj[u]:
            nd = d + l
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist


def inside_mesh(P: np.ndarray, ob: bpy.types.Object) -> np.ndarray:
    V = world_vertices(ob)
    _, F = mesh_arrays(ob.data)
    bvh = BVHTree.FromPolygons(V.tolist(), F.tolist(), all_triangles=True)
    lo, hi = V.min(axis=0), V.max(axis=0)
    out = np.zeros(len(P), dtype=bool)
    for i, p in enumerate(P):
        if not np.all((p >= lo) & (p <= hi)):
            continue
        loc, nrm, _, _ = bvh.find_nearest(Vector(p))
        out[i] = loc is not None and (Vector(p) - loc).dot(nrm) < 0
    return out


def set_float_attribute(ob: bpy.types.Object, name: str, values: np.ndarray) -> None:
    me = ob.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    attr = me.attributes.new(name=name, type="FLOAT", domain="POINT")
    attr.data.foreach_set("value", np.asarray(values, dtype=np.float32))


#: The structures that carry `_ENCLOSURE`: the walls, what lies in the chambers, and what lies on the heart and
#: reaches into a chamber or a great-vessel stump (the fat at the aortic root, the coronary sinus' mouth). Not the
#: coronary arteries: the left main and the RCA lie deep in their crevices and grooves, and their risk colour must
#: read there.
ENCLOSED_NODES = ("Heart_Wall_Anterior", "Heart_Wall_Posterior", "Papillary_Muscles", "Valve_Mitral", "Valve_Tricuspid",
                  "Valve_Aortic", "Valve_Pulmonary", "EpicardialFat_Anterior", "EpicardialFat_Posterior", "CardiacVeins")
#: A coronary within the first distance of a great-vessel stump's wall gets no display inflation or depth pull, full
#: from the second (mm; `_PULL`, the viewer's tissue.ts VESSEL_DEPTH_PULL is 3 mm).
CORONARY_PULL_CLEAR_MM = (3.5, 6.0)
#: Rays per vertex and their reach (mm).
ENCLOSURE_RAYS, ENCLOSURE_REACH_MM = 24, 80.0
#: The viewer's great-vessel clip (frontend/src/three/anatomy/rig.ts GREAT_VESSEL_CLIP): centre (glTF frame) and the
#: radius where its cut lies (radius - feather / 2), scene units.
VIEWER_GREAT_VESSEL_CLIP = ((0.0, 0.05, -0.05), 0.8 - 0.24 / 2)
#: The viewer's cut of the descending aorta (rig.ts DESCENDING_AORTA: behind, cutAbove, floor; glTF frame from the
#: base centre) and of the pulmonary trunk (tissue.ts ALONG_FADE midpoint, distance from its cardiac end).
VIEWER_DESCENDING_AORTA = (0.4, 0.95, 0.0)
VIEWER_PULMONARY_CUT = 0.20
#: The viewer's straightened cut (rig.ts VESSEL_CUT_ROOT, VESSEL_CUT_AXIS, VESSEL_CUT_MARGIN; scene units).
VIEWER_VESSEL_CUT = {"root": 0.015, "axis": (0.135, 0.27), "margin": 0.1}


def straight_cut_distance(V: np.ndarray, F: np.ndarray, along: np.ndarray) -> np.ndarray:
    """The viewer's straightened cut distance (frontend vesselCuts.ts ``straightCutDistance``): per connected piece,
    the distance past its root along the direction to its centroid a short way along it, or ``along`` less a margin
    where that is larger. Computed here on the trunk's shape from before its collision dents (``_DIST_CUT``): the
    viewer, straightening on the dented positions, cut a slot down the wall pushed off the aorta."""
    root_band, (a0, a1), margin = VIEWER_VESSEL_CUT["root"], VIEWER_VESSEL_CUT["axis"], VIEWER_VESSEL_CUT["margin"]
    along = np.asarray(along, dtype=float)
    comp = mo.vertex_components(F, len(V))
    out = along.copy()
    for c in np.unique(comp):
        m = comp == c
        r = m & (along < root_band)
        a = m & (along >= a0) & (along <= a1)
        if not r.any() or not a.any():
            continue
        o = V[r].mean(axis=0)
        d = V[a].mean(axis=0) - o
        n = float(np.linalg.norm(d))
        if n < 1e-9:
            continue
        out[m] = np.maximum((V[m] - o) @ (d / n), along[m] - margin)
    return out


def cut_caps(V: np.ndarray, F: np.ndarray, keep: np.ndarray, near=None) -> tuple[np.ndarray, np.ndarray]:
    """The kept faces of a vessel plus fan triangles closing every loop where ``keep`` cuts it (the edges of the kept
    faces that the whole mesh does not end on), each round its loop's centroid; ``near(centroid) -> bool`` picks the
    loops to close. Returns (vertices + centroids, kept faces + caps)."""
    def open_edges(faces):
        e = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
        u, c = np.unique(e, axis=0, return_counts=True)
        return {tuple(x) for x in u[c == 1].tolist()}

    cut = sorted(open_edges(F[keep]) - open_edges(F))
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in cut:
        parent[find(a)] = find(b)
    loops: dict[int, list[tuple[int, int]]] = {}
    for a, b in cut:
        loops.setdefault(find(a), []).append((a, b))
    # orient each cap like the kept faces it closes (the winding does not matter to the ray casts, only coverage)
    extra_V, extra_F = [], []
    for edges in loops.values():
        if len(edges) < 3:
            continue
        idx = np.unique(np.array(edges))
        c = V[idx].mean(axis=0)
        if near is not None and not near(c):
            continue
        k = len(V) + len(extra_V)
        extra_V.append(c)
        extra_F.extend([a, b, k] for a, b in edges)
    if not extra_V:
        return V, F[keep]
    return np.vstack([V, np.array(extra_V)]), np.vstack([F[keep], np.array(extra_F, dtype=np.int64)])


def _hemisphere_dirs(n: int) -> np.ndarray:
    """``n`` cosine-weighted directions over the +Z hemisphere (Fibonacci spiral)."""
    k = np.arange(n) + 0.5
    r = np.sqrt(k / n)
    phi = k * math.pi * (3.0 - math.sqrt(5.0))
    return np.column_stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1.0 - r * r)])


def enclosure_attribute(ob: bpy.types.Object, bvh: BVHTree, scale: float) -> np.ndarray:
    """_ENCLOSURE: the share of a vertex's (cosine-weighted) sky that the closed heart hides, 0 out in the open to 1
    deep in a chamber. Light does not reach the inside of a closed heart: the viewer darkens what lies in its
    chambers while the heart is closed (looking down a cut vena cava or the aorta showed the atrium and the
    ventricle as brightly lit as the outside) and lifts it as the heart opens."""
    V = world_vertices(ob)
    N = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
    ob.data.vertices.foreach_get("normal", N)
    M = np.array(ob.matrix_world)[:3, :3]
    N = N.reshape(-1, 3).astype(np.float64) @ M.T
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    local = _hemisphere_dirs(ENCLOSURE_RAYS)
    reach = ENCLOSURE_REACH_MM * scale
    lift = 0.3 * scale
    out = np.zeros(len(V), dtype=np.float32)
    for i in range(len(V)):
        n = N[i]
        t = np.cross(n, (0.0, 0.0, 1.0) if abs(n[2]) < 0.9 else (1.0, 0.0, 0.0))
        t /= np.linalg.norm(t)
        b = np.cross(n, t)
        o = Vector(V[i] + n * lift)
        hits = 0
        for d in local[:, :1] * t + local[:, 1:2] * b + local[:, 2:3] * n:
            if bvh.ray_cast(o, Vector(d), reach)[0] is not None:
                hits += 1
        out[i] = hits / ENCLOSURE_RAYS
    return out


def pulmonary_attributes(ob: bpy.types.Object, seeds_world_fn, lungs: list[bpy.types.Object],
                         rest_V: np.ndarray | None = None) -> dict:
    """_DIST_HEART: geodesic distance (scene units) along the vessel from its cardiac end.
    _DIST_HILUM: signed geodesic distance from where the vessel enters a lung (< 0 outside the lungs, towards
    the heart; > 0 inside, into the lung) — lets the viewer keep the proximal vessels and fade the
    intrapulmonary tree. ``rest_V`` (local vertices, same topology): measure along the vessel as it was before the
    collisions dented it, so a dent does not stretch the distances (the viewer cuts at a fixed distance)."""
    V, F = mesh_arrays(ob.data)
    if rest_V is not None and len(rest_V) == len(V):
        V = rest_V
    Vw = world_vertices(ob)
    seeds = seeds_world_fn(Vw)
    d_heart = geodesic(V, F, seeds)
    in_lung = np.zeros(len(V), dtype=bool)
    for lung in lungs:
        in_lung |= inside_mesh(Vw, lung)
    d_to_out = geodesic(V, F, ~in_lung) if (~in_lung).any() else np.zeros(len(V))
    d_to_in = geodesic(V, F, in_lung) if in_lung.any() else np.full(len(V), np.inf)
    hilum = np.where(in_lung, d_to_out, -d_to_in)
    finite = np.isfinite(d_heart)
    d_heart = np.where(finite, d_heart, d_heart[finite].max() if finite.any() else 0.0)
    hilum = np.where(np.isfinite(hilum), hilum, -1.0)
    set_float_attribute(ob, "_DIST_HEART", d_heart)
    set_float_attribute(ob, "_DIST_HILUM", hilum)
    return {"seed_vertices": int(seeds.sum()), "in_lung_fraction": round(float(in_lung.mean()), 3),
            "dist_heart_max": round(float(d_heart.max()), 4), "dist_hilum_range": [round(float(hilum.min()), 4), round(float(hilum.max()), 4)]}


# --------------------------------------------------------------------------------------------
# UVs
# --------------------------------------------------------------------------------------------
def uv_unwrap(ob: bpy.types.Object, *, angle_deg: float = 66.0, margin: float = 0.004) -> None:
    """Smart UV projection (deterministic) for the baked PBR textures (CONTRACTS §7.1)."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    # denser packing (concave shapes, rotation): smart projection alone uses 27-47 % of the texture
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.select_set(False)


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
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_vertex_color="NAME", export_vertex_color_name="Territory", export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_attributes=True, export_extras=True,
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
    # the frame origin is always the BodyParts3D heart-wall bbox centre (the synthesised wall only differs locally)
    hV, _ = cache.get(cfg["frame"].get("origin_part", heart_part))
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
        if spec.raw.get("split") or spec.raw.get("generate"):
            continue
        parts = [cache.get(pid) for pid in spec.parts]
        smoothing = spec.raw.get("taubin", {})
        crop = spec.raw.get("crop")
        if crop:
            # Crop each closed part on its own: a single cut loop per part caps cleanly, whereas the
            # overlapping loops of touching parts (e.g. the two heads of pectoralis) do not.
            parts = [CROPS[crop["type"]](V, F, crops) for V, F in parts]
        V, F = mo.concat(parts)
        if spec.raw.get("translate_mm"):  # documented rigid position fix (source frame, mm)
            V = V + np.array(spec.raw["translate_mm"], dtype=float)
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
        protect = None
        dense = spec.raw.get("dense_near")
        if dense:
            Vw = world_vertices(ob)
            ref = to_scene(cache.get(dense["part"])[0]).mean(axis=0)
            d = np.linalg.norm(Vw - ref, axis=1)
            protect = 1.0 - mo.smoothstep(0.6 * dense["radius_mm"] * scale, dense["radius_mm"] * scale, d)
        decimate_to(ob, spec.budget, protect, dense.get("factor", 0.85) if dense else 0.85)
        if spec.raw.get("remesh_mm"):
            dropped = drop_loose_fragments(ob)
            if dropped:
                log(f"  {spec.node}: dropped {dropped} triangles of loose remesh fragments")
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
    _wV, _wF = mesh_arrays(wall.data)
    _wN = np.empty(len(wall.data.vertices) * 3, dtype=np.float32)
    wall.data.vertices.foreach_get("normal", _wN)
    wall_epi = epicardial_mask(_wV, _wN.reshape(-1, 3).astype(np.float64), _wF)
    log(f"epicardial vertices: {wall_epi.mean():.0%} of the wall")
    finite = wall_thick[np.isfinite(wall_thick)] / scale
    log(f"wall thickness (mm): p10 {np.percentile(finite, 10):.1f}  median {np.median(finite):.1f}  p90 {np.percentile(finite, 90):.1f}")
    valve_V = to_scene(mo.concat([cache.get(p) for p in ("FMA7235", "FMA7234")])[0])
    base, apex, axis = mo.heart_long_axis(world_vertices(wall), valve_V)
    plane_co, plane_no = mo.heart_cut_plane(base, apex, ANTERIOR)
    log(f"heart long axis {np.round(axis, 3).tolist()}, cut normal {np.round(plane_no, 3).tolist()}")
    lv = lv_cavity_profile(wall_V, _wF, to_scene(cache.get("FMA7235")[0]), base, apex, scale)
    log(f"LV radii (mm, apex -> mitral centre): cavity {np.round(lv['endo_radius'] / scale, 1).tolist()}, "
        f"wall {np.round(lv['epi_radius'] / scale, 1).tolist()}")

    # --- the great vessels clear of each other first: the fat is shaped round them --------------------
    # (the trunk's distances along its wall are measured on its shape from before: its dent round the aorta
    # stretched the wall there, and the viewer's cut at a fixed distance tore a slot down the trunk)
    pa_ob = objects.get("GreatVessel_PulmonaryArtery")
    pa_rest = mesh_arrays(pa_ob.data)[0].copy() if pa_ob is not None else None
    collisions = resolve_collisions([r for r in cfg.get("collisions", []) if r.get("before_fat")], objects,
                                    base=base, walls=[], scale=scale)

    # --- epicardial fat in the AV and interventricular grooves (split with the same plane) ---------
    fat_specs = [s for s in specs if s.raw.get("generate") == "epicardial_fat"]
    if fat_specs:
        fat_stats = make_epicardial_fat(wall, objects, fat_specs, base, apex, plane_co, plane_no, scale, flat_faces, node_stats, origin_mm)
        log(f"epicardial fat: {fat_stats}")

    halves = split_heart(wall, plane_co, plane_no)
    bpy.data.meshes.remove(wall.data)
    tunnel_path = SYNTH_DIR / "SYN_TunnelCutter.ply"
    if tunnel_path.exists() and not os.environ.get("CT_NO_TUNNELS"):  # channels under the fused auricle, carved in each closed, capped half
        tV, tF = mo.read_ply(tunnel_path)
        for side, (half, _caps) in list(halves.items()):
            tinfo = carve_tunnels(half, tV, tF, to_scene)
            me = half.data
            cap = np.zeros(len(me.polygons), dtype=np.float32)
            if "ct_cap" in me.attributes:
                me.attributes["ct_cap"].data.foreach_get("value", cap)
            halves[side] = (half, set(np.nonzero(cap > 0.5)[0].tolist()))
            log(f"  heart {side}: vessel channels carved under the fused auricle {tinfo}")
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
    trunk_cfg = terr_cfg.get("pulmonary_trunk")
    trunk_V = None
    if trunk_cfg:
        pa_V = to_scene(cache.get(trunk_cfg["artery_part"])[0])
        valve_c = to_scene(cache.get(trunk_cfg["valve_part"])[0]).mean(axis=0)
        trunk_V = pa_V[np.linalg.norm(pa_V - valve_c, axis=1) < trunk_cfg["radius_mm"] * scale]
        log(f"  pulmonary trunk gate: {len(trunk_V)} points within {trunk_cfg['radius_mm']} mm of the pulmonary valve")
    std_cfg = terr_cfg.get("standard_blend")
    if std_cfg:
        # AHA-17 frame: mitral hinge centre (valve vertices touching the wall, basal quartile), LV papillary
        # muscles, LAD and PDA; septal split between the LAD and RCA septal perforators (+ PDA).
        mv = to_scene(cache.get("FMA7235")[0])
        u_ba = -axis
        touch = nearest_distance(mv, wall_V) <= 1.0 * scale
        proj = (mv - base) @ u_ba
        hinge = mv[touch & (proj <= np.quantile(proj, 0.25))]
        ma_c = hinge.mean(axis=0) if len(hinge) > 20 else mv.mean(axis=0)
        pap_V = papillary_proper(objects["Papillary_Muscles"], wall_V, _wF, scale)
        lad_V = world_vertices(objects["Coronary_LAD"])
        pda_V = world_vertices(objects["Coronary_RCA_PDA"])
        lad_sep_V = np.concatenate([world_vertices(objects["Coronary_LAD_Septal"]), lad_V])
        rca_sep_V = np.concatenate([world_vertices(objects["Coronary_RCA_Septal"]), pda_V])
        log(f"  AHA-17 blend: alpha {std_cfg['alpha']}, mitral hinge centre {np.round(ma_c, 3).tolist()}")
    per_half = {}
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
            pulmonary_trunk_V=trunk_V,
        )
        seg = np.zeros(len(hV), dtype=int)
        lv_region = np.zeros(len(hV), dtype=bool)
        if std_cfg:
            seg, lv_region = aha_segments(hV, ma_c=ma_c, apex=apex, pap_V=pap_V, lad_V=lad_V, pda_V=pda_V,
                                          epi=wall_epi[nearest_index(hV, wall_V)])
            d_lad_sep = nearest_distance(hV, lad_sep_V)
            d_rca_sep = nearest_distance(hV, rca_sep_V)
            septal = mo.smoothstep(-std_cfg["septal_width_mm"] * scale, std_cfg["septal_width_mm"] * scale, d_rca_sep - d_lad_sep)
            rgb = standard_blend(rgb, seg, ventricular, alpha=std_cfg["alpha"], septal=septal)
            node_stats[spec.node]["aha_segment_vertices"] = {int(k): int(v) for k, v in zip(*np.unique(seg, return_counts=True))}
        per_half[spec.node] = [hV, hF, rgb, ventricular, qa_values, np.where(lv_region, seg, 0)]
    rv_cfg = terr_cfg.get("rv_free_wall")
    if rv_cfg and std_cfg:
        # right-ventricular free wall (ventricular, outside the LV region): the LAD keeps a strip along the anterior
        # interventricular groove, everything else is RCA (marginal / RV / conus branches) - RV infarction is RCA
        cl = json.loads((SYNTH_DIR / "coronary_centerlines.json").read_text(encoding="utf-8"))["nodes"]
        lad_trunk = to_scene(np.array(cl["Coronary_LAD"]["segments"][0]["points_mm"]))
        pda_trunk = to_scene(np.array(cl["Coronary_RCA_PDA"]["segments"][0]["points_mm"]))
        for name, (hV, hF, rgb, ventricular, _qa, lv_seg) in per_half.items():
            _, lv_region, th, t_ax = aha_segments(hV, ma_c=ma_c, apex=apex, pap_V=pap_V, lad_V=lad_V, pda_V=pda_V, with_angle=True,
                                                  epi=wall_epi[nearest_index(hV, wall_V)])
            # RV free wall: thin ventricular wall in the septal sector (between the anterior and posterior
            # interventricular grooves, seen from the LV axis) or outside the LV region; the septum is thick
            thick = wall_thick[nearest_index(hV, wall_V)] / scale
            sector = (th >= 345.0) | (th <= 140.0)
            rv = (ventricular > 0.1) & (t_ax > -0.1) & ((sector & (thick < rv_cfg["thin_mm"])) | ~lv_region)
            d_lad = nearest_distance(hV, lad_trunk)
            keep = 1.0 - mo.smoothstep(rv_cfg["lad_strip_mm"][0] * scale, rv_cfg["lad_strip_mm"][1] * scale, d_lad)
            keep = np.where(rv, keep, 1.0)
            moved = rgb[:, 0] * (1.0 - keep) + np.where(rv, rgb[:, 1], 0.0)
            rgb[:, 0] *= keep
            rgb[:, 1] = np.where(rv, 0.0, rgb[:, 1])
            rgb[:, 2] += moved
            # the RV free wall is perfused wherever it is ventricular (confidence at least the ventricular mask)
            conf = rgb.sum(axis=1)
            lift = np.where(rv, np.maximum(0.0, 0.85 * ventricular - conf), 0.0)
            rgb[:, 2] += lift
            dom = rgb.argmax(axis=1)
            node_stats[name]["rv_free_wall"] = {"vertices": int(rv.sum()), "rca_dominant": round(float((dom[rv] == 2).mean()) if rv.any() else 0.0, 3)}
            log(f"  {name}: RV free wall {int(rv.sum())} vertices, RCA-dominant {node_stats[name]['rv_free_wall']['rca_dominant']:.0%}")
            per_half[name][5] = np.where(rv, 0, lv_seg)  # the RV free wall is not LV myocardium
    if std_cfg:  # smooth before the share calibration, so the calibrated shares are the published ones
        for name, entry in per_half.items():
            entry[2] = np.clip(mo.smooth_vertex_values(entry[2], entry[1], iterations=std_cfg["smooth_iterations"]), 0.0, 1.0)
    if std_cfg and std_cfg.get("target_shares"):
        shares = calibrate_shares(per_half, np.array(std_cfg["target_shares"], dtype=float))
        log(f"  territory shares of the LV region (LAD, LCX, RCA): {shares}")
    for spec in heart_specs:
        ob = objects[spec.node]
        hV, hF, rgb, ventricular, qa_values, _lv_seg = per_half[spec.node]
        rgb = np.clip(rgb, 0.0, 1.0)
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

    # --- collisions: display-only neighbours yield (dents spread smoothly) ---------------------------
    collisions.update(resolve_collisions([r for r in cfg.get("collisions", []) if not r.get("before_fat")], objects,
                                         base=base, walls=[objects[s_.node] for s_ in heart_specs], scale=scale))
    if collisions:
        log("collisions: " + "; ".join(f"{k}: {v.get('max_penetration_before_mm', v)}" for k, v in collisions.items()))
    carve_cfg = cfg.get("lung_carve")
    if carve_cfg:
        # A carve that fails, or collapses the organ, keeps it uncarved (and says why).
        for lung_name in ("Lung_L", "Lung_R"):
            if lung_name in objects:
                names = carve_cfg["masters"]
                budget = next(s_.budget for s_ in specs if s_.node == lung_name)
                ob_ = objects[lung_name]
                backup = ob_.data.copy()
                try:
                    info = carve_lung(ob_, [objects[n] for n in names if n in objects], carve_cfg["margin_mm"] * scale, budget)
                    if tri_count(ob_) < 0.3 * budget:
                        raise ValueError(f"collapsed to {tri_count(ob_)} triangles")
                except ValueError as err:
                    failed = ob_.data
                    ob_.data = backup
                    bpy.data.meshes.remove(failed)
                    info = {"skipped": str(err)}
                else:
                    bpy.data.meshes.remove(backup)
                collisions[f"{lung_name} carved"] = info
                log(f"  {lung_name}: cardiac impression carved {info}")

    # --- pulmonary vessels: distance along the tree from the heart / from the hilum ---------------
    pulmonary = {}
    lungs = [objects[n] for n in ("Lung_L", "Lung_R") if n in objects]
    if "GreatVessel_PulmonaryArtery" in objects and "Valve_Pulmonary" in objects:
        pv_valve = world_vertices(objects["Valve_Pulmonary"])
        pulmonary["GreatVessel_PulmonaryArtery"] = pulmonary_attributes(
            objects["GreatVessel_PulmonaryArtery"], lambda Vw: nearest_distance(Vw, pv_valve) < 6.0 * scale, lungs,
            rest_V=pa_rest)
    if "GreatVessel_PulmonaryVeins" in objects:
        walls = np.concatenate([world_vertices(objects[s.node]) for s in heart_specs])
        pulmonary["GreatVessel_PulmonaryVeins"] = pulmonary_attributes(
            objects["GreatVessel_PulmonaryVeins"], lambda Vw: nearest_distance(Vw, walls) < 2.5 * scale, lungs)
    if "GreatVessel_PulmonaryArtery" in pulmonary and pa_rest is not None:
        pa_ = objects["GreatVessel_PulmonaryArtery"]
        d_ = np.empty(len(pa_.data.vertices), dtype=np.float32)
        pa_.data.attributes["_DIST_HEART"].data.foreach_get("value", d_)
        cut_ = straight_cut_distance(pa_rest, mesh_arrays(pa_.data)[1], d_)
        set_float_attribute(pa_, "_DIST_CUT", cut_)
        pulmonary["GreatVessel_PulmonaryArtery"]["kept_fraction"] = round(float((cut_ < VIEWER_PULMONARY_CUT).mean()), 3)
    for k, v in pulmonary.items():
        node_stats[k].update(v)
        log(f"  {k}: {v}")

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
        if not spec.is_coronary:  # coronary colour comes from the risk ramp; everything else gets baked maps
            uv_unwrap(ob)
    bpy.context.view_layer.update()  # refresh matrix_world after re-centring / parenting

    # --- how far inside the closed heart each wall / valve / papillary vertex lies (_ENCLOSURE) -----------
    # Occluders: the closed wall and the great-vessel stumps the viewer keeps (rig.ts): the venae cavae and the
    # ascending aorta inside the great-vessel clip sphere (not the descending limb it cuts away), the pulmonary
    # trunk up to its cut. A stump's tube shades what lies inside it (the cavo-atrial junction, the aortic root),
    # while the hidden or cut-away rest of the vessels does not shade the heart's outside. The venae cavae and the
    # aorta are closed at their (sphere) cut: the viewer darkens a cut lumen with depth (shaders.ts, the tunnel), so
    # the atrial wall at a vena cava's mouth or the aortic root, seen down a stump, is as dark as the lumen around
    # it, not lit by the cut.
    occ = [(wall_V, _wF)]
    clip_c = np.asarray(VIEWER_GREAT_VESSEL_CLIP[0], float) @ mo.BLENDER_TO_GLTF  # glTF -> Blender world
    clip_r = VIEWER_GREAT_VESSEL_CLIP[1]
    base_g = mo.to_gltf(base[None])[0]
    for name in ("GreatVessel_SVC", "GreatVessel_IVC", "GreatVessel_Aorta"):
        if name in objects:
            V = world_vertices(objects[name])
            F = mesh_arrays(objects[name].data)[1]
            C = V[F].mean(axis=1)
            keep = np.linalg.norm(C - clip_c, axis=1) < clip_r
            if name == "GreatVessel_Aorta":
                Cg = mo.to_gltf(C)
                up, behind = Cg[:, 1] - base_g[1], base_g[2] - Cg[:, 2]
                keep &= (up >= VIEWER_DESCENDING_AORTA[2]) & ((behind <= VIEWER_DESCENDING_AORTA[0]) | (up >= VIEWER_DESCENDING_AORTA[1]))
            # close the sphere's cut (not the root's floor, inside the heart)
            occ.append(cut_caps(V, F, keep, near=lambda c, _c=clip_c, _r=clip_r: np.linalg.norm(c - _c) > _r - 0.12))
    pa = objects.get("GreatVessel_PulmonaryArtery")
    pa_cut = next((n for n in ("_DIST_CUT", "_DIST_HEART") if pa is not None and n in pa.data.attributes), None)
    if pa_cut:
        d = np.empty(len(pa.data.vertices), dtype=np.float32)
        pa.data.attributes[pa_cut].data.foreach_get("value", d)
        F = mesh_arrays(pa.data)[1]
        # not closed: its cut crosses the curved trunk obliquely, so a fan across it would leave the tube on the
        # inner side of the bend and shade the left atrial roof beneath (outside the heart)
        occ.append((world_vertices(pa), F[(d[F] < VIEWER_PULMONARY_CUT).all(axis=1)]))
    occ_V, occ_F = mo.concat(occ)
    heart_bvh = BVHTree.FromPolygons(occ_V.tolist(), occ_F.tolist(), all_triangles=True)
    for name in ENCLOSED_NODES:
        if name in objects:
            e = enclosure_attribute(objects[name], heart_bvh, scale)
            set_float_attribute(objects[name], "_ENCLOSURE", e)
            node_stats.setdefault(name, {})["enclosed_fraction"] = round(float((e > 0.8).mean()), 3)
    log("  enclosure (share of vertices > 0.8): "
        + ", ".join(f"{n} {node_stats[n]['enclosed_fraction']}" for n in ENCLOSED_NODES if n in objects))

    # --- coronaries by a great-vessel stump: no display inflation or depth pull there (_PULL) --------------
    # The viewer inflates the coronaries and pulls their depth 3 mm toward the camera (tissue.ts) so they read
    # through the groove fat. Where one runs by a stump the viewer cuts open (the sinus-node artery at the SVC, the
    # left main and the RCA at their ostia on the aortic root, the RCA by the IVC), that showed it through the
    # stump's wall as a lit spot in the dark lumen, and pushed its flush ostial end into the aortic root.
    stump_V, stump_F = mo.concat(occ[1:])
    stump_bvh = BVHTree.FromPolygons(stump_V.tolist(), stump_F.tolist(), all_triangles=True)
    lo_mm, hi_mm = CORONARY_PULL_CLEAR_MM
    pulled = {}
    for spec in specs:
        if spec.is_coronary and spec.node in objects:
            ob = objects[spec.node]
            d = np.array([stump_bvh.find_nearest(Vector(p))[3] for p in world_vertices(ob)], dtype=float)
            pull = mo.smoothstep(lo_mm * scale, hi_mm * scale, d)
            set_float_attribute(ob, "_PULL", pull)
            pulled[spec.node] = round(float((pull < 0.99).mean()), 3)
    log(f"  coronary pull reduced by a stump (share of vertices): {pulled}")

    # --- per-vessel meshes for the centreline stage (glTF frame) --------------------------------
    VESSEL_MESH_DIR.mkdir(parents=True, exist_ok=True)
    for spec in specs:
        if spec.is_coronary:
            V, F = mesh_arrays(objects[spec.node].data)
            M = np.array(objects[spec.node].matrix_world)
            mo.write_ply(VESSEL_MESH_DIR / f"{spec.node}.ply", mo.to_gltf(V @ M[:3, :3].T + M[:3, 3]), F)
    for name in ("GreatVessel_Aorta", "CardiacVeins"):
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
            "lv": {
                "apex": np.round(mo.to_gltf(lv["apex"][None])[0], 5).tolist(),
                "mitral_center": np.round(mo.to_gltf(lv["mitral_center"][None])[0], 5).tolist(),
                "endo_radius": np.round(lv["endo_radius"], 5).tolist(),
                "epi_radius": np.round(lv["epi_radius"], 5).tolist(),
            },
        },
        "territories": {**terr_cfg, "encoding": "COLOR_0.rgb = (LAD, LCX, RCA) weights; r+g+b = territory confidence"},
        "collisions": collisions,
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
