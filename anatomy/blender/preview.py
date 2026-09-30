"""Quick QA renders of the built anatomy (Workbench engine, a few seconds per view).

Run after ``build_anatomy.py``::

    blender --background --factory-startup --python anatomy/blender/preview.py -- [--views torso,heart] [--out DIR]

Writes PNGs to ``anatomy/build/preview/`` (git-ignored). These are for inspecting geometry,
cropping, the heart cut and the territory colours — the portfolio renders are ``render_heroes.py``.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
from common import BUILD_BLEND, BUILD_DIR  # noqa: E402

LAYERS_ALL = ("Layer_Skin", "Layer_Muscle", "Layer_Skeleton", "Layer_Lungs", "Layer_Diaphragm", "Layer_Heart", "Layer_Coronary")


def set_visible(layers: tuple[str, ...], hide_nodes: tuple[str, ...] = ()) -> None:
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        visible = ob.parent is not None and ob.parent.name in layers and ob.name not in hide_nodes
        ob.hide_render = not visible


def camera(scene, loc, look_at, lens=50.0, ortho: float | None = None):
    cam = scene.camera
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam.data.ortho_scale = ortho


def render(scene, out: Path, name: str) -> None:
    scene.render.filepath = str(out / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BUILD_DIR / "preview"))
    ap.add_argument("--views", default="all")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    views = None if args.views == "all" else set(args.views.split(","))

    bpy.ops.wm.open_mainfile(filepath=str(BUILD_BLEND))
    scene = bpy.context.scene
    cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
    cam.data.clip_start, cam.data.clip_end = 0.01, 1000
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 1050
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_specular_highlight = True
    scene.display.render_aa = "16"

    def want(v: str) -> bool:
        return views is None or v in views

    if want("torso"):
        set_visible(LAYERS_ALL)
        sh.show_xray = False
        camera(scene, (0, -12, 0.2), (0, 0, 0.2), ortho=5.4)
        render(scene, out, "torso_front")
        camera(scene, (9, -8, 3), (0, 0, 0.1), lens=55)
        render(scene, out, "torso_oblique")
        camera(scene, (0, 12, 0.2), (0, 0, 0.2), ortho=5.4)
        render(scene, out, "torso_back")
        set_visible(LAYERS_ALL, hide_nodes=("Skin_Torso",))
        camera(scene, (0, -12, 0.2), (0, 0, 0.2), ortho=5.4)
        render(scene, out, "torso_noskin")
        set_visible(("Layer_Skeleton", "Layer_Heart", "Layer_Coronary", "Layer_Diaphragm"))
        render(scene, out, "skeleton_heart")
    if want("heart"):
        set_visible(("Layer_Heart", "Layer_Coronary"))
        camera(scene, (0, -12, 0), (0.15, 0, 0), ortho=1.6)
        render(scene, out, "heart_front")
        camera(scene, (0, 12, 0), (0.15, 0, 0), ortho=1.6)
        render(scene, out, "heart_back")
        camera(scene, (2.6, -3.2, 1.2), (0.1, 0, 0), lens=60)
        render(scene, out, "heart_oblique")
        camera(scene, (0.3, -0.8, -5.5), (0.15, 0, 0), lens=60)
        render(scene, out, "heart_inferior")
        set_visible(("Layer_Coronary",))
        camera(scene, (0, -12, 0), (0.15, 0, 0), ortho=1.4)
        render(scene, out, "coronary_front")
        camera(scene, (0, 12, 0), (0.15, 0, 0), ortho=1.4)
        render(scene, out, "coronary_back")
    if want("open"):
        set_visible(("Layer_Heart",), hide_nodes=("GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins", "GreatVessel_SVC", "GreatVessel_IVC", "CardiacVeins"))
        ant, post = bpy.data.objects["Heart_Wall_Anterior"], bpy.data.objects["Heart_Wall_Posterior"]
        a0, p0 = ant.location.copy(), post.location.copy()
        ant.location.y -= 0.9
        post.location.y += 0.9
        camera(scene, (4.0, -3.0, 1.5), (0.1, 0, 0), lens=45)
        render(scene, out, "heart_open_oblique")
        ant.location.y -= 0.0
        camera(scene, (0, -9, 0), (0.1, 0, 0), lens=60)
        post_only = ("Layer_Heart",)
        set_visible(post_only, hide_nodes=("Heart_Wall_Anterior", "GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins", "GreatVessel_SVC", "GreatVessel_IVC", "CardiacVeins"))
        render(scene, out, "heart_open_posterior_half")
        set_visible(post_only, hide_nodes=("Heart_Wall_Posterior", "GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins", "GreatVessel_SVC", "GreatVessel_IVC", "CardiacVeins"))
        camera(scene, (0, 9, 0), (0.1, 0, 0), lens=60)
        render(scene, out, "heart_open_anterior_half")
        ant.location, post.location = a0, p0
    if want("territory"):
        sh.color_type = "VERTEX"
        set_visible(("Layer_Heart",), hide_nodes=tuple(o.name for o in bpy.data.objects if o.parent and o.parent.name == "Layer_Heart" and not o.name.startswith("Heart_Wall")))
        camera(scene, (0, -12, 0), (0.15, 0, 0), ortho=1.6)
        render(scene, out, "territory_front")
        camera(scene, (0, 12, 0), (0.15, 0, 0), ortho=1.6)
        render(scene, out, "territory_back")
        camera(scene, (0.3, -0.8, -5.5), (0.15, 0, 0), lens=60)
        render(scene, out, "territory_inferior")
        camera(scene, (5.5, -1.0, 0.4), (0.15, 0, 0), lens=60)
        render(scene, out, "territory_left")
        sh.color_type = "MATERIAL"
    print(f"[preview] wrote {out}")


if __name__ == "__main__":
    main()
