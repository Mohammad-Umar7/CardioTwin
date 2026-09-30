"""Stage 4a — bake the photoreal tissue looks into web textures (Cycles).

Run after the Blender build (needs ``anatomy/build/cardiotwin_build.blend`` with UVs)::

    blender --background --factory-startup --python anatomy/blender/bake_textures.py -- [--nodes A,B] [--scale 1.0]

For every textured node (everything except the coronary arteries, which the viewer recolours by risk) the
procedural look from ``looks.py`` is baked into three PNG maps in ``anatomy/build/bake/``:

* ``<node>_base.png``   — albedo (sRGB): the look's base colour, rerouted to an emission shader and baked;
* ``<node>_normal.png`` — tangent-space normal map of the look's micro-relief (fibres, lobules, pores...);
* ``<node>_orm.png``    — glTF occlusion / roughness / metallic: R = ambient occlusion of the node on its own
  (it must stay valid when the viewer explodes the layers apart), G = roughness, B = 0.

``optimize_glb.mjs`` encodes them as WebP (EXT_texture_webp) and attaches them to each node's material.
``bake_manifest.json`` lists the maps and their sizes.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))
import looks  # noqa: E402
from common import BAKE_DIR, BUILD_BLEND, BUILD_REPORT, read_json, write_json  # noqa: E402

T0 = time.perf_counter()
LAYERS = ("Layer_Skin", "Layer_Muscle", "Layer_Skeleton", "Layer_Lungs", "Layer_Diaphragm", "Layer_Heart")

#: Texture sizes (base, normal, orm) per node; everything else gets DEFAULT_SIZE. Budgets: GLB <= 16 MB and <= 128 MiB
#: of GPU memory once decoded (RGBA8 + mips); optimize_glb.mjs drops normal maps that carry no relief and ORM maps
#: that are uniform, and asserts the GPU total. The heart walls carry the detail (2048 albedo); the ghosted outer
#: layers only reach ~1.5 texels/mm on screen, so 512 is enough there.
SIZES = {
    "Heart_Wall_Anterior": (2048, 1024, 512),
    "Heart_Wall_Posterior": (2048, 1024, 512),
    "EpicardialFat_Anterior": (512, 1024, 256),
    "EpicardialFat_Posterior": (512, 1024, 256),
    "GreatVessel_Aorta": (1024, 512, 256),
    "GreatVessel_PulmonaryArtery": (512, 512, 256),
    "GreatVessel_PulmonaryVeins": (512, 256, 256),
    "CardiacVeins": (512, 512, 256),
    "Papillary_Muscles": (512, 256, 256),
    "Valve_Mitral": (512, 256, 256),
    "Valve_Tricuspid": (512, 256, 256),
    "Valve_Aortic": (512, 256, 256),
    "Valve_Pulmonary": (512, 256, 256),
    "Lung_L": (512, 512, 256),
    "Lung_R": (512, 512, 256),
    "Pectoralis_L": (512, 256, 256),
    "Pectoralis_R": (512, 256, 256),
}
DEFAULT_SIZE = (512, 256, 128)
MARGIN_PX = 6


def log(msg: str) -> None:
    print(f"[bake {time.perf_counter() - T0:7.1f}s] {msg}", flush=True)


def setup_cycles(scene, samples: int) -> None:
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
                log(f"cycles on {backend}")
                break
        except TypeError:
            continue
    else:
        scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.seed = 0
    scene.render.bake.margin = MARGIN_PX
    scene.render.bake.margin_type = "EXTEND"
    scene.render.bake.use_clear = False  # keep the alpha-0 prefill: baked texels come back with alpha 1
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = 0.04  # AO reach 4 cm: crevices and grooves, not whole cavities


def new_image(name: str, size: int, *, color: bool) -> bpy.types.Image:
    """Bake target; alpha starts at 0 so the texels outside the UV islands can be told apart afterwards."""
    img = bpy.data.images.new(name, width=size, height=size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    img.pixels.foreach_set(np.zeros(size * size * 4, dtype=np.float32))  # alpha 0 = not baked
    return img


def fill_background(img: bpy.types.Image, value=None) -> np.ndarray:
    """Fill texels outside the baked islands (+ margin) with ``value`` or the mean baked colour, so mip-maps
    of island borders never average towards black; returns the RGBA array (alpha = 1).

    The baked result is read back through a PNG round trip: ``Image.pixels`` still returns the pre-bake
    buffer right after ``bpy.ops.object.bake``."""
    tmp = BAKE_DIR / f"_{img.name}.png"
    save_png(img, tmp)
    back = bpy.data.images.load(str(tmp))
    back.colorspace_settings.name = img.colorspace_settings.name
    px = pixels(back)
    bpy.data.images.remove(back)
    tmp.unlink()
    baked = px[..., 3] > 0.5
    fill = np.array(value if value is not None else (px[baked, :3].mean(axis=0) if baked.any() else (0.5, 0.5, 0.5)))
    px[~baked, :3] = fill
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    return px


def image_node(mat: bpy.types.Material, img: bpy.types.Image):
    nt = mat.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    return node


def emission_route(mat: bpy.types.Material, input_name: str):
    """Temporarily feed the BSDF input ``input_name`` into an emission shader on the material output."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    sock = bsdf.inputs[input_name]
    if sock.is_linked:
        nt.links.new(sock.links[0].from_socket, emit.inputs["Color"])
    else:
        v = sock.default_value
        emit.inputs["Color"].default_value = (v, v, v, 1.0) if isinstance(v, float) else tuple(v)
    link = nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return emit, link, bsdf, out


