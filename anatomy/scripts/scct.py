"""SCCT 2014 coronary segment model and its application to the CardioTwin centrelines.

Pure NumPy (no Blender): used by ``extract_centerlines.py`` (labels in ``vessels.json``),
``optimize_glb.mjs`` (via ``vessels.json``, the ``_SEGMENT`` vertex attribute) and ``make_manifest.py``
(``manifest.segments``). Definitions paraphrase Leipsic et al., SCCT guidelines for the interpretation and
reporting of coronary CT angiography, J Cardiovasc Comput Tomogr 2014;8:342-358 (Appendix, adapted from
AHA / Austen 1975); see docs/anatomy/REFERENCE.md §5.9.

Risk in CardioTwin stays VESSEL-level: segments are anatomical labels for inspection, never lesion
locations.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SOURCE = "SCCT 2014 (Leipsic et al., J Cardiovasc Comput Tomogr 2014;8:342-358), adapted from AHA 1975"

#: scct -> (code, name, vessel, model target, node, definition)
SEGMENTS: dict[int, tuple[str, str, str, str | None, str, str]] = {
    1: ("pRCA", "Proximal RCA", "RCA", "RCA", "Coronary_RCA",
        "From the RCA ostium to one-half the distance to the acute margin of the heart."),
    2: ("mRCA", "Mid RCA", "RCA", "RCA", "Coronary_RCA",
        "From the end of the proximal RCA to the acute margin of the heart."),
    3: ("dRCA", "Distal RCA", "RCA", "RCA", "Coronary_RCA",
        "From the end of the mid RCA (acute margin) to the origin of the posterior descending artery (crux)."),
    4: ("R-PDA", "Posterior descending artery (from RCA)", "RCA", "RCA", "Coronary_RCA_PDA",
        "Branch of the RCA running in the posterior (inferior) interventricular groove from the crux towards the apex."),
    5: ("LM", "Left main", "LM", None, "Coronary_LM",
        "From the left-main ostium in the left sinus of Valsalva to its bifurcation into the LAD and LCX."),
    6: ("pLAD", "Proximal LAD", "LAD", "LAD", "Coronary_LAD",
        "From the end of the left main to the first large septal perforator or first diagonal (> 1.5 mm), whichever is most proximal."),
    7: ("mLAD", "Mid LAD", "LAD", "LAD", "Coronary_LAD",
        "From the end of the proximal LAD to one-half the distance to the apex."),
    8: ("dLAD", "Distal LAD", "LAD", "LAD", "Coronary_LAD",
        "From the end of the mid LAD to the end of the LAD (including its wrap around the apex)."),
    9: ("D1", "First diagonal", "LAD", "LAD", "Coronary_LAD",
        "First diagonal branch of the LAD, running over the anterolateral left-ventricular wall."),
    10: ("D2", "Second diagonal", "LAD", "LAD", "Coronary_LAD",
         "Second diagonal branch of the LAD."),
    11: ("pCx", "Proximal circumflex", "LCX", "LCX", "Coronary_LCX",
         "From the end of the left main to the origin of the first obtuse marginal, in the left atrioventricular groove."),
    12: ("OM1", "First obtuse marginal", "LCX", "LCX", "Coronary_LCX",
         "First obtuse-marginal branch of the LCX, running towards the apex over the lateral left-ventricular wall."),
    13: ("LCx", "Mid / distal circumflex", "LCX", "LCX", "Coronary_LCX",
         "Circumflex beyond the first obtuse marginal in the atrioventricular groove, to the end of the vessel or the origin of the L-PDA."),
    14: ("OM2", "Second obtuse marginal", "LCX", "LCX", "Coronary_LCX",
         "Second obtuse-marginal branch of the LCX."),
    15: ("L-PDA", "Posterior descending artery (from LCX)", "LCX", "LCX", "",
         "PDA arising from the LCX in left-dominant hearts (not present in this right-dominant model)."),
    16: ("R-PLB", "Posterolateral branch (from RCA)", "RCA", "RCA", "Coronary_RCA_PL",
         "Posterolateral branch(es) of the RCA beyond the crux, supplying the inferior and inferolateral left-ventricular base."),
    17: ("RI", "Ramus intermedius", "Ramus", None, "",
         "Branch arising from the left main between the LAD and LCX (trifurcation); absent in this model."),
    18: ("L-PLB", "Posterolateral branch (from LCX)", "LCX", "LCX", "",
         "Posterolateral branch arising from the LCX in left-dominant hearts (not present in this model)."),
}

#: Named but unnumbered branches (``_SEGMENT = 0``); SCCT permits extra names such as D3.
UNNUMBERED = {
    "S": "Septal perforator (LAD)",
    "IS": "Inferior septal branch (PDA / RCA)",
    "AM": "Acute marginal / right-ventricular branch (RCA)",
    "RVb": "Right-ventricular branch of the LAD",
    "D3": "Third diagonal",
    "br": "Small unnamed branch",
    "AtrB": "Atrial branch of the LCX",
    "CB": "Conus branch (first branch of the RCA, over the right-ventricular outflow tract)",
    "SAN": "Sinoatrial-nodal artery (from the proximal RCA, to the sinoatrial node at the SVC-RA junction)",
}


@dataclass
class Label:
    scct: int
    code: str
    start: int  # first point index (inclusive)
    end: int  # last point index (exclusive)

    def as_dict(self) -> dict:
        return {"scct": self.scct, "code": self.code, "from": self.start, "to": self.end}


def arclen(P: np.ndarray) -> np.ndarray:
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]


def nearest_s(P: np.ndarray, q: np.ndarray) -> tuple[int, float]:
    k = int(np.argmin(np.linalg.norm(P - q, axis=1)))
    return k, float(arclen(P)[k])


def d0(radius: np.ndarray, points: np.ndarray, skip: float = 0.02, window: float = 0.05) -> float:
    """Diameter near the origin of a branch (median over ``window`` after skipping the bridge ``skip``)."""
    s = arclen(points)
    sel = (s >= min(skip, s[-1] * 0.3)) & (s <= min(skip, s[-1] * 0.3) + window)
    if not sel.any():
        sel = np.ones(len(s), dtype=bool)
    return float(2 * np.median(radius[sel]))


def split_at(segments: list, idx: int, k: int, factory) -> list:
    """Split segment ``idx`` at point ``k``: the tail becomes a new segment inserted right after it (parent
    ``idx``); children attached beyond ``k`` move to the tail. ``factory(points, radius, parent)`` builds a
    segment object. Returns the new list (topological order preserved: parents before children)."""
    head = segments[idx]
    P, R = head.points, head.radius
    tail = factory(P[k:], R[k:], idx)
    head.points, head.radius = P[: k + 1], R[: k + 1]
    out = segments[: idx + 1] + [tail] + segments[idx + 1:]
    for j, sg in enumerate(out):
        if j in (idx, idx + 1):
            continue
        if sg.parent is not None and sg.parent > idx:
            sg.parent += 1
        if sg.parent == idx:
            kk = int(np.argmin(np.linalg.norm(P - sg.points[0], axis=1)))
            if kk > k:
                sg.parent = idx + 1
    return out


def lv_side_fraction(branch: np.ndarray, trunk: np.ndarray) -> float:
    """Fraction of a branch's points left of the LAD trunk at the same height (glTF +X = patient left)."""
    order = np.argsort(trunk[:, 1])
    xl = np.interp(branch[:, 1], trunk[order, 1], trunk[order, 0], left=np.nan, right=np.nan)
    ok = ~np.isnan(xl)
    if not ok.any():
        return float("nan")
    return float((branch[ok, 0] >= xl[ok] - 0.02).mean())


