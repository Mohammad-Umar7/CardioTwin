"""Stage 6b — collision check of the exploded layout (triangle-level, Blender BVH overlap).

Run after the manifest stage::

    blender --background --factory-startup --python anatomy/blender/check_explode.py -- [--t 0.25,0.5,0.75,1]

Every node is displaced by ``t * (layer.explode + structure.explode)`` exactly as the manifest
documents, and every pair of nodes is tested for intersecting triangles. BodyParts3D parts that
already interpenetrate at rest (a coronary embedded in the epicardium, a papillary muscle in the
wall, the bronchial tree inside a lung) are allowed to keep doing so; a pair that intersects at
``t = 1`` more than at rest is a collision and fails the stage. Intermediate ``t`` values are
reported but not fatal: branching trees that interleave (intrapulmonary vessels and bronchi) cross
other layers while sliding past them.

The skin is skipped: it is an enclosing shell that the viewer fades out as it peels.
Writes ``anatomy/build/explode_report.json``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
from common import BUILD_BLEND, BUILD_DIR, PUBLIC_DIR, write_json  # noqa: E402

#: glTF / manifest frame -> Blender world frame.
GLTF_TO_BLENDER = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
SKIP = {"Skin_Torso"}


def world_mesh(ob: bpy.types.Object) -> tuple[np.ndarray, list]:
    me = ob.data
    me.calc_loop_triangles()
    V = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", V)
    M = np.array(ob.matrix_world)
    V = V.reshape(-1, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    T = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get("vertices", T)
    return V, T.reshape(-1, 3).tolist()


def intersections(meshes: dict, offsets: dict, t: float) -> dict[tuple[str, str], int]:
    trees = {}
    for name, (V, T) in meshes.items():
        W = V + t * offsets[name]
        trees[name] = (BVHTree.FromPolygons(W.tolist(), T, all_triangles=True), W.min(axis=0), W.max(axis=0))
    names = sorted(trees)
    out = {}
    for i, a in enumerate(names):
        ta, lo_a, hi_a = trees[a]
        for b in names[i + 1:]:
            tb, lo_b, hi_b = trees[b]
            if np.any(hi_a < lo_b) or np.any(hi_b < lo_a):
                continue
            n = len(ta.overlap(tb))
            if n:
                out[(a, b)] = n
    return out


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="check_explode.py")
    ap.add_argument("--t", default="0.25,0.5,0.75,1", help="comma-separated explode fractions to test")
    ap.add_argument("--manifest", default=str(PUBLIC_DIR / "manifest.json"))
    args = ap.parse_args(argv)
    ts = sorted({float(x) for x in args.t.split(",")} | {1.0})

    bpy.ops.wm.open_mainfile(filepath=str(BUILD_BLEND))
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    layer_vec = {layer["node"]: np.array(layer["explode"], dtype=float) for layer in manifest["layers"]}
    objects = {o.name: o for o in bpy.data.objects if o.type == "MESH" and o.parent and o.parent.name in layer_vec}
    meshes, offsets = {}, {}
    for s in manifest["structures"]:
        if s["node"] in SKIP:
            continue
        ob = objects[s["node"]]
        meshes[s["node"]] = world_mesh(ob)
        offsets[s["node"]] = GLTF_TO_BLENDER @ (layer_vec[ob.parent.name] + np.array(s["explode"], dtype=float))

    rest = intersections(meshes, offsets, 0.0)
    per_t = {t: intersections(meshes, offsets, t) for t in ts}
    collisions = {
        pair: {"rest": rest.get(pair, 0), "exploded": n}
        for pair, n in per_t[1.0].items()
        if n > rest.get(pair, 0)
    }
    transient = sorted({pair for t in ts if t < 1.0 for pair, n in per_t[t].items() if n > rest.get(pair, 0)})
    report = {
        "t": ts,
        "pairs_embedded_at_rest": len(rest),
        "collisions_at_t1": [{"a": a, "b": b, **v} for (a, b), v in sorted(collisions.items())],
        "transient_crossings": [{"a": a, "b": b} for a, b in transient],
    }
    write_json(BUILD_DIR / "explode_report.json", report)
    print(f"[explode] {len(meshes)} nodes, {len(rest)} pairs embedded at rest, "
          f"{len(transient)} transient crossings while sliding, {len(collisions)} collisions at t = 1")
    for (a, b), v in sorted(collisions.items()):
        print(f"[explode]   COLLISION {a} x {b}: {v['rest']} -> {v['exploded']} intersecting triangle pairs")
    return 1 if collisions else 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:  # make Blender exit non-zero so build.py notices
        import traceback

        traceback.print_exc()
        code = 1
    sys.stdout.flush()
    sys.exit(code)
