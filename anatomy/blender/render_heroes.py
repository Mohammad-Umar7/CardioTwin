"""Stage 7 — portfolio renders of the CardioTwin anatomy (Cycles + OpenImageDenoise).

Run after the build (needs ``anatomy/build/cardiotwin_build.blend`` and the published manifest /
vessels)::

    blender --background --factory-startup --python anatomy/blender/render_heroes.py -- \
        [--shots hero_heart,exploded_torso,territories,xray,turntable] [--samples 256] [--scale 1.0] [--save-scene]

Shots (1920x1080 JPEG in ``docs/media/renders``):

* ``hero_heart``      3/4 anterior close-up; subsurface myocardium, glossy coronary tree coloured by an
                      example risk profile (LAD critical, LCX moderate, RCA low), dark studio, rim light, DOF.
* ``exploded_torso``  every layer peeled apart with the manifest's explode vectors; glassy lungs,
                      ivory bone, translucent skin, opened heart.
* ``territories``     heart walls shaded by their COLOR_0 perfusion-territory weights tinted with the
                      same risk profile — anterior and inferior views side by side.
* ``xray``            fresnel "hologram" torso with the glowing coronary tree and flow particles
                      placed along the ``vessels.json`` centrelines.
* ``turntable``       7 s 720p MP4 of the heart and coronary tree (``heart_turntable.mp4``).

``--save-scene`` also writes the lit render scene to ``anatomy/blender/cardiotwin_scene.blend`` when
it is no larger than 40 MB.
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
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
from common import BUILD_BLEND, PUBLIC_DIR, RENDER_DIR  # noqa: E402

SCENE_BLEND = HERE / "cardiotwin_scene.blend"
MAX_SCENE_MB = 40.0
T0 = time.perf_counter()

#: Example risk profile used across the portfolio renders (CONTRACTS risk bands).
RISK_HEX = {"LAD": "#ef4444", "LCX": "#f59e0b", "RCA": "#2dd4bf"}
NEUTRAL_ARTERY = (0.55, 0.16, 0.13)
GROUP_OF = {
    "Coronary_LAD": "LAD", "Coronary_LAD_Septal": "LAD", "Coronary_LCX": "LCX",
    "Coronary_RCA": "RCA", "Coronary_RCA_Marginal": "RCA", "Coronary_RCA_PDA": "RCA",
    "Coronary_RCA_PL": "RCA", "Coronary_RCA_Septal": "RCA",
}
LAYERS = ("Layer_Skin", "Layer_Muscle", "Layer_Skeleton", "Layer_Lungs", "Layer_Diaphragm", "Layer_Heart", "Layer_Coronary")
PULMONARY_TREES = ("GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins")


def log(msg: str) -> None:
    print(f"[render {time.perf_counter() - T0:7.1f}s] {msg}", flush=True)


def hex_to_linear(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


RISK = {k: hex_to_linear(v) for k, v in RISK_HEX.items()}


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
                log(f"cycles on {backend}: {', '.join(d.name for d in gpus)}")
                break
        except TypeError:
            continue
    else:
        scene.cycles.device = "CPU"
        log("cycles on CPU")
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    if hasattr(scene.cycles, "denoising_use_gpu"):
        scene.cycles.denoising_use_gpu = True
    # Keep kernels / BVH / denoiser alive between animation frames (turntable) instead of rebuilding.
    scene.render.use_persistent_data = True
    scene.cycles.max_bounces = 12
    scene.cycles.transmission_bounces = 12
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
    scene.render.image_settings.quality = 92


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


def no_compositor(scene) -> None:
    scene.compositing_node_group = None


# ============================================================================================
# Materials
# ============================================================================================
def _principled(name: str, **inputs) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    if not mat.node_tree:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for key, value in inputs.items():
        bsdf.inputs[key.replace("_", " ")].default_value = value
    return mat


def _bump(mat: bpy.types.Material, scale: float, strength: float, detail: float = 6.0) -> None:
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    tex.inputs["Roughness"].default_value = 0.55
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.002
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def mat_myocardium() -> bpy.types.Material:
    m = _principled(
        "R_Myocardium", Base_Color=(0.15, 0.02, 0.018, 1), Roughness=0.36, Subsurface_Weight=0.32,
        Subsurface_Radius=(1.0, 0.18, 0.09), Subsurface_Scale=0.012, Coat_Weight=0.55, Coat_Roughness=0.12,
        Sheen_Weight=0.12, Sheen_Tint=(1.0, 0.7, 0.65, 1),
    )
    _bump(m, 55.0, 0.1)
    return m


def mat_coronary(color, glow: float = 0.35) -> bpy.types.Material:
    return _principled(
        f"R_Coronary_{'%.2f%.2f%.2f' % tuple(color)}", Base_Color=(*color, 1), Roughness=0.2,
        Subsurface_Weight=0.15, Subsurface_Radius=(1.0, 0.4, 0.3), Subsurface_Scale=0.006,
        Coat_Weight=1.0, Coat_Roughness=0.04, Emission_Color=(*color, 1), Emission_Strength=glow,
    )


def mat_vessel(name, color, rough=0.35, sss=0.3) -> bpy.types.Material:
    return _principled(
        name, Base_Color=(*color, 1), Roughness=rough, Subsurface_Weight=sss,
        Subsurface_Radius=(1.0, 0.35, 0.25), Subsurface_Scale=0.008, Coat_Weight=0.25, Coat_Roughness=0.15,
    )


def mat_bone() -> bpy.types.Material:
    m = _principled(
        "R_Bone", Base_Color=(0.78, 0.72, 0.60, 1), Roughness=0.55, Subsurface_Weight=0.2,
        Subsurface_Radius=(1.0, 0.8, 0.6), Subsurface_Scale=0.02, Coat_Weight=0.1,
    )
    _bump(m, 120.0, 0.05)
    return m


def mat_cartilage() -> bpy.types.Material:
    return _principled(
        "R_Cartilage", Base_Color=(0.70, 0.76, 0.78, 1), Roughness=0.3, Subsurface_Weight=0.5,
        Subsurface_Radius=(0.8, 0.9, 1.0), Subsurface_Scale=0.02, Coat_Weight=0.4, Coat_Roughness=0.1,
    )


def mat_muscle() -> bpy.types.Material:
    m = _principled(
        "R_Muscle", Base_Color=(0.33, 0.045, 0.04, 1), Roughness=0.45, Subsurface_Weight=0.3,
        Subsurface_Radius=(1.0, 0.25, 0.15), Subsurface_Scale=0.02, Coat_Weight=0.25, Coat_Roughness=0.2,
        Anisotropic=0.3,
    )
    _bump(m, 90.0, 0.1)
    return m


def mat_glass(name, color, rough=0.12, ior=1.33, alpha=1.0) -> bpy.types.Material:
    m = _principled(
        name, Base_Color=(*color, 1), Roughness=rough, IOR=ior, Transmission_Weight=1.0, Alpha=alpha,
        Coat_Weight=0.3, Coat_Roughness=0.05,
    )
    return m


def mat_film(name, color, alpha_face: float, alpha_edge: float, rough: float = 0.25, emission: float = 0.0) -> bpy.types.Material:
    """Translucent tissue film: alpha rises from ``alpha_face`` (facing) to ``alpha_edge`` (grazing).

    Reads as glassy skin / lungs on a dark studio background without the smoky look that true
    refraction produces against a black environment.
    """
    m = _principled(name, Base_Color=(*color, 1), Roughness=rough, Coat_Weight=0.6, Coat_Roughness=0.08,
                    Emission_Color=(*color, 1), Emission_Strength=emission)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.4
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["To Min"].default_value = alpha_face
    rng.inputs["To Max"].default_value = alpha_edge
    nt.links.new(lw.outputs["Facing"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], bsdf.inputs["Alpha"])
    return m


def mat_territory(neutral=(0.075, 0.045, 0.045)) -> bpy.types.Material:
    """Myocardium tinted by COLOR_0 territory weights x the example risk colours."""
    m = mat_myocardium()
    m.name = "R_Territory"
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Territory"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
    # colour = neutral * (1 - sum(w)) + sum(w_i * risk_i)
    acc = nt.nodes.new("ShaderNodeMix")
    acc.data_type = "RGBA"
    acc.blend_type = "MIX"
    acc.inputs["A"].default_value = (*neutral, 1)
    acc.inputs["B"].default_value = (0, 0, 0, 1)
    acc.inputs["Factor"].default_value = 0.0
    last = acc.outputs["Result"]
    emit_last = None
    for ch, key in (("Red", "LAD"), ("Green", "LCX"), ("Blue", "RCA")):
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MIX"
        mix.inputs["B"].default_value = (*(0.42 * c for c in RISK[key]), 1)
        # Sequential blend towards each territory tint by its weight (weights sum to <= 1).
        nt.links.new(last, mix.inputs["A"])
        nt.links.new(sep.outputs[ch], mix.inputs["Factor"])
        last = mix.outputs["Result"]
        emix = nt.nodes.new("ShaderNodeMix")
        emix.data_type = "RGBA"
        emix.blend_type = "ADD"
        emix.inputs["Factor"].default_value = 1.0
        scaled = nt.nodes.new("ShaderNodeMix")
        scaled.data_type = "RGBA"
        scaled.blend_type = "MULTIPLY"
        scaled.inputs["Factor"].default_value = 1.0
        scaled.inputs["B"].default_value = (*RISK[key], 1)
        comb = nt.nodes.new("ShaderNodeCombineColor")
        for c in ("Red", "Green", "Blue"):
            nt.links.new(sep.outputs[ch], comb.inputs[c])
        nt.links.new(comb.outputs["Color"], scaled.inputs["A"])
        if emit_last is None:
            emit_last = scaled.outputs["Result"]
        else:
            nt.links.new(emit_last, emix.inputs["A"])
            nt.links.new(scaled.outputs["Result"], emix.inputs["B"])
            emit_last = emix.outputs["Result"]
    nt.links.new(last, bsdf.inputs["Base Color"])
    nt.links.new(emit_last, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.12
    bsdf.inputs["Subsurface Weight"].default_value = 0.12
    return m


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
        self.rest = {n: o.location.copy() for n, o in self.objects.items()}
        self.base_materials = {n: list(o.data.materials) for n, o in self.objects.items()}
        self.layer_of = {n: o.parent.name for n, o in self.objects.items()}
        self.extra: list[bpy.types.Object] = []

    def reset(self) -> None:
        for n, o in self.objects.items():
            o.location = self.rest[n].copy()
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

    def explode(self, t: float = 1.0, layers_scale: dict | None = None) -> None:
        layer_vec = {layer["node"]: layer["explode"] for layer in self.manifest["layers"]}
        for s in self.manifest["structures"]:
            o = self.objects[s["node"]]
            k = (layers_scale or {}).get(self.layer_of[s["node"]], 1.0)
            off = [k * t * (a + b) for a, b in zip(layer_vec[self.layer_of[s["node"]]], s["explode"])]
            o.location = self.rest[s["node"]] + gltf_to_blender(off)

    def cropped_copy(
        self, name: str, *, radius: float | None = None, center=(0, 0, 0), z_min: float | None = None,
        keep_largest: bool = False,
    ) -> bpy.types.Object:
        """Render-only copy of a vessel clipped to a sphere and/or above a height (Blender Z).

        Used to hide far intrapulmonary branches and the abdominal run of the aorta / IVC in
        close-ups; the exported asset is never modified.
        """
        src = self.objects[name]
        ob = src.copy()
        ob.data = src.data.copy()
        ob["ct_extra"] = True  # render-only geometry, removed by Anatomy.reset()
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = None
        ob.matrix_world = src.matrix_world.copy()
        cutters = []
        if radius is not None:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=radius, location=center)
            cutters.append(bpy.context.active_object)
        if z_min is not None:
            bpy.ops.mesh.primitive_cube_add(size=20.0, location=(0.0, 0.0, z_min + 10.0))
            cutters.append(bpy.context.active_object)
        for cutter in cutters:
            mod = ob.modifiers.new("clip", "BOOLEAN")
            mod.operation = "INTERSECT"
            mod.solver = "EXACT"
            mod.object = cutter
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
        ob.modifiers.clear()
        ob.data = me
        for cutter in cutters:
            bpy.data.objects.remove(cutter, do_unlink=True)
        if keep_largest:
            keep_largest_island(me)
        self.extra.append(ob)
        src.hide_render = True
        return ob


def keep_largest_island(me: bpy.types.Mesh) -> None:
    """Delete every connected piece of a mesh except the largest (drops clipped-off fragments)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    seen: set = set()
    best: list = []
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
        if len(island) > len(best):
            best = island
    keep = set(best)
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
        ob["ct_extra"] = True  # render-only geometry, removed by Anatomy.reset()
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


