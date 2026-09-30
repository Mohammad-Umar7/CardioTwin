"""Stage 6 — write ``frontend/public/anatomy/manifest.json`` (CONTRACTS §6.3).

Combines the declarative config (labels, clinical descriptions, territories, layer explode vectors)
with measured geometry from ``anatomy/build/build_report.json`` (bounding boxes, heart cut plane) to
produce layer / structure metadata, explode vectors and camera presets in scene units (1 = 10 cm,
glTF frame: +Y superior, +Z anterior, +X patient-left).

Explode semantics (documented in the manifest itself): a node's displayed position is
``rest + t * (layer.explode + structure.explode)`` with ``t`` in [0, 1], applied in its parent's
(layer's) space. The anterior heart half swings open along the true cut-plane normal (plus a sideways
offset so the opened cavity faces the home camera) while the posterior half, valves, papillary muscles
and great vessels stay put; every coronary branch and the cardiac veins ride on the heart half they lie
on (config offsets are relative to that half), so vessels stay seated on the epicardium. The layout is
checked for collisions at t = 1 (see anatomy/README.md#exploded-view).

Usage::

    ./.venv/Scripts/python anatomy/scripts/make_manifest.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scct  # noqa: E402
from common import (  # noqa: E402
    ANATOMY_DIR,
    BUILD_REPORT,
    GLB_NAME,
    PUBLIC_DIR,
    TARGETS,
    layer_by_id,
    load_config,
    read_json,
    write_json,
)

MANIFEST = PUBLIC_DIR / "manifest.json"
DEFINITIONS = ANATOMY_DIR / "config" / "definitions.json"
#: Per-vertex attributes carried by the GLB (CONTRACTS §6.2 / §7.1); three.js lower-cases custom names.
ATTRIBUTES = {
    "COLOR_0": {"nodes": ["Heart_Wall_Anterior", "Heart_Wall_Posterior"], "type": "VEC3 unorm8",
                "meaning": "perfusion-territory weights r = LAD, g = LCX, b = RCA; 1 - (r + g + b) = neutral (atria, roots)"},
    "TEXCOORD_0": {"nodes": "every non-coronary mesh", "type": "VEC2",
                   "meaning": "UVs of the baked PBR textures (baseColor, normal, occlusion + roughness)"},
    "_ARCLEN": {"nodes": "Coronary_*", "type": "SCALAR float",
                "meaning": "normalised arc length 0 -> 1 from the ostium of the tree (left tree from the LM ostium, right tree from the RCA ostium)"},
    "_SEGMENT": {"nodes": "Coronary_*", "type": "SCALAR float (integer values)",
                 "meaning": "SCCT 2014 segment number of the nearest labelled centreline point (1-18; 0 = named but unnumbered branch). See segments[]. Anatomical label only - never a lesion location."},
    "_VEIN": {"nodes": ["CardiacVeins"], "type": "SCALAR float (integer values)",
              "meaning": "cardiac-vein code of the nearest labelled vein centreline point, see veins[] (1 CS, 2 GCV, 3 AIV, 4 MCV, 5 PVLV, 6 ACV, 7 LMV, 8 SCV, 9 RMV; 7-8 added in v1.1, 9 in round 3)"},
    "_RADIUS": {"nodes": "Coronary_* and CardiacVeins", "type": "SCALAR float, scene units",
                "meaning": "lumen radius of the nearest labelled centreline point (vessels.json radius): inflate a vessel in proportion to its calibre (e.g. r' = max(1.15 r, minimum pixel width)) and fade sub-pixel tips instead of adding a fixed offset"},
    "_TERRITORY": {"nodes": ["Heart_Wall_Anterior", "Heart_Wall_Posterior"], "type": "VEC3 unorm8 (normalized)",
                   "meaning": "copy of the COLOR_0 perfusion-territory weights (r = LAD, g = LCX, b = RCA) under a custom name. Read this one: glTF viewers multiply COLOR_0 into the base colour, so a later contract version will set COLOR_0 to white."},
    "_DIST_HEART": {"nodes": ["GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins"], "type": "SCALAR float, scene units",
                    "meaning": "geodesic distance along the vessel wall from its cardiac end (pulmonary valve / left-atrial ostium)"},
    "_DIST_HILUM": {"nodes": ["GreatVessel_PulmonaryArtery", "GreatVessel_PulmonaryVeins"], "type": "SCALAR float, scene units",
                    "meaning": "signed geodesic distance from where the vessel enters a lung: < 0 outside the lungs (towards the heart), > 0 intrapulmonary. Keep dist_hilum < ~0.02 to show only the proximal (extrapulmonary) vessels."},
}
VESSELS = "vessels.json"
#: Texture upload order for the viewer (same list as anatomy/scripts/optimize_glb.mjs extras.ct_texture_priority).
TEXTURE_PRIORITY = ["Heart_Wall_Anterior", "Heart_Wall_Posterior", "EpicardialFat_Anterior", "EpicardialFat_Posterior",
                    "GreatVessel_Aorta", "GreatVessel_PulmonaryArtery", "CardiacVeins", "Valve_Aortic", "Valve_Mitral",
                    "Valve_Tricuspid", "Valve_Pulmonary", "Papillary_Muscles", "GreatVessel_PulmonaryVeins", "GreatVessel_SVC",
                    "GreatVessel_IVC", "GreatVessel_Aorta_ArchBranches", "GreatVessel_SVC_BrachiocephalicVeins"]
FOV_DEG = 35.0
#: Aspect ratio the exploded camera preset is framed for (the viewer canvas is landscape).
EXPLODED_ASPECT = 16.0 / 9.0
#: Nodes left out of the exploded framing: the skin is an enclosing shell that the viewer fades out.
EXPLODED_FRAMING_SKIP = {"Skin_Torso"}
#: Label anchor per model target (DESIGN_SYSTEM §7.6 / §7.8): fraction of arc length along the vessel's
#: first centreline segment — proximal-mid LAD in the anterior interventricular groove, the LCX in the
#: left AV groove as it turns onto the lateral wall, the RCA in the anterior right AV groove.
LABEL_ANCHORS = {"Coronary_LAD": 0.30, "Coronary_LCX": 0.35, "Coronary_RCA": 0.25}
#: Standard angiographic projections per target (azimuth + = LAO, elevation + = cranial), DESIGN_SYSTEM §7.5.
BEST_VIEWS = {"LAD": (-30.0, 25.0), "LCX": (-30.0, -25.0), "RCA": (40.0, 0.0)}


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _r(v, nd: int = 4) -> list[float]:
    return [round(float(x), nd) + 0.0 for x in v]


def fit_distance(radius: float, fov_deg: float = FOV_DEG, margin: float = 1.15) -> float:
    """Camera distance at which a sphere of ``radius`` fills the vertical field of view."""
    return margin * radius / math.sin(math.radians(fov_deg) / 2.0)


def focus_preset(center: np.ndarray, radius: float, direction: np.ndarray, *, min_distance: float) -> dict:
    d = max(fit_distance(radius), min_distance)
    return {"position": _r(center + _unit(direction) * d), "target": _r(center), "fov": FOV_DEG}


def exploded_preset(structures: list[dict], layer_explode: dict[str, list[float]], direction: np.ndarray) -> dict:
    """Camera preset framing every structure (but the skin) at t = 1, seen from ``direction``."""
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for s in structures:
        if s["node"] in EXPLODED_FRAMING_SKIP:
            continue
        off = np.array(layer_explode[s["layer"]], dtype=float) + np.array(s["explode"], dtype=float)
        lo = np.minimum(lo, np.array(s["bbox"]["min"]) + off)
        hi = np.maximum(hi, np.array(s["bbox"]["max"]) + off)
    target = (lo + hi) / 2.0
    half_h = (hi[1] - lo[1]) / 2.0
    half_w = (hi[0] - lo[0]) / 2.0
    tan_v = math.tan(math.radians(FOV_DEG) / 2.0)
    d = 1.05 * max(half_h / tan_v, half_w / (tan_v * EXPLODED_ASPECT)) + hi[2] - target[2]
    return {"position": _r(target + _unit(direction) * d), "target": _r(target), "fov": FOV_DEG,
            "aspect": round(EXPLODED_ASPECT, 4)}


def label_anchor(vessel: dict, fraction: float, heart_center: np.ndarray) -> tuple[list[float], list[float]]:
    """Point at ``fraction`` of the arc length of the vessel's first segment, with an outward normal
    (from the heart centre through the point) for the viewer's far-side label test."""
    P = np.array(vessel["segments"][0]["points"], dtype=float)
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    p = P[int(np.searchsorted(s, fraction * s[-1]))]
    return _r(p), _r(_unit(p - heart_center))


