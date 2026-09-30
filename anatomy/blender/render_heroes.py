"""Stage 7 — portfolio renders of the CardioTwin anatomy (Cycles + OpenImageDenoise).

Run after the build (needs ``anatomy/build/cardiotwin_build.blend`` and the published manifest / vessels)::

    blender --background --factory-startup --python anatomy/blender/render_heroes.py -- \
        [--shots hero_heart,heart_posterior,coronary_detail,open_heart,exploded_torso,xray,territories,turntable]
        [--samples 160] [--scale 1.0] [--save-scene]

Shots (1920x1080 JPEG in ``docs/media/renders``), all with the photoreal tissue looks of ``looks.py`` (the same
procedural materials that are baked into the web textures) and the coronary arteries coloured by an example
risk profile (LAD critical, LCX moderate, RCA low), as the viewer does:

* ``hero_heart``       anterior three-quarter (left-anterior-oblique) view of the heart, epicardial fat, great
                       vessels and arch branches.
* ``heart_posterior``  posterior-inferior view: crux, PDA, middle cardiac vein, coronary sinus.
* ``coronary_detail``  close-up of the anterior interventricular groove: LAD, diagonal, AIV in the fat.
* ``open_heart``       the two halves opened like a book: chambers, valves, papillary muscles.
* ``exploded_torso``   head-on view of the manifest's exploded layout (t = 1); the intrapulmonary vessel trees
                       are trimmed at the hilum with the GLB's ``_DIST_HILUM`` attribute, as the viewer can.
* ``xray``             fresnel "hologram" torso with the glowing coronary tree and flow particles.
* ``territories``      heart walls tinted by their COLOR_0 perfusion territories x the risk colours.
* ``turntable``        7 s 720p MP4 of the heart (``heart_turntable.mp4``).

The web-fidelity preview (EEVEE, baked textures only) is ``render_web_preview.py``.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))
import looks  # noqa: E402
from common import BUILD_BLEND, BUILD_REPORT, PUBLIC_DIR, RENDER_DIR, read_json  # noqa: E402

SCENE_BLEND = HERE / "cardiotwin_scene.blend"
MAX_SCENE_MB = 40.0
T0 = time.perf_counter()

#: Example risk profile used across the portfolio renders (CONTRACTS risk bands).
RISK_HEX = {"LAD": "#ef4444", "LCX": "#f59e0b", "RCA": "#2dd4bf"}
GROUP_OF = {
    "Coronary_LAD": "LAD", "Coronary_LAD_Septal": "LAD", "Coronary_LCX": "LCX",
    "Coronary_RCA": "RCA", "Coronary_RCA_Marginal": "RCA", "Coronary_RCA_PDA": "RCA",
    "Coronary_RCA_PL": "RCA", "Coronary_RCA_Septal": "RCA",
}
LAYERS = ("Layer_Skin", "Layer_Muscle", "Layer_Skeleton", "Layer_Lungs", "Layer_Diaphragm", "Layer_Heart", "Layer_Coronary")
PULMONARY_TREES = ("GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins")
HEART_ONLY_HIDE = ("GreatVessel_PulmonaryVeins", "GreatVessel_IVC")


def log(msg: str) -> None:
    print(f"[render {time.perf_counter() - T0:7.1f}s] {msg}", flush=True)


RISK = {k: looks.srgb(v) for k, v in RISK_HEX.items()}
LM_COLOR = looks.srgb("#b8352c")


def gltf_to_blender(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


# ============================================================================================
# Render / world / light / camera setup
# ============================================================================================
def setup_cycles(scene, samples: int, scale: float, width: int = 1920, height: int = 1080) -> None:
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
            prefs.refresh_devices()
            gpus = [d for d in prefs.devices if d.type == backend]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                break
        except TypeError:
            continue
    else:
        scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    if hasattr(scene.cycles, "denoising_use_gpu"):
        scene.cycles.denoising_use_gpu = True
    scene.render.use_persistent_data = True
    scene.cycles.max_bounces = 10
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 32
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = int(width * scale)
    scene.render.resolution_y = int(height * scale)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.render.image_settings.media_type = "IMAGE"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90


def setup_world(scene, top=(0.018, 0.022, 0.03), bottom=(0.002, 0.002, 0.003), strength: float = 1.0) -> None:
    world = bpy.data.worlds.get("Studio") or bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*bottom, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (*top, 1)
    map_range = nt.nodes.new("ShaderNodeMapRange")
    map_range.inputs["From Min"].default_value = -1.0
    map_range.inputs["From Max"].default_value = 1.0
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], map_range.inputs["Value"])
    nt.links.new(map_range.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def clear_rig() -> None:
    for ob in list(bpy.data.objects):
        if ob.get("ct_rig"):
            bpy.data.objects.remove(ob, do_unlink=True)


def look_at(ob, target) -> None:
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name: str, loc, target, power: float, size: float, color=(1, 1, 1), spread: float = 180.0):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.size = size
    data.shape = "DISK"
    data.color = color
    data.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, data)
    ob["ct_rig"] = True
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    look_at(ob, target)
    return ob


def camera(name: str, loc, target, lens: float = 85.0, fstop: float | None = None, focus=None):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_start = 0.05
    data.clip_end = 200
    data.sensor_width = 36
    ob = bpy.data.objects.new(name, data)
    ob["ct_rig"] = True
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    look_at(ob, target)
    if fstop:
        data.dof.use_dof = True
        data.dof.aperture_fstop = fstop
        data.dof.focus_distance = (Vector(focus if focus is not None else target) - ob.location).length
    bpy.context.scene.camera = ob
    return ob


def orbit(target: Vector, azimuth_deg: float, elevation_deg: float, distance: float) -> Vector:
    """Camera position around ``target``: azimuth 0 = anterior (-Y), positive towards patient-left (+X)."""
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    return Vector(target) + distance * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def compositor_glow(scene, strength: float = 0.6, threshold: float = 0.8, size: float = 0.5, vignette: float = 0.35) -> None:
    """Bloom + soft vignette via the 5.x compositor node group."""
    ng = bpy.data.node_groups.new("CT_Comp", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    glare = ng.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Threshold"].default_value = threshold
    glare.inputs["Strength"].default_value = strength
    glare.inputs["Size"].default_value = size
    out = ng.nodes.new("NodeGroupOutput")
    last = glare.outputs["Image"]
    ng.links.new(rl.outputs["Image"], glare.inputs["Image"])
    if vignette > 0:
        mask = ng.nodes.new("CompositorNodeEllipseMask")
        mask.inputs["Size"].default_value = (0.95, 0.95)
        blur = ng.nodes.new("CompositorNodeBlur")
        blur.inputs["Size"].default_value = (300, 300)
        ramp = ng.nodes.new("ShaderNodeMapRange")
        ramp.inputs["To Min"].default_value = 1.0 - vignette
        ramp.inputs["To Max"].default_value = 1.0
        mix = ng.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        ng.links.new(mask.outputs["Mask"], blur.inputs["Image"])
        ng.links.new(blur.outputs["Image"], ramp.inputs["Value"])
        ng.links.new(last, mix.inputs["A"])
        ng.links.new(ramp.outputs["Result"], mix.inputs["B"])
        last = mix.outputs["Result"]
    ng.links.new(last, out.inputs["Image"])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True


def studio_rig(target, key_dir=(-35.0, 40.0), rim_dir=(150.0, 25.0), fill_dir=(70.0, -5.0), dist=5.0, scale=1.0,
               warm=(1.0, 0.93, 0.86), cool=(0.62, 0.78, 1.0)) -> None:
    """Soft key, cool rim and weak fill around ``target`` (azimuth / elevation in degrees)."""
    t = Vector(target)
    area_light("Key", orbit(t, key_dir[0], key_dir[1], dist), t, power=520 * scale, size=2.6 * scale ** 0.5, color=warm)
    area_light("Rim", orbit(t, rim_dir[0], rim_dir[1], dist), t, power=900 * scale, size=1.6 * scale ** 0.5, color=cool)
    area_light("Fill", orbit(t, fill_dir[0], fill_dir[1], dist * 1.1), t, power=120 * scale, size=3.5 * scale ** 0.5, color=(0.8, 0.85, 1.0))
    area_light("Under", orbit(t, 20.0, -55.0, dist), t, power=90 * scale, size=3.0 * scale ** 0.5, color=(1.0, 0.7, 0.62))


# ============================================================================================
# Materials
# ============================================================================================
def mat_emissive(name, color, strength) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    if not mat.node_tree:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    emit.inputs["Strength"].default_value = strength
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def mat_hologram(name, color, rim: float, core: float = 0.0, power: float = 2.5) -> bpy.types.Material:
    """Fresnel rim glow on a transparent body (additive x-ray look)."""
    mat = bpy.data.materials.new(name)
    if not mat.node_tree:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = power
    strength = nt.nodes.new("ShaderNodeMapRange")
    strength.inputs["To Min"].default_value = core
    strength.inputs["To Max"].default_value = rim
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(lw.outputs["Facing"], pw.inputs[0])
    nt.links.new(pw.outputs[0], strength.inputs["Value"])
    nt.links.new(strength.outputs["Result"], emit.inputs["Strength"])
    nt.links.new(transp.outputs[0], add.inputs[0])
    nt.links.new(emit.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return mat


def mat_territory(neutral=(0.075, 0.045, 0.045)) -> bpy.types.Material:
    """Myocardium tinted by COLOR_0 territory weights x the example risk colours."""
    m = looks.myocardium("R_Territory")
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Territory"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
    acc = nt.nodes.new("ShaderNodeMix")
    acc.data_type = "RGBA"
    acc.inputs["Factor"].default_value = 0.0
    acc.inputs[6].default_value = (*neutral, 1)
    last = acc.outputs[2]
    emit_last = None
    for ch, key in (("Red", "LAD"), ("Green", "LCX"), ("Blue", "RCA")):
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[7].default_value = (*(0.42 * c for c in RISK[key]), 1)
        nt.links.new(last, mix.inputs[6])
        nt.links.new(sep.outputs[ch], mix.inputs["Factor"])
        last = mix.outputs[2]
        scaled = nt.nodes.new("ShaderNodeMix")
        scaled.data_type = "RGBA"
        scaled.blend_type = "MULTIPLY"
        scaled.inputs["Factor"].default_value = 1.0
        scaled.inputs[7].default_value = (*RISK[key], 1)
        comb = nt.nodes.new("ShaderNodeCombineColor")
        for c in ("Red", "Green", "Blue"):
            nt.links.new(sep.outputs[ch], comb.inputs[c])
        nt.links.new(comb.outputs["Color"], scaled.inputs[6])
        if emit_last is None:
            emit_last = scaled.outputs[2]
        else:
            emix = nt.nodes.new("ShaderNodeMix")
            emix.data_type = "RGBA"
            emix.blend_type = "ADD"
            emix.inputs["Factor"].default_value = 1.0
            nt.links.new(emit_last, emix.inputs[6])
            nt.links.new(scaled.outputs[2], emix.inputs[7])
            emit_last = emix.outputs[2]
    nt.links.new(last, bsdf.inputs["Base Color"])
    nt.links.new(emit_last, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.12
    return m


def assign(ob, mat) -> None:
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ============================================================================================
# Scene helpers
# ============================================================================================
class Anatomy:
    """Access to the built objects plus rest transforms, so shots can modify and restore them."""

    def __init__(self, manifest: dict):
        self.manifest = manifest
        self.objects = {o.name: o for o in bpy.data.objects if o.type == "MESH" and o.parent and o.parent.name in LAYERS}
        self.rest = {n: o.matrix_world.copy() for n, o in self.objects.items()}
        self.parents = {n: o.parent for n, o in self.objects.items()}
        self.base_materials = {n: list(o.data.materials) for n, o in self.objects.items()}
        self.layer_of = {n: o.parent.name for n, o in self.objects.items()}
        self.struct = {s["node"]: s for s in manifest["structures"]}
        self.extra: list[bpy.types.Object] = []
        self.looks: dict[str, bpy.types.Material] = {}

    def reset(self) -> None:
        for n, o in self.objects.items():
            o.parent = self.parents[n]
            o.matrix_world = self.rest[n].copy()
            o.hide_render = False
            o.data.materials.clear()
            for m in self.base_materials[n]:
                o.data.materials.append(m)
        for ob in self.extra:
            bpy.data.objects.remove(ob, do_unlink=True)
        self.extra = []
        clear_rig()
        bpy.context.scene.compositing_node_group = None

    def show_only(self, layers=(), nodes=(), hide=()) -> None:
        for n, o in self.objects.items():
            o.hide_render = not ((self.layer_of[n] in layers or n in nodes) and n not in hide)

    def explode(self, t: float = 1.0, layers=None) -> None:
        layer_vec = {layer["node"]: layer["explode"] for layer in self.manifest["layers"]}
        for s in self.manifest["structures"]:
            o = self.objects.get(s["node"])
            if o is None or (layers and self.layer_of[s["node"]] not in layers):
                continue
            off = [t * (a + b) for a, b in zip(layer_vec[self.layer_of[s["node"]]], s["explode"])]
            o.matrix_world = Matrix.Translation(gltf_to_blender(off)) @ self.rest[s["node"]]

    def look(self, node: str) -> bpy.types.Material:
        if node not in self.looks:
            self.looks[node] = looks.look_for(self.objects[node].get("ct_category", ""), node)
        return self.looks[node]

    def style(self, *, glow: float = 0.0) -> None:
        """Photoreal looks everywhere; coronary arteries in the example risk colours (as the viewer)."""
        for n, o in self.objects.items():
            if self.layer_of[n] == "Layer_Coronary":
                group = GROUP_OF.get(n)
                color = RISK[group] if group else LM_COLOR
                key = f"R_Coronary_{group or 'LM'}"
                if key not in self.looks:
                    self.looks[key] = looks.coronary(key, color, glow=glow if group else 0.0)
                assign(o, self.looks[key])
            else:
                assign(o, self.look(n))

    def cropped_copy(self, name: str, *, radius: float | None = None, center=(0, 0, 0), z_min: float | None = None,
                     z_max: float | None = None, keep_largest: bool = False, max_hilum: float | None = None,
                     max_heart: float | None = None) -> bpy.types.Object:
        """Render-only copy of a node clipped to a sphere, a height band and/or the proximal part of a pulmonary
        tree (``_DIST_HILUM`` <= ``max_hilum``). The published asset is never modified."""
        src = self.objects[name]
        ob = src.copy()
        ob.data = src.data.copy()
        ob["ct_extra"] = True
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = None
        ob.matrix_world = src.matrix_world.copy()
        for attr, limit in (("_DIST_HILUM", max_hilum), ("_DIST_HEART", max_heart)):
            if limit is None or attr not in ob.data.attributes:
                continue
            vals = np.empty(len(ob.data.vertices), dtype=np.float32)
            ob.data.attributes[attr].data.foreach_get("value", vals)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if vals[v.index] > limit], context="VERTS")
            open_edges = [e for e in bm.edges if e.is_boundary]
            if open_edges:
                bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)
            bm.to_mesh(ob.data)
            bm.free()
        # plane cuts (bisect, capped) and a sphere cut (vertex deletion): robust on meshes that touch themselves,
        # where exact booleans can return nothing
        M = ob.matrix_world
        Mi = M.inverted()
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        planes = ([((0, 0, z_min), (0, 0, -1))] if z_min is not None else []) + ([((0, 0, z_max), (0, 0, 1))] if z_max is not None else [])
        for co, no in planes:
            res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                                         plane_co=Mi @ Vector(co), plane_no=(Mi.to_3x3().transposed() @ Vector(no)).normalized(),
                                         clear_outer=True)
            edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
            if edges:
                bmesh.ops.holes_fill(bm, edges=edges, sides=0)
        bm.to_mesh(ob.data)
        bm.free()
        if radius is not None:
            sphere_clip(ob, center, radius)
        if keep_largest:
            keep_largest_island(ob.data)
        assign(ob, src.data.materials[0])
        self.extra.append(ob)
        src.hide_render = True
        return ob

    def stage_heart(self, *, keep_ivc: bool = False) -> None:
        """Close-up staging: pulmonary-vein tree hidden, pulmonary artery trimmed near its bifurcation, the
        descending aorta, arch branches and brachiocephalic veins trimmed to short stumps."""
        for n in HEART_ONLY_HIDE:
            if n == "GreatVessel_IVC" and keep_ivc:
                continue
            self.objects[n].hide_render = True
        self.cropped_copy("GreatVessel_Aorta", z_min=0.02)
        # pulmonary trunk + short stumps of the right / left pulmonary arteries
        valve = self.objects["Valve_Pulmonary"].matrix_world.translation
        self.cropped_copy("GreatVessel_PulmonaryArtery", radius=0.42, keep_largest=True,
                          center=(valve.x - 0.02, valve.y + 0.2, valve.z + 0.3))
        top = max(v.co.z for v in self.objects["GreatVessel_Aorta"].data.vertices) + self.objects["GreatVessel_Aorta"].matrix_world.translation.z
        arch = self.objects["GreatVessel_Aorta"].matrix_world.translation
        for n in ("GreatVessel_Aorta_ArchBranches", "GreatVessel_SVC_BrachiocephalicVeins"):
            if n in self.objects:
                ob = self.cropped_copy(n, z_max=top + 0.10, radius=0.62, center=(arch.x - 0.05, arch.y, top - 0.1), keep_largest=False)
                keep_largest_island(ob.data, min_fraction=0.2)


def sphere_clip(ob: bpy.types.Object, center, radius: float) -> None:
    """Keep the part of a mesh inside a sphere: exact boolean (clean round cut), vertex deletion if it fails."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=radius, location=center)
    cutter = bpy.context.active_object
    mod = ob.modifiers.new("clip", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.solver = "EXACT"
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    ob.modifiers.clear()
    bpy.data.objects.remove(cutter, do_unlink=True)
    if len(me.polygons) > 50:
        ob.data = me
        return
    bpy.data.meshes.remove(me)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    c = Vector(center)
    M = ob.matrix_world
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (M @ v.co - c).length > radius], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def keep_largest_island(me: bpy.types.Mesh, min_fraction: float = 1.0) -> None:
    """Delete connected pieces smaller than ``min_fraction`` of the largest (1.0: keep only the largest)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    seen: set = set()
    best: list = []
    islands: list = []
    for face in bm.faces:
        if face in seen:
            continue
        island, stack = [], [face]
        seen.add(face)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        islands.append(island)
        if len(island) > len(best):
            best = island
    keep = {f for isl in islands if len(isl) >= min_fraction * len(best) for f in isl}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
    bm.to_mesh(me)
    bm.free()


def flow_particles(vessels: dict, every: int, radius: float, strength: float, anatomy: Anatomy) -> None:
    """Small emissive beads along the coronary centrelines, coloured by the example risk profile."""
    per_color: dict[str, list[Vector]] = {}
    for v in vessels["vessels"]:
        key = v["target"] or "LM"
        for seg in v["segments"]:
            for i, p in enumerate(seg["points"]):
                if i % every == 0:
                    per_color.setdefault(key, []).append(gltf_to_blender(p))
    for key, pts in per_color.items():
        bm = bmesh.new()
        for p in pts:
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius, matrix=Matrix.Translation(p))
        me = bpy.data.meshes.new(f"Flow_{key}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(f"Flow_{key}", me)
        ob["ct_extra"] = True
        bpy.context.scene.collection.objects.link(ob)
        color = RISK.get(key, (1.0, 0.5, 0.45))
        assign(ob, mat_emissive(f"R_Flow_{key}", tuple(min(1.0, c * 1.2 + 0.1) for c in color), strength))
        anatomy.extra.append(ob)


def render_to(scene, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    log(f"wrote {path.name} ({path.stat().st_size / 1e3:.0f} kB, {time.perf_counter() - t:.0f}s)")


def centreline_point(vessels: dict, vid: str, frac: float) -> Vector:
    v = next(x for x in vessels["vessels"] if x["id"] == vid)
    P = np.array(v["segments"][0]["points"])
    s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    return gltf_to_blender(P[int(np.searchsorted(s, frac * s[-1]))])


# ============================================================================================
# Shots
# ============================================================================================
HERO_TARGET = (0.06, -0.05, 0.36)
HERO_VIEW = (28.0, 8.0, 7.9)  # azimuth, elevation (deg), distance


def shot_hero_heart(scene, an: Anatomy, out: Path, vessels: dict) -> None:
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
    an.style(glow=0.25)
    an.stage_heart()
    setup_world(scene, top=(0.010, 0.012, 0.018), bottom=(0.0008, 0.0008, 0.0012))
    t = Vector(HERO_TARGET)
    az, el, dist = HERO_VIEW
    focus = centreline_point(vessels, "LAD", 0.35)
    camera("CamHero", orbit(t, az, el, dist), t, lens=70, fstop=6.3, focus=focus)
    studio_rig(t, key_dir=(-40.0, 38.0), rim_dir=(160.0, 30.0), fill_dir=(75.0, 5.0), dist=5.0)
    compositor_glow(scene, strength=0.25, threshold=1.0, size=0.5, vignette=0.4)
    render_to(scene, out / "hero_heart.jpg")


def shot_heart_posterior(scene, an: Anatomy, out: Path, vessels: dict) -> None:
    """Posterior-inferior view of the diaphragmatic surface: crux, PDA, MCV, coronary sinus."""
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"),
                 hide=("GreatVessel_Aorta", "GreatVessel_Aorta_ArchBranches", "GreatVessel_SVC_BrachiocephalicVeins",
                       "GreatVessel_PulmonaryVeins", "GreatVessel_PulmonaryArtery", "GreatVessel_SVC"))
    an.style(glow=0.25)
    an.cropped_copy("GreatVessel_IVC", z_min=-0.30)
    crux = centreline_point(vessels, "RCA_PDA", 0.0)
    t = Vector((0.06, 0.10, -0.12))
    setup_world(scene, top=(0.010, 0.012, 0.018), bottom=(0.0008, 0.0008, 0.0012))
    camera("CamPost", orbit(t, 168.0, -28.0, 4.7), t, lens=62, fstop=7.0, focus=crux)
    studio_rig(t, key_dir=(130.0, 10.0), rim_dir=(-10.0, 40.0), fill_dir=(220.0, -40.0), dist=5.0)
    compositor_glow(scene, strength=0.25, threshold=1.0, size=0.5, vignette=0.4)
    render_to(scene, out / "heart_posterior.jpg")


def shot_coronary_detail(scene, an: Anatomy, out: Path, vessels: dict) -> None:
    """Close-up of the anterior interventricular groove: LAD, first diagonal, AIV, epicardial fat."""
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
    an.style(glow=0.15)
    an.stage_heart()
    t = centreline_point(vessels, "LAD", 0.42)
    n = (t - Vector((0.05, 0.0, 0.0))).normalized()
    loc = t + Vector((n.x * 1.2 + 0.25, -2.2, n.z * 0.6 + 0.25))
    camera("CamDetail", loc, t, lens=100, fstop=4.0, focus=t)
    setup_world(scene, top=(0.012, 0.014, 0.02), bottom=(0.001, 0.001, 0.0015))
    studio_rig(t, key_dir=(-30.0, 45.0), rim_dir=(120.0, 20.0), fill_dir=(40.0, -20.0), dist=3.0, scale=0.45)
    compositor_glow(scene, strength=0.2, threshold=1.0, size=0.5, vignette=0.35)
    render_to(scene, out / "coronary_detail.jpg")


def shot_open_heart(scene, an: Anatomy, out: Path, report: dict) -> None:
    """The heart opened along its long-axis cut: the posterior half (LV, RV, septum, mitral and tricuspid
    valves, papillary muscles and chordae) faces the camera, and the anterior half is turned 180 degrees about
    the vertical and set beside it, so both cut faces and cavities read side by side."""
    show = ("Heart_Wall_Anterior", "Heart_Wall_Posterior", "Valve_Mitral", "Valve_Tricuspid", "Valve_Pulmonary",
            "Valve_Aortic", "Papillary_Muscles", "EpicardialFat_Anterior", "EpicardialFat_Posterior")
    an.show_only(nodes=show)
    an.style()
    cut_n = gltf_to_blender(report["heart"]["cut_plane"]["normal"]).normalized()
    cut_p = gltf_to_blender(report["heart"]["cut_plane"]["point"])
    anterior = ("Heart_Wall_Anterior", "EpicardialFat_Anterior", "Valve_Pulmonary")
    centre = an.objects["Heart_Wall_Anterior"].matrix_world.translation.copy()
    pivot = bpy.data.objects.new("OpenPivot", None)
    pivot["ct_rig"] = True
    scene.collection.objects.link(pivot)
    pivot.location = centre
    bpy.context.view_layer.update()
    for n in anterior:
        o = an.objects[n]
        mw = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = mw
    # face the posterior half's cut towards the camera: camera looks along -cut normal (from the anterior side)
    side = Vector((-1.0, 0.0, 0.0))
    pivot.rotation_euler = (0.0, 0.0, math.radians(180.0))
    pivot.location = centre + side * 1.25 + cut_n * 0.2 + Vector((0.0, 0.0, -0.10))
    bpy.context.view_layer.update()
    t = cut_p + side * 0.62 + Vector((0.0, 0.0, -0.02))
    cam_dir = (cut_n + Vector((0.0, 0.0, 0.35))).normalized()
    camera("CamOpen", t + cam_dir * 7.0, t, lens=58, fstop=11.0, focus=cut_p)
    setup_world(scene, top=(0.012, 0.014, 0.02), bottom=(0.001, 0.001, 0.0015))
    studio_rig(t, key_dir=(-15.0, 50.0), rim_dir=(170.0, 30.0), fill_dir=(40.0, 10.0), dist=6.0, scale=1.6)
    compositor_glow(scene, strength=0.2, threshold=1.0, size=0.5, vignette=0.35)
    render_to(scene, out / "open_heart.jpg")


EXPLODE_VIEW = (0.0, 6.0, 10.2)  # azimuth, elevation (deg), distance


def shot_exploded(scene, an: Anatomy, out: Path) -> None:
    an.show_only(layers=LAYERS, hide=("Skin_Torso",))
    an.style()
    an.explode(1.0)
    # the viewer can trim the pulmonary trees at the hilum with _DIST_HILUM: do the same so the layers read
    for n in PULMONARY_TREES:
        an.cropped_copy(n, max_hilum=0.012)
    for ob in an.extra:
        base = ob.name.split(".")[0]
        if base in an.objects:
            ob.matrix_world = an.objects[base].matrix_world.copy()
    manifest_cam = an.manifest["camera"]["exploded"]
    target = gltf_to_blender(manifest_cam["target"]) + Vector((0.0, 0.0, 0.05))
    az, el, dist = EXPLODE_VIEW
    cam = camera("CamExplode", orbit(target, az, el, dist), target, lens=50)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(manifest_cam["fov"] * 0.92)
    setup_world(scene, top=(0.02, 0.024, 0.034), bottom=(0.002, 0.002, 0.003))
    area_light("Key", orbit(target, -30.0, 45.0, 14.0), target, power=5200, size=8, color=(1.0, 0.95, 0.9))
    area_light("Rim", orbit(target, 165.0, 25.0, 12.0), target, power=7000, size=6, color=(0.6, 0.78, 1.0))
    area_light("Fill", orbit(target, 55.0, 0.0, 12.0), target, power=1800, size=9, color=(0.85, 0.88, 1.0))
    compositor_glow(scene, strength=0.15, threshold=1.2, size=0.6, vignette=0.3)
    render_to(scene, out / "exploded_torso.jpg")


def shot_territories(scene, an: Anatomy, out: Path, samples: int) -> None:
    """Heart walls tinted by COLOR_0 territory weights x risk colours, anterior + posterior-inferior."""
    an.show_only(nodes=("Heart_Wall_Anterior", "Heart_Wall_Posterior"), layers=("Layer_Coronary",))
    an.style(glow=0.4)
    terr = mat_territory()
    for n in ("Heart_Wall_Anterior", "Heart_Wall_Posterior"):
        assign(an.objects[n], terr)
    setup_world(scene, top=(0.012, 0.015, 0.022), bottom=(0.001, 0.001, 0.0015))
    target = Vector((0.1, 0.0, -0.05))
    width, height = scene.render.resolution_x, scene.render.resolution_y
    scene.render.resolution_x = width // 2
    views = {
        "anterior": (orbit(target, 12.0, 12.0, 4.3), orbit(target, -40.0, 45.0, 5.0), orbit(target, 150.0, 25.0, 5.0)),
        "posterior_inferior": (orbit(target, 160.0, -32.0, 4.3), orbit(target, 120.0, 10.0, 5.0), orbit(target, -20.0, 35.0, 5.0)),
    }
    for view, (cam_loc, key_loc, rim_loc) in views.items():
        clear_rig()
        camera(f"Cam_{view}", cam_loc, target, lens=72)
        area_light("Key", key_loc, target, power=430, size=2.8, color=(1.0, 0.95, 0.9))
        area_light("Rim", rim_loc, target, power=620, size=2.2, color=(0.65, 0.8, 1.0))
        area_light("Fill", cam_loc * 1.2 + Vector((0, 0, 1.5)), target, power=110, size=4.0)
        compositor_glow(scene, strength=0.4, threshold=0.8, size=0.55, vignette=0.3)
        render_to(scene, out / f"_territories_{view}.jpg")
    scene.render.resolution_x = width
    _side_by_side(out / "_territories_anterior.jpg", out / "_territories_posterior_inferior.jpg", out / "territories.jpg", width, height)


def _side_by_side(left: Path, right: Path, dest: Path, width: int, height: int) -> None:
    a = bpy.data.images.load(str(left))
    b = bpy.data.images.load(str(right))
    pa = np.array(a.pixels[:]).reshape(a.size[1], a.size[0], 4)
    pb = np.array(b.pixels[:]).reshape(b.size[1], b.size[0], 4)
    combo = np.concatenate([pa, pb], axis=1)
    img = bpy.data.images.new("territories", width=combo.shape[1], height=combo.shape[0])
    img.pixels = combo.ravel().tolist()
    img.filepath_raw = str(dest)
    img.file_format = "JPEG"
    img.save_render(str(dest), scene=bpy.context.scene)
    for im in (a, b, img):
        bpy.data.images.remove(im)
    left.unlink()
    right.unlink()
    log(f"wrote {dest.name} ({dest.stat().st_size / 1e3:.0f} kB)")


XRAY_VIEW = (22.0, 6.0, 6.3, 50.0)  # azimuth, elevation (deg), distance, lens (mm)


def shot_xray(scene, an: Anatomy, out: Path, vessels: dict) -> None:
    """Fresnel hologram torso; the coronary tree and flow particles are the only strong emitters."""
    an.show_only(layers=LAYERS, hide=PULMONARY_TREES)
    cyan = (0.22, 0.62, 1.0)
    holo = {
        "Layer_Skin": mat_hologram("H_Skin", cyan, rim=0.9, power=3.0),
        "Layer_Muscle": mat_hologram("H_Muscle", (0.25, 0.5, 1.0), rim=0.22, power=2.5),
        "Layer_Skeleton": mat_hologram("H_Bone", (0.7, 0.85, 1.0), rim=0.26, core=0.008, power=2.4),
        "Layer_Lungs": mat_hologram("H_Lung", (0.2, 0.5, 1.0), rim=0.28, power=2.2),
        "Layer_Diaphragm": mat_hologram("H_Diaphragm", (0.2, 0.45, 0.9), rim=0.18, power=2.2),
        "Layer_Heart": mat_hologram("H_Heart", (1.0, 0.32, 0.28), rim=0.75, core=0.012, power=2.0),
    }
    vessels_look = mat_hologram("H_Vessels", (0.9, 0.3, 0.32), rim=0.32, core=0.005, power=2.0)
    fat_look = mat_hologram("H_Fat", (1.0, 0.75, 0.35), rim=0.18, core=0.0, power=2.0)
    for n, o in an.objects.items():
        layer = an.layer_of[n]
        if layer == "Layer_Coronary":
            group = GROUP_OF.get(n)
            assign(o, mat_emissive(f"H_{n}", RISK[group] if group else (1.0, 0.55, 0.5), 4.0 if group else 2.4))
        elif n.startswith("GreatVessel_") or n == "CardiacVeins":
            assign(o, vessels_look)
        elif n.startswith("EpicardialFat"):
            assign(o, fat_look)
        else:
            assign(o, holo[layer])
    flow_particles(vessels, every=2, radius=0.0045, strength=6.0, anatomy=an)
    setup_world(scene, top=(0.002, 0.005, 0.01), bottom=(0.0, 0.0, 0.0))
    scene.cycles.transparent_max_bounces = 64
    az, el, dist, lens = XRAY_VIEW
    target = Vector((0.08, -0.15, -0.05))
    camera("CamXray", orbit(target, az, el, dist), target, lens=lens)
    compositor_glow(scene, strength=0.9, threshold=0.55, size=0.7, vignette=0.45)
    render_to(scene, out / "xray.jpg")


def shot_turntable(scene, an: Anatomy, out: Path, samples: int, frames: int | None = None) -> None:
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
    an.style(glow=0.25)
    an.stage_heart()
    setup_world(scene, top=(0.010, 0.013, 0.02), bottom=(0.0008, 0.0008, 0.0012))
    pivot = bpy.data.objects.new("Turntable", None)
    pivot["ct_rig"] = True
    scene.collection.objects.link(pivot)
    moving = [o for n, o in an.objects.items() if not o.hide_render] + [o for o in an.extra if not o.hide_render]
    for o in moving:
        mw = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = mw
    target = Vector((0.1, 0.0, 0.18))
    camera("CamTurn", (0.1, -6.2, 1.1), target, lens=58)
    studio_rig(target, dist=5.0)
    fps, seconds = 24, 7
    scene.frame_start, scene.frame_end = 1, fps * seconds
    scene.render.fps = fps
    pivot.rotation_euler = (0, 0, 0)
    pivot.keyframe_insert("rotation_euler", index=2, frame=1)
    pivot.rotation_euler = (0, 0, 2 * math.pi)
    pivot.keyframe_insert("rotation_euler", index=2, frame=scene.frame_end + 1)
    for fc in _fcurves(pivot):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    if frames:
        scene.frame_end = min(scene.frame_end, frames)
    scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    compositor_glow(scene, strength=0.2, threshold=1.0, size=0.6, vignette=0.35)
    path = out / "heart_turntable.mp4"
    scene.render.filepath = str(path)
    t = time.perf_counter()
    bpy.ops.render.render(animation=True)
    log(f"wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB, {time.perf_counter() - t:.0f}s)")
    scene.render.image_settings.media_type = "IMAGE"
    scene.render.image_settings.file_format = "JPEG"


def _fcurves(ob):
    ad = ob.animation_data
    if ad is None or ad.action is None:
        return []
    action = ad.action
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


# ============================================================================================
def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_heroes.py")
    ap.add_argument("--shots", default="hero_heart,heart_posterior,coronary_detail,open_heart,exploded_torso,xray,territories")
    ap.add_argument("--samples", type=int, default=160)
    ap.add_argument("--turntable-samples", type=int, default=48)
    ap.add_argument("--scale", type=float, default=1.0, help="resolution scale (0.5 for drafts)")
    ap.add_argument("--frames", type=int, default=None, help="limit turntable frames (tests)")
    ap.add_argument("--out", default=str(RENDER_DIR))
    ap.add_argument("--save-scene", action="store_true")
    args = ap.parse_args(argv)
    out = Path(args.out)

    bpy.ops.wm.open_mainfile(filepath=str(BUILD_BLEND))
    scene = bpy.context.scene
    manifest = json.loads((PUBLIC_DIR / "manifest.json").read_text(encoding="utf-8"))
    vessels = json.loads((PUBLIC_DIR / "vessels.json").read_text(encoding="utf-8"))
    report = read_json(BUILD_REPORT)
    looks.ensure_heart_frame(gltf_to_blender(report["heart"]["base_center"]), gltf_to_blender(report["heart"]["apex"]))
    an = Anatomy(manifest)

    for shot in args.shots.split(","):
        setup_cycles(scene, args.samples, args.scale)
        an.reset()
        log(f"--- {shot}")
        if shot == "hero_heart":
            shot_hero_heart(scene, an, out, vessels)
        elif shot == "heart_posterior":
            shot_heart_posterior(scene, an, out, vessels)
        elif shot == "coronary_detail":
            shot_coronary_detail(scene, an, out, vessels)
        elif shot == "open_heart":
            shot_open_heart(scene, an, out, report)
        elif shot == "exploded_torso":
            shot_exploded(scene, an, out)
        elif shot == "territories":
            shot_territories(scene, an, out, args.samples)
        elif shot == "xray":
            shot_xray(scene, an, out, vessels)
        elif shot == "turntable":
            shot_turntable(scene, an, out, args.turntable_samples, args.frames)
        else:
            raise SystemExit(f"unknown shot {shot!r}")

    if args.save_scene:
        an.reset()
        an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
        an.style(glow=0.25)
        setup_world(scene, top=(0.010, 0.012, 0.018), bottom=(0.0008, 0.0008, 0.0012))
        t = Vector(HERO_TARGET)
        camera("CamHero", orbit(t, *HERO_VIEW), t, lens=70)
        studio_rig(t)
        bpy.ops.wm.save_as_mainfile(filepath=str(SCENE_BLEND), compress=True)
        mb = SCENE_BLEND.stat().st_size / 1e6
        if mb > MAX_SCENE_MB:
            SCENE_BLEND.unlink()
            log(f"scene is {mb:.1f} MB (> {MAX_SCENE_MB} MB) - not saved")
        else:
            log(f"saved {SCENE_BLEND} ({mb:.1f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