# ============================================================================================
# Shots
# ============================================================================================
def style_heart(an: Anatomy, *, close_up: bool = True, glow: dict | None = None) -> None:
    """Studio look for the heart: dark wet myocardium, muted great vessels, risk-coloured coronaries.

    ``close_up`` stages the heart on its own (see below); the torso shots keep every vessel.
    """
    glow = glow or {"LAD": 1.1, "LCX": 0.9, "RCA": 0.7}
    myo = mat_myocardium()
    for n in ("Heart_Wall_Anterior", "Heart_Wall_Posterior", "Papillary_Muscles"):
        assign(an.objects[n], myo)
    valve = _principled("R_Valve", Base_Color=(0.78, 0.66, 0.54, 1), Roughness=0.35, Subsurface_Weight=0.5,
                        Subsurface_Radius=(1, 0.7, 0.5), Subsurface_Scale=0.006, Coat_Weight=0.4)
    for n in ("Valve_Mitral", "Valve_Tricuspid", "Valve_Pulmonary"):
        assign(an.objects[n], valve)
    # Great vessels stay deep and semi-matt so the risk-coloured coronaries own the frame: oxygenated
    # arterial red for the aorta, desaturated venous blue for the pulmonary trunk.
    assign(an.objects["GreatVessel_Aorta"], mat_vessel("R_Aorta", (0.20, 0.035, 0.03), rough=0.48, sss=0.2))
    assign(an.objects["GreatVessel_PulmonaryArtery"], mat_vessel("R_PA", (0.045, 0.06, 0.13), rough=0.48, sss=0.2))
    assign(an.objects["GreatVessel_PulmonaryVeins"], mat_vessel("R_PV", (0.24, 0.06, 0.06), rough=0.32))
    for n in ("GreatVessel_SVC", "GreatVessel_IVC"):
        assign(an.objects[n], mat_vessel("R_Cava", (0.08, 0.05, 0.09), rough=0.3))
    assign(an.objects["CardiacVeins"], mat_vessel("R_Vein", (0.07, 0.05, 0.13), rough=0.28))
    for n, o in an.objects.items():
        if an.layer_of[n] == "Layer_Coronary":
            group = GROUP_OF.get(n)
            assign(o, mat_coronary(RISK[group] if group else NEUTRAL_ARTERY, glow=glow[group] if group else 0.1))
    if close_up:
        # Close-up staging: the intrapulmonary vein tree and the IVC stub are hidden, the pulmonary
        # artery is clipped around its bifurcation, and the descending aorta is cut at mid-heart height
        # so its end stays hidden behind the atria. Render-only copies; the asset is untouched.
        for n in ("GreatVessel_PulmonaryVeins", "GreatVessel_IVC"):
            an.objects[n].hide_render = True
        aorta = an.cropped_copy("GreatVessel_Aorta", z_min=0.05)
        assign(aorta, an.objects["GreatVessel_Aorta"].data.materials[0])
        # Pulmonary trunk with short stubs of the right / left pulmonary arteries.
        valve = an.objects["Valve_Pulmonary"].location
        pa = an.cropped_copy("GreatVessel_PulmonaryArtery", radius=0.42, keep_largest=True,
                             center=(valve.x - 0.02, valve.y + 0.2, valve.z + 0.3))
        assign(pa, an.objects["GreatVessel_PulmonaryArtery"].data.materials[0])


