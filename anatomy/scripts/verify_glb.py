"""Verify ``cardiotwin_anatomy.glb`` against the interface contract (docs/CONTRACTS.md §6).

Reads only the GLB's JSON chunk, so it works on the meshopt-compressed web asset. Checks:

* every contract node exists under the right ``Layer_*`` parent (§6.2);
* both heart-wall meshes carry ``COLOR_0`` (perfusion-territory weights, RGB);
* mesh nodes have clean transforms (translation only — no rotation / scale / matrix), so the viewer
  can safely offset (explode) or scale them;
* every mesh node owns a distinct material;
* the file stays within the web budgets (size, triangle count).

Usage::

    ./.venv/Scripts/python anatomy/scripts/verify_glb.py [path/to/cardiotwin_anatomy.glb] [--json]
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import GLB_NAME, PUBLIC_DIR  # noqa: E402

#: CONTRACTS.md §6.2 — the binding node table (never derived from the config on purpose).
CONTRACT_LAYERS: dict[str, tuple[str, ...]] = {
    "Layer_Skin": ("Skin_Torso",),
    "Layer_Muscle": ("Pectoralis_L", "Pectoralis_R"),
    "Layer_Skeleton": ("Ribs_L", "Ribs_R", "CostalCartilage", "Sternum", "Clavicle_L", "Clavicle_R", "Spine_Thoracic"),
    "Layer_Lungs": ("Lung_L", "Lung_R", "Trachea_Bronchi"),
    "Layer_Diaphragm": ("Diaphragm",),
    "Layer_Heart": (
        "Heart_Wall_Anterior", "Heart_Wall_Posterior", "Valve_Mitral", "Valve_Tricuspid", "Valve_Pulmonary",
        "Papillary_Muscles", "GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins",
        "GreatVessel_SVC", "GreatVessel_IVC", "CardiacVeins",
    ),
    "Layer_Coronary": (
        "Coronary_LM", "Coronary_LAD", "Coronary_LAD_Septal", "Coronary_LCX", "Coronary_RCA",
        "Coronary_RCA_Marginal", "Coronary_RCA_PDA", "Coronary_RCA_PL", "Coronary_RCA_Septal",
    ),
}
#: CONTRACTS §7.1 (v1.1) additive nodes: optional for consumers, checked like contract nodes when present.
ADDITIVE_LAYERS: dict[str, tuple[str, ...]] = {
    "Layer_Heart": ("Valve_Aortic", "GreatVessel_Aorta_ArchBranches", "GreatVessel_SVC_BrachiocephalicVeins",
                    "EpicardialFat_Anterior", "EpicardialFat_Posterior"),
    "Layer_Lungs": ("Oesophagus",),
}
TERRITORY_NODES = ("Heart_Wall_Anterior", "Heart_Wall_Posterior")
MAX_BYTES = 16 * 1024 * 1024  # CONTRACTS §7.1: <= 16 MB with baked textures
MAX_TRIANGLES = 430_000  # 400k + the realistic epicardial fat and valve apparatus (anatomy/README.md)
REQUIRED_EXTENSIONS = ("EXT_meshopt_compression",)


def read_gltf_json(path: Path) -> dict:
    data = path.read_bytes()
    magic, version, _length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF" or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 binary")
    chunk_len, chunk_type = struct.unpack("<I4s", data[12:20])
    if chunk_type != b"JSON":
        raise ValueError("first GLB chunk is not JSON")
    return json.loads(data[20 : 20 + chunk_len])


def verify(path: Path) -> dict:
    gltf = read_gltf_json(path)
    nodes = gltf["nodes"]
    by_name = {n.get("name"): i for i, n in enumerate(nodes)}
    parent_of: dict[int, int] = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent_of[c] = i

    errors: list[str] = []
    per_node: dict[str, dict] = {}
    materials_seen: dict[int, str] = {}
    total_tris = 0

    layers_all = {k: tuple(v) + tuple(n for n in ADDITIVE_LAYERS.get(k, ()) if n in by_name) for k, v in CONTRACT_LAYERS.items()}
    for layer, members in layers_all.items():
        if layer not in by_name:
            errors.append(f"missing layer node {layer}")
            continue
        for name in members:
            if name not in by_name:
                errors.append(f"missing node {name}")
                continue
            idx = by_name[name]
            node = nodes[idx]
            parent = nodes[parent_of[idx]]["name"] if idx in parent_of else None
            if parent != layer:
                errors.append(f"{name} is parented to {parent!r}, expected {layer!r}")
            if any(k in node for k in ("rotation", "scale", "matrix")):
                errors.append(f"{name} has a non-translation transform")
            if "mesh" not in node:
                errors.append(f"{name} has no mesh")
                continue
            mesh = gltf["meshes"][node["mesh"]]
            if len(mesh["primitives"]) != 1:
                errors.append(f"{name} has {len(mesh['primitives'])} primitives (expected 1)")
            prim = mesh["primitives"][0]
            tris = gltf["accessors"][prim["indices"]]["count"] // 3
            total_tris += tris
            mat = prim.get("material")
            if mat is None:
                errors.append(f"{name} has no material")
            elif mat in materials_seen:
                errors.append(f"{name} shares material {mat} with {materials_seen[mat]}")
            else:
                materials_seen[mat] = name
            attrs = sorted(prim["attributes"])
            if name.startswith("Coronary_") and "_SEGMENT" not in prim["attributes"]:
                errors.append(f"{name} lacks the _SEGMENT (SCCT) vertex attribute")
            if name in TERRITORY_NODES:
                color = prim["attributes"].get("COLOR_0")
                if color is None:
                    errors.append(f"{name} lacks COLOR_0 territory weights")
                elif gltf["accessors"][color]["type"] != "VEC3":
                    errors.append(f"{name} COLOR_0 is {gltf['accessors'][color]['type']}, expected VEC3")
            per_node[name] = {
                "layer": layer,
                "triangles": tris,
                "attributes": attrs,
                "material": gltf["materials"][mat]["name"] if mat is not None else None,
                "translation": node.get("translation", [0.0, 0.0, 0.0]),
                "extras": node.get("extras", {}),
            }

    # every mesh node counts towards the triangle budget, contract or not
    total_tris = sum(gltf["accessors"][gltf["meshes"][n["mesh"]]["primitives"][0]["indices"]]["count"] // 3
                     for n in nodes if "mesh" in n)
    size = path.stat().st_size
    if size > MAX_BYTES:
        errors.append(f"GLB is {size / 1e6:.2f} MB (> {MAX_BYTES / 1e6:.1f} MB)")
    if total_tris > MAX_TRIANGLES:
        errors.append(f"{total_tris} triangles (> {MAX_TRIANGLES})")
    used = gltf.get("extensionsUsed", [])
    for ext in REQUIRED_EXTENSIONS:
        if ext not in used:
            errors.append(f"extension {ext} not used")

    return {
        "path": str(path),
        "bytes": size,
        "triangles_total": total_tris,
        "extensions": used,
        "nodes": per_node,
        "errors": errors,
        "ok": not errors,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb", nargs="?", default=str(PUBLIC_DIR / GLB_NAME))
    ap.add_argument("--json", action="store_true", help="print the full report as JSON")
    args = ap.parse_args(argv)
    report = verify(Path(args.glb))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"[verify] {report['path']}: {report['bytes'] / 1e6:.2f} MB, {report['triangles_total']:,} triangles, "
              f"{len(report['nodes'])} contract nodes, extensions {report['extensions']}")
        for name, info in report["nodes"].items():
            print(f"[verify]   {info['layer']:16s} {name:28s} {info['triangles']:7,d} tris  {','.join(info['attributes'])}")
        for err in report["errors"]:
            print(f"[verify] ERROR: {err}")
        print("[verify] OK" if report["ok"] else "[verify] FAILED")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
