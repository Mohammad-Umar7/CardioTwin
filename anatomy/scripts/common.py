"""Shared, dependency-free helpers for the CardioTwin anatomy pipeline.

This module is imported both by the regular Python tooling (``.venv``) and by the
Blender scripts (Blender's bundled Python), so it must only use the standard library.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ANATOMY_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ANATOMY_DIR.parent
CONFIG_PATH = ANATOMY_DIR / "config" / "anatomy.json"
RAW_DIR = ANATOMY_DIR / "raw"
BUILD_DIR = ANATOMY_DIR / "build"
PUBLIC_DIR = REPO_ROOT / "frontend" / "public" / "anatomy"
MEDIA_DIR = REPO_ROOT / "docs" / "media"
RENDER_DIR = MEDIA_DIR / "renders"

GLB_NAME = "cardiotwin_anatomy.glb"
RAW_GLB = BUILD_DIR / "cardiotwin_anatomy.raw.glb"
BUILD_REPORT = BUILD_DIR / "build_report.json"
BUILD_BLEND = BUILD_DIR / "cardiotwin_build.blend"
VESSEL_MESH_DIR = BUILD_DIR / "vessels"
#: Derived / synthesised parts (anatomy/scripts/synthesize.py) are referenced in the config as ``SYN_<name>``
#: and read from ``anatomy/build/synth/<id>.ply`` (BodyParts3D millimetre frame).
SYNTH_DIR = BUILD_DIR / "synth"
SYNTH_PREFIX = "SYN_"
BAKE_DIR = BUILD_DIR / "bake"
CENTERLINE_REPORT = BUILD_DIR / "centerline_report.json"

#: Order in which coronary targets are always presented (CONTRACTS §0).
TARGETS = ("CAD", "LAD", "LCX", "RCA")


@dataclass(frozen=True)
class NodeSpec:
    """One exported glTF node, assembled from one or more BodyParts3D parts."""

    node: str
    id: str
    layer: str
    label: str
    parts: tuple[str, ...]
    budget: int
    material: str
    raw: dict[str, Any]

    @property
    def is_coronary(self) -> bool:
        return self.layer == "coronary"

    @property
    def target(self) -> str | None:
        return self.raw.get("target")

    @property
    def coronary_group(self) -> str | None:
        return self.raw.get("coronary_group")


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    """Load and minimally validate ``anatomy/config/anatomy.json``."""
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    layer_ids = {layer["id"] for layer in cfg["layers"]}
    seen: set[str] = set()
    for spec in cfg["nodes"]:
        if spec["layer"] not in layer_ids:
            raise ValueError(f"node {spec['node']!r} references unknown layer {spec['layer']!r}")
        if spec["node"] in seen:
            raise ValueError(f"duplicate node name {spec['node']!r}")
        seen.add(spec["node"])
    return cfg


def node_specs(cfg: dict[str, Any]) -> list[NodeSpec]:
    return [
        NodeSpec(
            node=s["node"],
            id=s["id"],
            layer=s["layer"],
            label=s["label"],
            parts=tuple(s["parts"]),
            budget=int(s["budget"]),
            material=s["material"],
            raw=s,
        )
        for s in cfg["nodes"]
    ]


def all_part_ids(cfg: dict[str, Any]) -> list[str]:
    """Unique BodyParts3D part IDs used by the build (node parts and the synthesis inputs), in first-use
    order. Synthesised ``SYN_*`` parts are not BodyParts3D downloads and are left out."""
    out: list[str] = []
    for pid in [p for spec in cfg["nodes"] for p in spec["parts"]] + list(cfg.get("synthesis", {}).get("source_parts", [])):
        if pid not in out and not pid.startswith("SYN_"):
            out.append(pid)
    return out


def layer_by_id(cfg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {layer["id"]: layer for layer in cfg["layers"]}


def read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, data: Any, *, indent: int | None = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=indent, ensure_ascii=False)
        fh.write("\n")