HERO_TARGET = (0.1, -0.05, 0.24)
#: Left-anterior-oblique, slightly cranial: LAD centre-frame, RCA on the right border, whole arch in frame.
HERO_VIEW = (30.0, 7.0, 6.4)  # azimuth, elevation (deg), distance


def hero_rig(scene) -> None:
    target = Vector(HERO_TARGET)
    az, el, dist = HERO_VIEW
    camera("CamHero", orbit(target, az, el, dist), target, lens=70, fstop=5.6, focus=(0.3, -0.45, 0.0))
    area_light("Key", (-1.5, -4.6, 3.6), target, power=560, size=2.4, color=(1.0, 0.93, 0.86))
    area_light("Rim", (2.8, 3.2, 2.6), target, power=1200, size=1.4, color=(0.55, 0.75, 1.0))
    area_light("Kicker", (-3.4, 1.8, -0.8), target, power=220, size=2.2, color=(1.0, 0.55, 0.45))
    area_light("Under", (2.0, -1.5, -3.6), target, power=120, size=3.0, color=(0.6, 0.75, 1.0))
    area_light("Fill", (4.6, -1.2, 0.8), target, power=110, size=3.5, color=(0.7, 0.8, 1.0))


def shot_hero_heart(scene, an: Anatomy, out: Path) -> None:
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
    style_heart(an)
    setup_world(scene, top=(0.010, 0.013, 0.02), bottom=(0.0008, 0.0008, 0.0012))
    hero_rig(scene)
    compositor_glow(scene, strength=0.55, threshold=0.7, size=0.55, vignette=0.45)
    render_to(scene, out / "hero_heart.jpg")