SYNTH_REPORT = ANATOMY_DIR / "build" / "synth" / "synth_report.json"


def geometry_facts(vessels: dict | None, report: dict, synth: dict | None) -> dict:
    """Numbers quoted in the definitions ({LM_MM} ...), measured on the built model."""

    def length_mm(points) -> float:
        P = np.array(points, dtype=float)
        return float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum() * 100.0)

    facts: dict[str, str] = {}
    if vessels:
        lm = next(v for v in vessels["vessels"] if v["node"] == "Coronary_LM")
        facts["LM_MM"] = f"{length_mm(lm['segments'][0]['points']):.0f}"
        segs = vessels.get("veins", {}).get("segments", [])
        for lab in ("CS", "GCV", "AIV", "SCV", "RMV", "MCV"):
            main = next((sg for sg in segs if sg["label"] == lab and not sg.get("side")), None)
            if main is not None:
                facts[f"{lab}_MM"] = f"{length_mm(main['points']):.0f}"
        cs = next((sg for sg in segs if sg["label"] == "CS"), None)
        mcv = next((sg for sg in segs if sg["label"] == "MCV" and not sg.get("side")), None)
        if cs is not None and mcv is not None:
            P = np.array(cs["points"], dtype=float)
            k = int(np.argmin(np.linalg.norm(P - np.array(mcv["points"][0]), axis=1)))
            facts["MCV_JOIN_MM"] = f"{length_mm(cs['points'][:k + 1]) if k else 0.0:.0f}"
        facts["N_ACV"] = str(sum(1 for sg in segs if sg["label"] == "ACV" and sg.get("parent") is None))
        gcv = next((sg for sg in segs if sg["label"] == "GCV" and not sg.get("side")), None)
        pvlv = next((sg for sg in segs if sg["label"] == "PVLV" and not sg.get("side")), None)
        if cs is not None and gcv is not None and pvlv is not None:
            path = np.vstack([np.array(cs["points"], dtype=float), np.array(gcv["points"], dtype=float)[1:]])
            k = int(np.argmin(np.linalg.norm(path - np.array(pvlv["points"][0]), axis=1)))
            facts["PVLV_JOIN_MM"] = f"{length_mm(path[:k + 1]) if k else 0.0:.0f}"
            facts["PVLV_HOST"] = "coronary sinus" if k < len(cs["points"]) else "great cardiac vein"
    nodes = {n["node"]: n for n in report["nodes"]}
    if "GreatVessel_SVC" in nodes:
        n = nodes["GreatVessel_SVC"]
        facts["SVC_MM"] = f"{(n['bbox_max'][1] - n['bbox_min'][1]) * 100.0:.0f}"
    if synth:
        v = synth.get("valves", {})
        if v:
            facts["TV_OFFSET_MM"] = f"{v['tricuspid']['septal_hinge_apical_offset_mm']:.0f}"
            facts["MV_AML_MM"] = f"{v['mitral']['aml_height_mm']:.0f}"
            facts["MV_PML_MM"] = f"{v['mitral']['pml_height_mm']:.1f}".rstrip("0").rstrip(".")
        iso = synth.get("mitral_isthmus", {}).get("left_pv_ring_dist_mm_min_median")
        if iso:
            facts["ISTHMUS_MIN_MM"] = f"{iso[1][0]:.0f}"
            facts["ISTHMUS_MED_MM"] = f"{iso[1][1]:.0f}"
    facts["FAT_EMBED"] = "0.35"
    return facts


