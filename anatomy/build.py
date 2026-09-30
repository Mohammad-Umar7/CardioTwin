"""CardioTwin anatomy pipeline — one entry point for every stage.

    ./.venv/Scripts/python anatomy/build.py              # fetch -> synth -> blender -> centrelines -> bake -> optimise -> verify -> manifest -> explode
    ./.venv/Scripts/python anatomy/build.py --renders    # ... and the Cycles hero renders (GPU recommended)
    ./.venv/Scripts/python anatomy/build.py --only manifest,verify

Stages (see anatomy/README.md):
  fetch        download BodyParts3D STLs into anatomy/raw/ and write anatomy/SOURCES.md
  synth        derived / synthesised parts (cardiac-vein tree, aortic root + valve, ascending calibre)
               -> anatomy/build/synth/
  blender      headless Blender build -> anatomy/build/cardiotwin_anatomy.raw.glb (+ vessel PLYs, report)
  centerlines  coronary centrelines from the vessel PLYs -> frontend/public/anatomy/vessels.json
  bake         Cycles bake of the photoreal looks (anatomy/blender/looks.py) -> anatomy/build/bake/*.png
  optimize     glTF-Transform meshopt pass (+ coronary _ARCLEN from the centrelines)
               -> frontend/public/anatomy/cardiotwin_anatomy.glb
  verify       contract check of the web GLB (nodes, layers, COLOR_0, budgets)
  manifest     layers / structures / explode / cameras -> frontend/public/anatomy/manifest.json
  explode      triangle-level collision check of the exploded layout (fails on collisions at t = 1)
  renders      portfolio renders -> docs/media/renders/ (opt-in: --renders)

The Blender executable is taken from --blender, $CARDIOTWIN_BLENDER, or the default Windows install path.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ANATOMY = Path(__file__).resolve().parent
REPO = ANATOMY.parent
PY = sys.executable
DEFAULT_BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
STAGES = ("fetch", "synth", "blender", "centerlines", "bake", "optimize", "verify", "manifest", "explode", "renders")


def find_blender(explicit: str | None) -> str:
    for cand in (explicit, os.environ.get("CARDIOTWIN_BLENDER"), DEFAULT_BLENDER, shutil.which("blender")):
        if cand and Path(cand).exists():
            return cand
    raise SystemExit("Blender not found: pass --blender or set CARDIOTWIN_BLENDER")


def run(cmd: list[str], *, cwd: Path = REPO) -> None:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=cwd)
    if proc.returncode != 0:
        raise SystemExit(f"stage failed ({proc.returncode}): {' '.join(cmd)}")
    print(f"  ({time.perf_counter() - t0:.1f}s)", flush=True)


def ensure_node_tools() -> None:
    if not (ANATOMY / "node_modules" / "@gltf-transform" / "core").exists():
        npm = shutil.which("npm") or "npm"
        run([npm, "ci", "--no-fund", "--no-audit"], cwd=ANATOMY)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help=f"comma-separated subset of stages: {','.join(STAGES)}")
    ap.add_argument("--skip", default="", help="comma-separated stages to skip")
    ap.add_argument("--renders", action="store_true", help="also run the Cycles hero renders")
    ap.add_argument("--blender", help="path to blender executable")
    ap.add_argument("--save-scene", action="store_true", help="also save anatomy/blender/cardiotwin_scene.blend (renders stage)")
    args = ap.parse_args(argv)

    stages = list(STAGES if args.renders else STAGES[:-1])
    if args.only:
        stages = [s for s in STAGES if s in args.only.split(",")]
    stages = [s for s in stages if s not in args.skip.split(",")]
    unknown = set((args.only or "").split(",")) - set(STAGES) - {""}
    if unknown:
        raise SystemExit(f"unknown stage(s): {sorted(unknown)}")

    t0 = time.perf_counter()
    blender = find_blender(args.blender) if {"blender", "bake", "explode", "renders"} & set(stages) else None
    for stage in stages:
        print(f"\n=== {stage} ===", flush=True)
        if stage == "fetch":
            run([PY, str(ANATOMY / "scripts" / "fetch_bodyparts3d.py")])
        elif stage == "synth":
            run([PY, str(ANATOMY / "scripts" / "synthesize.py")])
        elif stage == "blender":
            run([blender, "--background", "--factory-startup", "--python", str(ANATOMY / "blender" / "build_anatomy.py")])
        elif stage == "bake":
            run([blender, "--background", "--factory-startup", "--python", str(ANATOMY / "blender" / "bake_textures.py")])
        elif stage == "optimize":
            ensure_node_tools()
            run(["node", str(ANATOMY / "scripts" / "optimize_glb.mjs")])
        elif stage == "verify":
            run([PY, str(ANATOMY / "scripts" / "verify_glb.py")])
        elif stage == "centerlines":
            run([PY, str(ANATOMY / "scripts" / "extract_centerlines.py")])
        elif stage == "manifest":
            run([PY, str(ANATOMY / "scripts" / "make_manifest.py")])
        elif stage == "explode":
            run([blender, "--background", "--factory-startup", "--python", str(ANATOMY / "blender" / "check_explode.py")])
        elif stage == "renders":
            extra = ["--", "--save-scene"] if args.save_scene else []
            run([blender, "--background", "--factory-startup", "--python", str(ANATOMY / "blender" / "render_heroes.py"), *extra])
    print(f"\nanatomy pipeline finished in {time.perf_counter() - t0:.0f}s: {', '.join(stages)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