def orbit(target: Vector, azimuth_deg: float, elevation_deg: float, distance: float) -> Vector:
    """Camera position around ``target``: azimuth 0 = anterior (-Y), positive towards patient-left (+X)."""
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    return target + distance * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


EXPLODE_VIEW = (0.0, 8.0, 9.6)  # azimuth, elevation (deg), distance
EXPLODE_TARGET = (-0.1, 0.32, 0.3)  # glTF frame
EXPLODE_LENS = 50.0  # replaced by the manifest's vertical field of view


def shot_exploded(scene, an: Anatomy, out: Path) -> None:
    an.show_only(layers=LAYERS)
    style_heart(an, close_up=False)
    assign(an.objects["Skin_Torso"], mat_film("R_Skin", (0.70, 0.50, 0.42), 0.012, 0.32))
    for n in ("Pectoralis_L", "Pectoralis_R", "Diaphragm"):
        assign(an.objects[n], mat_muscle())
    bone = mat_bone()
    for n in ("Ribs_L", "Ribs_R", "Sternum", "Clavicle_L", "Clavicle_R", "Spine_Thoracic"):
        assign(an.objects[n], bone)
    assign(an.objects["CostalCartilage"], mat_cartilage())
    lung = mat_film("R_Lung", (0.90, 0.46, 0.50), 0.06, 0.6, rough=0.2)
    for n in ("Lung_L", "Lung_R"):
        assign(an.objects[n], lung)
    assign(an.objects["Trachea_Bronchi"], _principled("R_Airway", Base_Color=(0.42, 0.34, 0.30, 1), Roughness=0.45,
                                                       Subsurface_Weight=0.3, Subsurface_Scale=0.01, Coat_Weight=0.3))
    an.explode(1.0)
    # The skin is an enclosing shell: any translation sweeps it through the organs, so the viewer fades
    # it out when it peels — the render leaves it out too.
    an.objects["Skin_Torso"].hide_render = True
    setup_world(scene, top=(0.02, 0.024, 0.034), bottom=(0.002, 0.002, 0.003))
    # The head-on view the radial layout is designed for (like the viewer's `camera.exploded` preset),
    # cropped to the thorax — the diaphragm and costal margin run off the bottom edge — so the opened
    # heart stays prominent.
    az, el, dist = EXPLODE_VIEW
    target = gltf_to_blender(EXPLODE_TARGET)
    cam = camera("CamExplode", orbit(target, az, el, dist), target, lens=EXPLODE_LENS)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(an.manifest["camera"]["exploded"]["fov"])
    area_light("Key", orbit(target, -35.0, 50.0, 14.0), target, power=4200, size=7, color=(1.0, 0.95, 0.9))
    area_light("Rim", orbit(target, 160.0, 25.0, 12.0), target, power=8000, size=5, color=(0.6, 0.78, 1.0))
    area_light("Fill", orbit(target, 80.0, 5.0, 12.0), target, power=1400, size=8, color=(0.8, 0.85, 1.0))

    compositor_glow(scene, strength=0.25, threshold=1.2, size=0.6, vignette=0.35)
    render_to(scene, out / "exploded_torso.jpg")