def fill(text: str, facts: dict) -> str:
    """Substitute the {KEY} numbers of a definition; a key the geometry did not provide is an error."""
    try:
        return text.format_map(facts)
    except KeyError as exc:  # pragma: no cover - a configuration error
        raise SystemExit(f"definition needs geometry fact {exc} (make_manifest.geometry_facts)") from exc


def definition_fields(node: str, definitions: dict, facts: dict | None = None) -> dict:
    d = definitions.get("nodes", {}).get(node)
    if not d:
        return {}
    facts = facts or {}
    out = {"fma_id": d.get("fma_id"), "provenance": d.get("provenance", "BodyParts3D"),
           "definition": fill(d["definition"], facts), "clinical_relevance": d["clinical_relevance"]}
    if d.get("fma_ids"):
        out["fma_ids"] = d["fma_ids"]
    if d.get("accompanies"):
        out["accompanies"] = d["accompanies"]
    return out


def _scct_at(sg: dict, k: int) -> int:
    for lab in sg.get("labels", []):
        if lab["from"] <= k < lab["to"]:
            return lab["scct"]
    return sg.get("scct", 0)


def segment_table(vessels: dict | None) -> list[dict]:
    """SCCT 2014 18-segment table with the CardioTwin node, presence and measured extent.

    ``length_mm`` is the main-path length of the segment (the trunk range, or the branch itself for a numbered
    branch such as D1 — not its sub-branches, which inherit its label); ``total_branch_length_mm`` adds every
    sub-branch that carries the label."""
    main: dict[int, float] = {}
    total: dict[int, float] = {}
    if vessels:
        for v in vessels["vessels"]:
            segs = v["segments"]
            for sg in segs:
                P = np.array(sg["points"], dtype=float)
                seglen = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
                parent = segs[sg["parent"]] if sg.get("parent") is not None else None
                for lab in sg.get("labels", []):
                    if not lab["scct"]:
                        continue
                    a, b = lab["from"], max(lab["from"], min(lab["to"], len(P)) - 1)
                    L = float(seglen[b] - seglen[a])
                    total[lab["scct"]] = total.get(lab["scct"], 0.0) + L
                    inherited = False
                    if parent is not None and a == 0:
                        Pp = np.array(parent["points"], dtype=float)
                        kp = int(np.argmin(np.linalg.norm(Pp - P[0], axis=1)))
                        inherited = _scct_at(parent, kp) == lab["scct"]
                    if not inherited:
                        main[lab["scct"]] = main.get(lab["scct"], 0.0) + L
    present = main
    out = []
    for n, (code, name, vessel, target, node, definition) in scct.SEGMENTS.items():
        out.append({
            "scct": n, "code": code, "name": name, "vessel": vessel, "target": target, "node": node or None,
            "definition": definition, "source": scct.SOURCE, "present": n in present,
            **({"length_mm": round(present[n] * 100, 1), "total_branch_length_mm": round(total[n] * 100, 1)} if n in present else {}),
        })
    return out