def whole(segments, code_scct: tuple[int, str]) -> list[list[Label]]:
    scct, code = code_scct
    return [[Label(scct, code, 0, len(sg.points))] for sg in segments]


def inherit(segments, labels: list[list[Label] | None]) -> list[list[Label]]:
    """Unlabelled segments take the label of their parent at their origin (sub-branches of D1 are D1...)."""
    for j, sg in enumerate(segments):
        if labels[j] is not None:
            continue
        par = sg.parent
        if par is None:
            labels[j] = [Label(0, "br", 0, len(sg.points))]
            continue
        k = int(np.argmin(np.linalg.norm(segments[par].points - sg.points[0], axis=1)))
        lab = next((L for L in labels[par] if L.start <= k < L.end), labels[par][-1])
        # a side branch of a numbered trunk segment is not that segment: keep only branch-type labels
        if lab.scct in (1, 2, 3, 5, 6, 7, 8, 11, 13):
            labels[j] = [Label(0, "br", 0, len(sg.points))]
        else:
            labels[j] = [Label(lab.scct, lab.code, 0, len(sg.points))]
    return labels


def label_lad(lad, septal, apex: np.ndarray) -> tuple[list[list[Label]], dict]:
    trunk = lad[0].points
    s = arclen(trunk)
    k_apex, s_apex = nearest_s(trunk, apex)
    labels: list[list[Label] | None] = [None] * len(lad)
    # septal origins on the trunk
    sept = []
    for sg in septal:
        if sg.parent is None:
            k, s0 = nearest_s(trunk, sg.points[0])
            sept.append((s0, d0(sg.radius, sg.points), k))
    sept.sort()
    first_septal = next((x for x in sept if x[1] >= 0.010), sept[0] if sept else None)
    # first-order branches: diagonals (LV side) and RV branches
    diags, rv = [], []
    for j, sg in enumerate(lad[1:], start=1):
        if sg.parent != 0:
            continue
        k, s0 = nearest_s(trunk, sg.points[0])
        L = float(arclen(sg.points)[-1])
        side = lv_side_fraction(sg.points, trunk)
        dd = d0(sg.radius, sg.points)
        if side >= 0.5 and L >= 0.15 and dd >= 0.009:
            diags.append((s0, j, dd, L))
        elif side < 0.5 and L >= 0.08:
            rv.append((s0, j))
    diags.sort()
    s_d1 = diags[0][0] if diags else np.inf
    s6 = min(first_septal[0] if first_septal else np.inf, s_d1)
    if not np.isfinite(s6):
        s6 = 0.3 * s_apex
    s7 = s6 + 0.5 * (s_apex - s6)
    k6 = int(np.searchsorted(s, s6))
    k7 = int(np.searchsorted(s, s7))
    labels[0] = [Label(6, "pLAD", 0, k6 + 1), Label(7, "mLAD", k6 + 1, k7 + 1), Label(8, "dLAD", k7 + 1, len(trunk))]
    for n, (_s0, j, _d, _L) in enumerate(diags):
        labels[j] = [Label(9, "D1", 0, len(lad[j].points))] if n == 0 else [Label(10, "D2", 0, len(lad[j].points))] if n == 1 else [Label(0, f"D{n + 1}", 0, len(lad[j].points))]
    for _s0, j in rv:
        labels[j] = [Label(0, "RVb", 0, len(lad[j].points))]
    labels = inherit(lad, labels)
    sept_labels = []
    order = {id(sg): i for i, sg in enumerate(sorted([sg for sg in septal if sg.parent is None], key=lambda g: nearest_s(trunk, g.points[0])[1]))}
    for sg in septal:
        n = order.get(id(sg))
        sept_labels.append([Label(0, f"S{n + 1}" if n is not None else "S", 0, len(sg.points))])
    info = {"pLAD_end_mm": round(s6 * 100, 1), "mLAD_end_mm": round(s7 * 100, 1), "apex_s_mm": round(s_apex * 100, 1),
            "first_septal_mm": round(first_septal[0] * 100, 1) if first_septal else None,
            "diagonals": [{"code": "D1" if n == 0 else "D2" if n == 1 else f"D{n + 1}", "origin_mm": round(x[0] * 100, 1),
                           "d0_mm": round(x[2] * 100, 2), "length_mm": round(x[3] * 100, 1)} for n, x in enumerate(diags)],
            "rv_branches": len(rv)}
    return labels, sept_labels, info