def shot_territories(scene, an: Anatomy, out: Path, samples: int) -> None:
    """Heart walls tinted by COLOR_0 territory weights x risk colours, anterior + posterior-inferior."""
    style_heart(an, glow={"LAD": 0.8, "LCX": 0.8, "RCA": 0.8})
    an.show_only(nodes=("Heart_Wall_Anterior", "Heart_Wall_Posterior"), layers=("Layer_Coronary",))
    for ob in an.extra:
        ob.hide_render = True
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
    """Compose two half-width renders into one image using Blender's image API."""
    import numpy as np

    a = bpy.data.images.load(str(left))
    b = bpy.data.images.load(str(right))
    pa = np.array(a.pixels[:]).reshape(a.size[1], a.size[0], 4)
    pb = np.array(b.pixels[:]).reshape(b.size[1], b.size[0], 4)
    combo = np.concatenate([pa, pb], axis=1)
    img = bpy.data.images.new("territories", width=combo.shape[1], height=combo.shape[0])
    img.pixels = combo.ravel().tolist()
    img.filepath_raw = str(dest)
    img.file_format = "JPEG"
    scene = bpy.context.scene
    img.save_render(str(dest), scene=scene)
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
    looks = {
        "Layer_Skin": mat_hologram("H_Skin", cyan, rim=0.9, power=3.0),
        "Layer_Muscle": mat_hologram("H_Muscle", (0.25, 0.5, 1.0), rim=0.22, power=2.5),
        "Layer_Skeleton": mat_hologram("H_Bone", (0.7, 0.85, 1.0), rim=0.26, core=0.008, power=2.4),
        "Layer_Lungs": mat_hologram("H_Lung", (0.2, 0.5, 1.0), rim=0.28, power=2.2),
        "Layer_Diaphragm": mat_hologram("H_Diaphragm", (0.2, 0.45, 0.9), rim=0.18, power=2.2),
        "Layer_Heart": mat_hologram("H_Heart", (1.0, 0.32, 0.28), rim=0.75, core=0.012, power=2.0),
    }
    vessels_look = mat_hologram("H_Vessels", (0.9, 0.3, 0.32), rim=0.32, core=0.005, power=2.0)
    for n, o in an.objects.items():
        layer = an.layer_of[n]
        if layer == "Layer_Coronary":
            group = GROUP_OF.get(n)
            # Moderate strength keeps the hue: AgX desaturates very bright emitters towards white.
            assign(o, mat_emissive(f"H_{n}", RISK[group] if group else (1.0, 0.55, 0.5), 4.0 if group else 2.4))
        elif n.startswith("GreatVessel_") or n == "CardiacVeins":
            assign(o, vessels_look)
        else:
            assign(o, looks[layer])
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
    style_heart(an)
    setup_world(scene, top=(0.010, 0.013, 0.02), bottom=(0.0008, 0.0008, 0.0012))
    pivot = bpy.data.objects.new("Turntable", None)
    pivot["ct_rig"] = True
    scene.collection.objects.link(pivot)
    moving = [o for n, o in an.objects.items() if not o.hide_render] + [o for o in an.extra if not o.hide_render]
    parents = {o.name: (o.parent, o.matrix_world.copy()) for o in moving}
    for o in moving:
        mw = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = mw
    target = Vector((0.1, 0.0, 0.18))
    camera("CamTurn", (0.1, -6.2, 1.1), target, lens=58)
    area_light("Key", (-2.8, -3.6, 3.4), target, power=950, size=2.6, color=(1.0, 0.94, 0.88))
    area_light("Rim", (2.4, 3.2, 2.2), target, power=1400, size=1.6, color=(0.62, 0.8, 1.0))
    area_light("Fill", (3.6, -2.2, -1.2), target, power=200, size=3.5, color=(0.75, 0.82, 1.0))
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
    if frames:  # quick timing / look tests
        scene.frame_end = min(scene.frame_end, frames)
    scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    compositor_glow(scene, strength=0.3, threshold=1.0, size=0.6, vignette=0.35)
    path = out / "heart_turntable.mp4"
    scene.render.filepath = str(path)
    t = time.perf_counter()
    bpy.ops.render.render(animation=True)
    log(f"wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB, {time.perf_counter() - t:.0f}s)")
    for o in moving:
        parent, mw = parents[o.name]
        o.parent = parent
        o.matrix_world = mw
    scene.render.image_settings.media_type = "IMAGE"
    scene.render.image_settings.file_format = "JPEG"


