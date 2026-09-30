"""Web-fidelity preview: the FINAL published GLB, rendered in EEVEE with only its baked textures.

    blender --background --factory-startup --python anatomy/blender/render_web_preview.py -- [--scale 1.0]

1. ``anatomy/scripts/decode_for_blender.mjs`` writes a plain copy of ``frontend/public/anatomy/cardiotwin_anatomy.glb``
   (meshopt decoded, attributes dequantised, WebP textures losslessly re-encoded as PNG: Blender's importer reads
   neither meshopt nor WebP);
2. the copy is imported into an empty scene: every material is the glTF material with its baked baseColor,
   normal and occlusion/roughness maps; nothing procedural is added;
3. the coronary arteries are recoloured with the example risk profile, exactly as the viewer does in its
   Realistic look (they carry no textures); the pulmonary-vein tree is hidden and the pulmonary artery,
   descending aorta and arch branches are trimmed like the hero shot, so the two images compare 1:1;
4. EEVEE renders ``docs/media/renders/web_preview.jpg`` from the hero camera with the hero lights.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))
import render_heroes as rh  # noqa: E402
from common import ANATOMY_DIR, PUBLIC_DIR, RENDER_DIR  # noqa: E402


def decode(glb: Path, out: Path) -> None:
    node = shutil.which("node") or "node"
    subprocess.run([node, str(ANATOMY_DIR / "scripts" / "decode_for_blender.mjs"), str(glb), str(out)], check=True, cwd=ANATOMY_DIR)


def bisect_keep(ob, co, no) -> None:
    """Delete the part of a mesh on the +normal side of a plane (world frame) and close nothing (render only)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    M = ob.matrix_world
    Mi = M.inverted()
    co_l = Mi @ Vector(co)
    no_l = (Mi.to_3x3().transposed() @ Vector(no)).normalized()
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=co_l, plane_no=no_l,
                           clear_outer=True)
    bm.to_mesh(me)
    bm.free()


def keep_sphere(ob, centre, radius, largest: bool = True) -> None:
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    M = ob.matrix_world
    doomed = [v for v in bm.verts if ((M @ v.co) - Vector(centre)).length > radius]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    if largest:
        rh.keep_largest_island(me)


def keep_attribute_below(ob, name: str, limit: float) -> None:
    """Delete vertices whose per-vertex attribute (e.g. _DIST_HEART, imported from the GLB) exceeds ``limit``."""
    me = ob.data
    attr = me.attributes.get(name) or me.attributes.get(name.lower())
    if attr is None:
        print(f"[web_preview] {ob.name}: attribute {name} not found ({[a.name for a in me.attributes]})")
        return
    vals = np.empty(len(me.vertices), dtype=np.float32)
    attr.data.foreach_get("value", vals)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if vals[v.index] > limit], context="VERTS")
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bm.to_mesh(me)
    bm.free()
    rh.keep_largest_island(me)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_web_preview.py")
    ap.add_argument("--glb", default=str(PUBLIC_DIR / "cardiotwin_anatomy.glb"))
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--out", default=str(RENDER_DIR / "web_preview.jpg"))
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    tmp = Path(tempfile.mkdtemp(prefix="ct_webprev_"))
    plain = tmp / "cardiotwin_plain.glb"
    decode(Path(args.glb), plain)
    bpy.ops.import_scene.gltf(filepath=str(plain))
    scene = bpy.context.scene
    obs = {o.name: o for o in scene.objects if o.type == "MESH"}
    heart_layers = ("Layer_Heart", "Layer_Coronary")

    def layer_of(o):
        p = o.parent
        while p is not None and not p.name.startswith("Layer_"):
            p = p.parent
        return p.name if p else ""

    for name, o in obs.items():
        o.hide_render = layer_of(o) not in heart_layers
    for n in ("GreatVessel_PulmonaryVeins", "GreatVessel_IVC"):
        if n in obs:
            obs[n].hide_render = True
    # same staging as the hero shot (render_heroes.Anatomy.stage_heart)
    if "GreatVessel_Aorta" in obs:
        bisect_keep(obs["GreatVessel_Aorta"], (0, 0, 0.02), (0, 0, -1))
    if "GreatVessel_PulmonaryArtery" in obs and "Valve_Pulmonary" in obs:
        c = obs["Valve_Pulmonary"].matrix_world.translation
        rh.sphere_clip(obs["GreatVessel_PulmonaryArtery"], (c.x - 0.02, c.y + 0.2, c.z + 0.3), 0.42)
        rh.keep_largest_island(obs["GreatVessel_PulmonaryArtery"].data)
    if "GreatVessel_Aorta" in obs:
        ao = obs["GreatVessel_Aorta"]
        top = max((ao.matrix_world @ v.co).z for v in ao.data.vertices)
        arch = ao.matrix_world.translation
        for n in ("GreatVessel_Aorta_ArchBranches", "GreatVessel_SVC_BrachiocephalicVeins"):
            if n in obs:
                bisect_keep(obs[n], (0, 0, top + 0.10), (0, 0, 1))
                rh.sphere_clip(obs[n], (arch.x - 0.05, arch.y, top - 0.1), 0.62)
                rh.keep_largest_island(obs[n].data, min_fraction=0.2)
    # glTF COLOR_0 on the heart walls is territory DATA (LAD/LCX/RCA weights), not a tint: the viewer never
    # multiplies it into the albedo, so neither does the preview
    for o in obs.values():
        for mat in o.data.materials:
            if mat and mat.node_tree:
                bsdf = next((nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED"), None)
                tex = next((nd for nd in mat.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.image and "_base" in nd.image.name), None)
                if bsdf is not None and tex is not None:
                    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # coronary arteries: the viewer's risk ramp (risk.ts, OKLab) for the example profile, as its Realistic look (untextured nodes)
    for name, o in obs.items():
        if not name.startswith("Coronary_"):
            continue
        group = rh.GROUP_OF.get(name)
        color = rh.RISK[group] if group else rh.LM_COLOR
        mat = bpy.data.materials.new(f"Risk_{name}")
        mat.use_nodes = True
        bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.32
        bsdf.inputs["Coat Weight"].default_value = 0.5
        bsdf.inputs["Coat Roughness"].default_value = 0.08
        o.data.materials.clear()
        o.data.materials.append(mat)

    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    ee = scene.eevee
    for attr, val in (("taa_render_samples", args.samples), ("use_raytracing", True), ("use_shadows", True),
                      ("shadow_ray_count", 2), ("shadow_step_count", 8)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    scene.render.resolution_x = int(1920 * args.scale)
    scene.render.resolution_y = int(1080 * args.scale)
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    rh.setup_world(scene, **rh.STUDIO_WORLD)
    t = Vector(rh.HERO_TARGET)
    az, el, dist = rh.HERO_VIEW
    rh.camera("CamHero", rh.orbit(t, az, el, dist), t, lens=70)
    rh.studio_rig(t, key_dir=(-40.0, 38.0), rim_dir=(160.0, 30.0), fill_dir=(75.0, 5.0), dist=5.0)
    rh.compositor_glow(scene, strength=0.25, threshold=1.0, size=0.5, vignette=0.4)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[web_preview] wrote {out} ({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