def label_lcx(lcx, apex: np.ndarray, hinge_dist) -> tuple[list[list[Label]], dict]:
    """Trunk (segment 0) in the AV groove: pCx (11) up to the origin of the first obtuse marginal, LCx (13) beyond it."""
    labels: list[list[Label] | None] = [None] * len(lcx)
    trunk = lcx[0].points
    labels[0] = [Label(11, "pCx", 0, len(trunk))]
    oms = []
    for j, sg in enumerate(lcx[1:], start=1):
        if sg.parent != 0:
            continue
        L = float(arclen(sg.points)[-1])
        toward_apex = np.linalg.norm(sg.points[-1] - apex) < np.linalg.norm(sg.points[0] - apex) - 0.05
        if toward_apex and L >= 0.15 and d0(sg.radius, sg.points) >= 0.009:
            oms.append((nearest_s(trunk, sg.points[0])[1], j))
        else:
            atrial = float(np.mean(hinge_dist(sg.points) > hinge_dist(sg.points[:1]).mean())) > 0.5 and not toward_apex
            labels[j] = [Label(0, "AtrB" if atrial else "br", 0, len(sg.points))]
    oms.sort()
    for n, (_s, j) in enumerate(oms):
        code = "OM1" if n == 0 else "OM2" if n == 1 else f"OM{n + 1}"
        labels[j] = [Label(12 if n == 0 else 14 if n == 1 else 0, code, 0, len(lcx[j].points))]
    if oms and oms[0][0] < arclen(trunk)[-1] - 0.005:
        k1 = int(np.searchsorted(arclen(trunk), oms[0][0]))
        labels[0] = [Label(11, "pCx", 0, k1 + 1), Label(13, "LCx", k1 + 1, len(trunk))]
    labels = inherit(lcx, labels)
    return labels, {"obtuse_marginals": len(oms), "trunk_mm": round(float(arclen(trunk)[-1]) * 100, 1),
                    "pCx_end_mm": round(float(oms[0][0]) * 100, 1) if oms else None}