def build_manifest(cfg: dict, report: dict, vessels: dict | None = None, definitions: dict | None = None,
                   texture_report: dict | None = None, optimize_report: dict | None = None, synth: dict | None = None) -> dict:
    definitions = definitions or {}
    facts = geometry_facts(vessels, report, synth)
    layers_cfg = layer_by_id(cfg)
    nodes = {n["node"]: n for n in report["nodes"]}
    cut_normal = _unit(np.array(report["heart"]["cut_plane"]["normal"], dtype=float))  # glTF, anterior-facing
    cut_point = np.array(report["heart"]["cut_plane"]["point"], dtype=float)
    heart_center = np.zeros(3)  # scene origin = heart-wall bbox centre

    all_min = np.min([n["bbox_min"] for n in report["nodes"]], axis=0)
    all_max = np.max([n["bbox_max"] for n in report["nodes"]], axis=0)
    torso_center = (all_min + all_max) / 2.0

    half_explode = {}
    for spec in cfg["nodes"]:
        if spec.get("split"):
            sign = 1.0 if spec["split"]["side"] == "anterior" else -1.0
            opening = float(spec["split"].get("open_along_cut_normal", 0.0))
            half_explode[spec["split"]["side"]] = sign * opening * cut_normal + np.array(spec["explode"], dtype=float)

    structures = []
    focus = {}
    for spec in cfg["nodes"]:
        info = nodes[spec["node"]]
        lo, hi = np.array(info["bbox_min"]), np.array(info["bbox_max"])
        center = (lo + hi) / 2.0
        radius = float(np.linalg.norm(hi - lo) / 2.0)

        explode = np.array(spec["explode"], dtype=float)
        if spec.get("split"):
            explode = half_explode[spec["split"]["side"]]
        elif spec.get("rides_on") in half_explode:  # e.g. the pulmonary valve, set in the anterior half's RVOT
            explode = half_explode[spec["rides_on"]] + explode
        elif spec["layer"] == "coronary" or spec["node"] == "CardiacVeins":
            side = "anterior" if float((center - cut_point) @ cut_normal) >= 0 else "posterior"
            explode = half_explode[side] + explode

        entry = {
            "id": spec["id"],
            "node": spec["node"],
            "label": spec["label"],
            "layer": spec["layer"],
            "target": spec.get("target"),
            "explode": _r(explode),
            "description": spec["description"],
            "territory": spec.get("territory"),
            "category": spec["material"],
            "material": info["material"],
            "fma": [p for p in spec["parts"] if not p.startswith("SYN_")] + list(spec.get("source_parts", [])),
            **definition_fields(spec["node"], definitions, facts),
            "center": _r(center),
            "bbox": {"min": _r(lo), "max": _r(hi)},
            "triangles": info["triangles"],
        }
        if "feeds" in spec:
            entry["feeds"] = spec["feeds"]
        tex = (texture_report or {}).get("nodes", {}).get(spec["node"])
        if tex:  # mean baked albedo: the untextured fallback colour, so the viewer does not pop when the maps arrive
            entry["realistic_color"] = tex["mean_rgb"]
        # DESIGN_SYSTEM §7.8 additive fields: the wall a structure rides on, label anchors, best views.
        if spec.get("rides_on") in half_explode:
            entry["rides"] = f"Heart_Wall_{spec['rides_on'].title()}"
        elif spec["layer"] == "coronary" or spec["node"] == "CardiacVeins":
            side = "Anterior" if float((center - cut_point) @ cut_normal) >= 0 else "Posterior"
            entry["rides"] = f"Heart_Wall_{side}"
        if vessels and spec["node"] in LABEL_ANCHORS:
            vessel = next(v for v in vessels["vessels"] if v["node"] == spec["node"])
            entry["labelAnchor"], entry["labelNormal"] = label_anchor(vessel, LABEL_ANCHORS[spec["node"]], heart_center)
        if spec.get("target") in BEST_VIEWS and spec["node"] in LABEL_ANCHORS:
            az, el = BEST_VIEWS[spec["target"]]
            entry["bestView"] = {"azimuth": az, "elevation": el, "distance": round(fit_distance(0.85), 3)}
        if spec.get("split"):
            entry["territory_weights"] = {
                "attribute": "COLOR_0",
                "channels": {"r": "LAD", "g": "LCX", "b": "RCA"},
                "neutral": "1 - (r + g + b)",
            }
        structures.append(entry)

        # Focus preset (look-from direction):
        # * coronary branches — radially away from the heart centre, so each vessel faces the camera
        #   (LAD from the front, LCX from the left, PDA from below);
        # * heart halves — along the cut normal, looking into the opened cavity;
        # * other heart structures (valves, great vessels, veins) — a classic left-anterior-oblique view,
        #   from behind for posterior structures such as the pulmonary veins;
        # * everything else — radially away from the torso axis (spine from behind, ribs from the side).
        if spec.get("split"):
            outward = cut_normal * (1.0 if spec["split"]["side"] == "anterior" else -1.0)
        elif spec["layer"] == "coronary":
            outward = center - heart_center
        elif spec["layer"] == "heart":
            outward = np.array([0.35, 0.0, 1.0 if center[2] > -0.25 else -1.0])
        else:
            outward = center - np.array([torso_center[0], center[1], torso_center[2]])
        if np.linalg.norm(outward) < 0.15:
            outward = np.array([0.0, 0.0, 1.0])
        direction = _unit(_unit(outward) + np.array([0.0, 0.3, 0.0]))
        min_d = 1.9 if spec["layer"] == "coronary" else 1.4
        focus[spec["id"]] = focus_preset(center, radius, direction, min_distance=min_d)

    # Home: whole torso in frame, looking from the front and slightly above at a point between
    # the torso centre and the heart so the heart stays prominent.
    home_target = (torso_center + heart_center) / 2.0
    half_height = (all_max[1] - all_min[1]) / 2.0
    home_d = 1.1 * half_height / math.tan(math.radians(FOV_DEG) / 2.0) + all_max[2]
    home_dir = _unit(np.array([0.0, 0.12, 1.0]))
    home = {"position": _r(home_target + home_dir * home_d), "target": _r(home_target), "fov": FOV_DEG}
    heart_view = focus_preset(heart_center, 0.85, _unit(np.array([0.25, 0.2, 1.0])), min_distance=2.5)
    exploded = exploded_preset(structures, {layer["id"]: layer["explode"] for layer in cfg["layers"]}, home_dir)

    targets = {t: [] for t in TARGETS}
    for s in structures:
        if s["target"] in targets:
            targets[s["target"]].append(s["node"])

    layers = []
    for layer in cfg["layers"]:
        members = [s["node"] for s in structures if s["layer"] == layer["id"]]
        layers.append({
            "id": layer["id"],
            "node": layer["node"],
            "label": layer["label"],
            "explode": _r(layer["explode"]),
            "order": layer["order"],
            "description": layer["description"],
            "nodes": members,
        })

    extra = {}
    if optimize_report:
        extra = {"glb_bytes": optimize_report["glb_bytes"], "glb_sha256": optimize_report["glb_sha256"],
                 "textures": {"gpu_mib": optimize_report["textures_gpu_mib"], "webp_mb": optimize_report["textures_webp_mb"],
                              "priority": [n for n, _ in sorted(((n, i) for i, n in enumerate(TEXTURE_PRIORITY)), key=lambda x: x[1])]}}
    return {
        "version": cfg["version"],
        "glb": GLB_NAME,
        **extra,
        "vessels": VESSELS,
        "credits": cfg["source"]["credits"],
        "license": {
            "anatomy": f"{cfg['source']['license']} (derived meshes, share-alike) — {cfg['source']['license_url']}",
            "code": "MIT",
        },
        "units": "scene units; 1 unit = 10 cm",
        "frame": {
            "origin": "centre of the heart-wall bounding box",
            "axes": {"+X": "patient left", "+Y": "superior (head)", "+Z": "anterior (towards default camera)"},
            "source_origin_mm": report["frame"]["origin_mm_bodyparts3d"],
        },
        "explode_semantics": (
            "displayed position = rest position + t * (layer.explode + structure.explode), t in [0, 1], "
            "in the parent layer's space (scene units). The anterior heart half swings open along the cut-plane "
            "normal while the posterior half, valves and great vessels stay; coronary branches and cardiac veins "
            "ride on the heart half they lie on. The skin is an enclosing shell: fade it out as it peels. "
            "camera.exploded frames the fully exploded layout (t = 1)."
        ),
        "heart": {
            "cut_plane": report["heart"]["cut_plane"],
            "long_axis": report["heart"]["long_axis"],
            "apex": report["heart"]["apex"],
            "base_center": report["heart"]["base_center"],
        },
        "territories": {
            "nodes": [s["node"] for s in structures if "territory_weights" in s],
            "attribute": "COLOR_0",
            "channels": {"r": "LAD", "g": "LCX", "b": "RCA"},
            "method": (
                "Soft nearest-artery assignment: softmax(-d/sigma) over the distances from each heart-wall vertex to "
                "the LAD (+septal), LCX and RCA (+marginal, PDA, posterolateral, septal) groups, sigma = "
                f"{cfg['territories']['sigma_mm']} mm, faded to zero on atria and great-vessel roots (thin wall and "
                "closer to inflow/outflow vessels than to ventricular landmarks) and far from every artery; on ventricular "
                "myocardium blended "
                f"{int(round(100 * cfg['territories'].get('standard_blend', {}).get('alpha', 0.0)))} % towards the AHA-17 "
                "standard territories (Cerqueira 2002), the septum split between the LAD and RCA septal perforators, and the "
                "three weights re-balanced towards the population shares of LV myocardium (LAD 42.5 %, LCX 28.8 %, RCA 26.4 %)."
            ),
            "interpretation": (
                "Approximates the standard coronary perfusion territories of the AHA 17-segment model on this "
                "right-dominant BodyParts3D heart. It is a vessel-level supply map, NOT a lesion map: model "
                "outputs are per-vessel probabilities and never localise a stenosis within a vessel."
            ),
        },
        "targets": targets,
        "layers": layers,
        "structures": structures,
        "segments": segment_table(vessels),
        "veins": [{"code": int(k), **{kk: (fill(vv, facts) if kk == "definition" else vv) for kk, vv in v.items()}}
                  for k, v in sorted(definitions.get("veins", {}).items(), key=lambda kv: int(kv[0]))],
        "facts": facts,
        "attributes": ATTRIBUTES,
        "camera": {"fov": FOV_DEG, "home": home, "heart": heart_view, "exploded": exploded, "focus": focus},
    }


def main() -> int:
    cfg = load_config()
    report = read_json(BUILD_REPORT)
    vessels_path = PUBLIC_DIR / VESSELS
    vessels = read_json(vessels_path) if vessels_path.exists() else None
    definitions = read_json(DEFINITIONS) if DEFINITIONS.exists() else {}
    tex_path = ANATOMY_DIR / "build" / "bake" / "texture_report.json"
    opt_path = ANATOMY_DIR / "build" / "optimize_report.json"
    manifest = build_manifest(cfg, report, vessels, definitions,
                              read_json(tex_path) if tex_path.exists() else None,
                              read_json(opt_path) if opt_path.exists() else None,
                              read_json(SYNTH_REPORT) if SYNTH_REPORT.exists() else None)
    write_json(MANIFEST, manifest)
    print(f"[manifest] wrote {MANIFEST} ({len(manifest['structures'])} structures, {len(manifest['layers'])} layers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