def restore(mat, emit, bsdf, out) -> None:
    nt = mat.node_tree
    nt.nodes.remove(emit)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])


def pixels(img: bpy.types.Image) -> np.ndarray:
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save_png(img: bpy.types.Image, path: Path) -> None:
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()


def bake_node(ob: bpy.types.Object, scene, sizes, out_dir: Path, samples_ao: int) -> dict:
    category = ob.get("ct_category", "")
    mat = looks.look_for(category, ob.name)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for o in scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    s_base, s_norm, s_orm = sizes
    files = {}

    # base colour (emission trick: exact albedo, no lighting)
    img = new_image(f"{ob.name}_base", s_base, color=True)
    tex = image_node(mat, img)
    emit, _, bsdf, out = emission_route(mat, "Base Color")
    scene.cycles.samples = 4
    bpy.ops.object.bake(type="EMIT")
    restore(mat, emit, bsdf, out)
    fill_background(img)
    save_png(img, out_dir / f"{ob.name}_base.png")
    files["base"] = f"{ob.name}_base.png"
    mat.node_tree.nodes.remove(tex)

    # roughness (baked at the ORM size)
    rough = new_image(f"{ob.name}_rough", s_orm, color=False)
    tex = image_node(mat, rough)
    emit, _, bsdf, out = emission_route(mat, "Roughness")
    bpy.ops.object.bake(type="EMIT")
    restore(mat, emit, bsdf, out)
    mat.node_tree.nodes.remove(tex)

    # ambient occlusion of the node on its own (other nodes hidden)
    hidden = [o for o in scene.objects if o.type == "MESH" and o is not ob and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    ao = new_image(f"{ob.name}_ao", s_orm, color=False)
    tex = image_node(mat, ao)
    scene.cycles.samples = samples_ao
    bpy.ops.object.bake(type="AO")
    for o in hidden:
        o.hide_render = False
    mat.node_tree.nodes.remove(tex)

    # tangent-space normal map of the micro-relief
    nimg = new_image(f"{ob.name}_normal", s_norm, color=False)
    tex = image_node(mat, nimg)
    scene.cycles.samples = 4
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    fill_background(nimg, (0.5, 0.5, 1.0))
    save_png(nimg, out_dir / f"{ob.name}_normal.png")
    files["normal"] = f"{ob.name}_normal.png"
    mat.node_tree.nodes.remove(tex)

    # ORM = (AO, roughness, metallic 0); AO softened towards 1 so it only darkens real crevices
    a = fill_background(ao, (1.0, 1.0, 1.0))
    r = fill_background(rough)
    orm = new_image(f"{ob.name}_orm", s_orm, color=False)
    px = np.zeros_like(a)
    px[..., 0] = 0.25 + 0.75 * a[..., 0]
    px[..., 1] = r[..., 0]
    px[..., 2] = 0.0
    px[..., 3] = 1.0
    orm.pixels.foreach_set(px.ravel())
    save_png(orm, out_dir / f"{ob.name}_orm.png")
    files["orm"] = f"{ob.name}_orm.png"
    for im in (img, rough, ao, nimg, orm):
        bpy.data.images.remove(im)
    return {"files": files, "size": {"base": s_base, "normal": s_norm, "orm": s_orm}, "look": category,
            "mean_roughness": round(float(r[..., 0].mean()), 3)}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="bake_textures.py")
    ap.add_argument("--nodes", default="", help="comma-separated subset (default: every textured node)")
    ap.add_argument("--scale", type=float, default=1.0, help="texture size scale (0.5 for drafts)")
    ap.add_argument("--ao-samples", type=int, default=48)
    args = ap.parse_args(argv)

    bpy.ops.wm.open_mainfile(filepath=str(BUILD_BLEND))
    scene = bpy.context.scene
    setup_cycles(scene, 4)
    rep = read_json(BUILD_REPORT)
    base = looks.gltf_to_blender(rep["heart"]["base_center"])
    apex = looks.gltf_to_blender(rep["heart"]["apex"])
    looks.ensure_heart_frame(base, apex)
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    wanted = set(filter(None, args.nodes.split(",")))
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.parent and o.parent.name in LAYERS
            and o.data.uv_layers and (not wanted or o.name in wanted)]
    manifest_path = BAKE_DIR / "bake_manifest.json"
    manifest = read_json(manifest_path) if (wanted and manifest_path.exists()) else {"nodes": {}}
    for ob in sorted(objs, key=lambda o: o.name):
        sizes = tuple(max(64, int(s * args.scale)) for s in SIZES.get(ob.name, DEFAULT_SIZE))
        t = time.perf_counter()
        manifest["nodes"][ob.name] = bake_node(ob, scene, sizes, BAKE_DIR, args.ao_samples)
        log(f"{ob.name:36s} {sizes} {time.perf_counter() - t:5.1f}s")
    manifest["looks"] = "anatomy/blender/looks.py"
    manifest["orm"] = "R = ambient occlusion (self-occlusion only, 0.25 + 0.75 * AO), G = roughness, B = metallic (0)"
    write_json(manifest_path, manifest)
    log(f"wrote {manifest_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