def _fcurves(ob):
    ad = ob.animation_data
    if ad is None or ad.action is None:
        return []
    action = ad.action
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    # Blender 5.x layered actions
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
    ap.add_argument("--shots", default="hero_heart,exploded_torso,territories,xray,turntable")
    ap.add_argument("--samples", type=int, default=256)
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
    an = Anatomy(manifest)

    for shot in args.shots.split(","):
        setup_cycles(scene, args.samples, args.scale)
        an.reset()
        log(f"--- {shot}")
        if shot == "hero_heart":
            shot_hero_heart(scene, an, out)
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
        shot_hero_heart_rig_only(scene, an)
        bpy.ops.wm.save_as_mainfile(filepath=str(SCENE_BLEND), compress=True)
        mb = SCENE_BLEND.stat().st_size / 1e6
        if mb > MAX_SCENE_MB:
            SCENE_BLEND.unlink()
            log(f"scene is {mb:.1f} MB (> {MAX_SCENE_MB} MB) — not saved")
        else:
            log(f"saved {SCENE_BLEND} ({mb:.1f} MB)")


def shot_hero_heart_rig_only(scene, an: Anatomy) -> None:
    """Leave the hero-heart look (materials, lights, camera) set up in the saved scene."""
    an.show_only(layers=("Layer_Heart", "Layer_Coronary"))
    style_heart(an)
    setup_world(scene, top=(0.010, 0.013, 0.02), bottom=(0.0008, 0.0008, 0.0012))
    hero_rig(scene)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