def label_rca(rca, pda, marginal, codes: list[str] | None = None) -> tuple[list[list[Label]], dict]:
    trunk = rca[0].points
    s = arclen(trunk)
    k_c, s_c = nearest_s(trunk, pda[0].points[0])
    # acute margin: origin of the main acute marginal branch if it lies mid-course, else the rightmost point
    am, best_len = None, 0.0
    for sg in marginal:
        if sg.parent is None:
            k, s0 = nearest_s(trunk, sg.points[0])
            length = float(arclen(sg.points)[-1])
            if 0.35 * s_c <= s0 <= 0.85 * s_c and length > best_len:
                am, best_len = (s0, k), length
    if am is None:
        sel = (s > 0.3 * s_c) & (s < 0.9 * s_c)
        k = int(np.flatnonzero(sel)[np.argmin(trunk[sel, 0])])
        am = (float(s[k]), k)
    s_am = am[0]
    k1 = int(np.searchsorted(s, 0.5 * s_am))
    k2 = int(np.searchsorted(s, s_am))
    labels = [[Label(1, "pRCA", 0, k1 + 1), Label(2, "mRCA", k1 + 1, k2 + 1), Label(3, "dRCA", k2 + 1, k_c + 1),
               Label(16, "R-PLB", k_c + 1, len(trunk))]]
    labels[0] = [L for L in labels[0] if L.end > L.start]
    for j, sg in enumerate(rca[1:], start=1):  # conus branch, sinoatrial-nodal artery, other named branches
        code = codes[j] if codes and j < len(codes) else "br"
        labels.append([Label(0, code, 0, len(sg.points))])
    return labels, {"acute_margin_mm": round(s_am * 100, 1), "crux_mm": round(s_c * 100, 1), "trunk_mm": round(float(s[-1]) * 100, 1)}
