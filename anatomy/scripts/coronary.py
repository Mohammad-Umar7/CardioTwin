"""Anatomically corrected coronary tree (synthesis stage).

BodyParts3D's coronary parts are one cadaveric segmentation whose proximal courses conflict with the reference
(REFERENCE.md §5): the RCA runs 20-30 mm in front of the right atrioventricular groove with a proximal loop,
the left main bifurcates 37 mm from the mitral hinge so the first 34 mm of the circumflex lie outside the left
AV groove, the septal perforators leave the LAD backwards and the LAD gives large right-ventricular branches
but a single diagonal. This module keeps the BodyParts3D course wherever it agrees with the reference and
re-routes only what conflicts:

* **Left main** — from the left-sinus ostium of the (moved) aortic root, leftwards behind the pulmonary trunk,
  to its bifurcation at the start of the left AV groove.
* **LCX** — follows the left AV groove (``HeartGeo.groove`` beside the mitral hinge ring) from the bifurcation
  round the obtuse margin and ends on the posterolateral wall before the crux (right dominance). The
  BodyParts3D apical run is the first obtuse marginal (OM1) and a second obtuse marginal (OM2) is grown over
  the lateral wall.
* **LAD** — a bridge from the new bifurcation joins the BodyParts3D LAD in the anterior interventricular groove;
  its course, diagonal D1 and branches are BodyParts3D. Right-ventricular branches are trimmed to <= 25 mm
  and <= 1.1 mm, a second diagonal (D2) is grown, and 4 septal perforators are regrown into the septum.
* **RCA** — from the right-sinus ostium down into the right AV groove (beside the tricuspid hinge ring), round
  the acute margin to the crux, continuing as the posterolateral segment. The BodyParts3D acute-marginal /
  RV branches, PDA and posterolateral branches are re-attached to it with short bridges; a conus branch and
  the sinoatrial-nodal artery are grown from its proximal segment and 3 inferior septal branches from the PDA.

Every vessel gets an in-vivo lumen (smooth power-law taper by segment, child < parent, tips thinning to a
point) and is seated with its wall ~0.5-1 mm outside the epicardium (it lies in the epicardial fat).
"""
from __future__ import annotations

import math

import numpy as np
from scipy.spatial import cKDTree

import meshops as mo
import vascular as vs
from vascular import MM

SPACING = 0.8 * MM

#: Diameters (mm) at the origin and the end of each branch type (REFERENCE.md §5.11 CT calibres; the distal
#: LAD is kept >= 1.1 mm so the risk colour stays readable). Tips additionally thin out over the last 30-40 %.
CALIBRE = {
    "LM": (4.3, 4.0), "LAD": (3.9, 1.3), "LCX": (3.3, 1.9), "RCA": (3.3, 2.4),
    "D": (2.2, 1.0), "D2": (1.9, 0.9), "OM": (2.2, 1.0), "OM2": (1.9, 0.9), "RVb": (1.1, 0.6),
    "S1": (1.8, 0.8), "S": (1.4, 0.7), "IS": (1.2, 0.6), "PDA": (2.1, 1.0), "PL": (1.9, 0.9),
    "AM": (1.7, 0.8), "am": (1.2, 0.6), "CB": (1.3, 0.6), "LCB": (1.0, 0.5), "SAN": (1.1, 0.55), "br": (1.0, 0.5),
}
#: Branch origins along the LAD (arc length from the left-main bifurcation, mm): the first septal perforator (so the
#: proximal LAD is ~38 mm: more proximally the septum under this LAD is the membranous / outflow region and a
#: perforator would not stay intramyocardial), the BodyParts3D first diagonal re-attached in D1_ORIGIN_MM (joining its own course
#: D1_JOIN_MM along it), the second diagonal D2_AFTER_MM beyond D1, and the left conus branch.
S1_ON_LAD_MM = 38.0
D1_ORIGIN_MM = (24.0, 32.0)
D1_JOIN_MM = 16.0
D2_AFTER_MM = 24.0
LEFT_CONUS_ON_LAD_MM = 8.0
#: Shortest left main (ostium -> bifurcation chord); in vivo 10 +/- 5 mm.
LM_MIN_MM = 9.0
#: The circumflex runs this far on the ventricular side of the left AV groove bottom (never above h = -2 mm).
LCX_BELOW_CREASE_MM = 0.5
#: The (right) conus branch crosses the anterior infundibulum this far below the pulmonary-valve centre, over this
#: fraction of the way from its origin to the anterior interventricular groove.
CONUS_BELOW_PV_MM = 11.0
CONUS_REACH = 0.55
#: Height of the vessel wall above the epicardium (mm, on the calibrated wall field): the vessels lie on the heart, in
#: the epicardial fat of the grooves; a branch touches the epicardium.
LIFT = {"groove": 0.6, "trunk": 0.3, "branch": 0.15}


class Tree:
    """Segments of one coronary node: points / radii (scene units) with parent indices and branch codes."""

    def __init__(self, node: str, vessel: str):
        self.node, self.vessel = node, vessel
        self.segs: list[dict] = []

    def add(self, P, R, *, parent=None, attach=None, code="br", role="branch", end="cone") -> int:
        P, R = vs.resample(np.asarray(P, float), SPACING, np.asarray(R, float))  # uniform spacing after seating
        self.segs.append({"P": P, "R": R, "parent": parent, "attach": attach,
                          "code": code, "role": role, "end": end})
        return len(self.segs) - 1


def _clip_len(P: np.ndarray, L: float) -> np.ndarray:
    s = vs.arclen(P)
    k = int(np.searchsorted(s, L))
    return P[: max(2, k + 1)]


def _nearest_s(P: np.ndarray, q: np.ndarray) -> tuple[int, float]:
    k = int(np.argmin(np.linalg.norm(P - q, axis=1)))
    return k, float(vs.arclen(P)[k])


def lv_side(P: np.ndarray, lad: np.ndarray) -> np.ndarray:
    """True for points on the patient-left (LV) side of the LAD at the same height (scene +X = left, +Z up); above or
    below the LAD's height range the nearest end of the LAD decides (a branch climbing over the right-ventricular
    outflow tract from the proximal LAD is on the RV side)."""
    order = np.argsort(lad[:, 2])
    xl = np.interp(P[:, 2], lad[order, 2], lad[order, 0])
    return P[:, 0] >= xl - 2 * MM


def lv_dir(geo, P: np.ndarray, k: int) -> np.ndarray:
    """Unit epicardial tangent at ``P[k]`` perpendicular to the path, pointing to the patient's left (LV side)."""
    t = vs.tangent(P, k)
    n = geo.normal(P[k][None])[0]
    b = mo.unit(np.cross(n, t))
    return b if b[0] >= 0 else -b


def grow_branch(geo, parent: np.ndarray, s0: float, angle_deg: float, side: np.ndarray, length: float, goal: np.ndarray,
                *, R: float, lift: float, goal_weight: float = 0.05) -> np.ndarray:
    """A branch leaving ``parent`` at arc length ``s0`` at ``angle_deg`` to it, towards ``side`` (a unit epicardial
    tangent), grown over the epicardium and bending gently towards ``goal``."""
    k = int(np.clip(np.searchsorted(vs.arclen(parent), s0), 2, len(parent) - 3))
    t = vs.tangent(parent, k)
    a = math.radians(angle_deg)
    d = mo.unit(math.cos(a) * t + math.sin(a) * side)
    P = geo.grow(parent[k] + d * 0.8 * MM, d, length, R=R, lift=lift, goal=goal, goal_weight=goal_weight)
    P = vs.resample(np.vstack([parent[k], P]), SPACING)
    return vs.smooth(P, 3)


def _bridge_to(geo, start: np.ndarray, t_start: np.ndarray, path: np.ndarray, s_join: float, *, R: float,
               lift: float, tension: float = 0.8) -> np.ndarray:
    """Replace the first ``s_join`` of ``path`` by a Hermite bridge from ``start`` (tangent ``t_start``)."""
    J, k = vs.at_s(path, s_join)
    br = vs.hermite(start, t_start, J, vs.tangent(path, k), SPACING, tension=tension)
    out = vs.resample(np.vstack([br[:-1], path[k:]]), SPACING)
    n_br = len(br)
    seated = geo.seat(out, R, lift, snap=True, pin_start=1, iterations=5)
    out[: n_br + 4] = seated[: n_br + 4]
    return vs.smooth(out, 3)


def _attach(geo, trunk: np.ndarray, branch: np.ndarray, *, s_join: float, R: float, lift: float,
            trunk_range: tuple[float, float]) -> tuple[np.ndarray, int]:
    """Re-attach a BodyParts3D branch to a (moved) trunk: a Hermite bridge from the trunk point nearest the
    branch to the branch at arc length ``s_join``. Returns (new branch path, trunk index of its origin)."""
    J, kj = vs.at_s(branch, min(s_join, 0.5 * vs.arclen(branch)[-1]))
    s_t = vs.arclen(trunk)
    cand = np.flatnonzero((s_t >= trunk_range[0]) & (s_t <= trunk_range[1]))
    k0 = int(cand[np.argmin(np.linalg.norm(trunk[cand] - J, axis=1))])
    O = trunk[k0]
    t0 = mo.unit(mo.unit(J - O) + 0.5 * vs.tangent(trunk, k0))
    br = vs.hermite(O, t0, J, vs.tangent(branch, kj), SPACING, tension=0.7)
    out = vs.resample(np.vstack([br[:-1], branch[kj:]]), SPACING)
    n_br = len(br)
    seated = geo.seat(out, R, lift, snap=True, pin_start=2, iterations=5)
    out[: n_br + 3] = seated[: n_br + 3]
    return out, k0


def _trim_medial(P: np.ndarray, lad: np.ndarray, keep_frac: float = 0.4, base_x: float | None = None) -> np.ndarray:
    """Cut an obtuse marginal where it leaves the lateral wall: medial to the LAD at the same height, or (with
    ``base_x``) less than 10 mm to the patient's left of the heart base (anatomy/checks COR-12 definition)."""
    order = np.argsort(lad[:, 2])
    xl = np.interp(P[:, 2], lad[order, 2], lad[order, 0], left=np.nan, right=np.nan)
    lateral = np.isnan(xl) | (P[:, 0] >= xl + 1 * MM)
    if base_x is not None:
        lateral &= P[:, 0] > base_x + 11 * MM
    s = vs.arclen(P)
    bad = np.flatnonzero(~lateral & (s > keep_frac * s[-1]))
    return P[: bad[0]] if len(bad) and bad[0] > 4 else P


def _level(t: np.ndarray, down: float) -> np.ndarray:
    """Direction ``t`` made horizontal (scene +Z is superior), then tilted by ``down`` (negative = downwards)."""
    h = np.array([t[0], t[1], 0.0])
    return mo.unit(mo.unit(h) + np.array([0.0, 0.0, down]))


def _settle(geo, P: np.ndarray, R: np.ndarray, lift: float, *, pin_start: int = 0, free_start: int = 0,
            rounds: int = 3) -> np.ndarray:
    """Alternate seating and smoothing so a trunk lies evenly on the epicardium without kinks. The first
    ``free_start`` points (a proximal course crossing the pericardial space) are only pushed out, never snapped."""
    for _ in range(rounds):
        Q = geo.seat(P, R, lift, snap=True, pin_start=pin_start, iterations=4)
        if free_start:
            Qf = geo.seat(P, R, lift, snap=False, pin_start=pin_start, iterations=4)
            w = np.clip(np.arange(len(P)) / max(free_start, 1), 0.0, 1.0)[:, None]
            Q = (1 - w) * Qf + w * Q
        P = vs.smooth(Q, 4)
    return geo.seat(P, R, lift, snap=False, pin_start=pin_start, iterations=3)


def _border(geo, z: float, back: float = 0.0) -> np.ndarray:
    """Left border of the heart at height ``z``: the most patient-left epicardial point (``back`` moves the pick
    that far posteriorly along the border)."""
    E = geo.E
    band = np.abs(E[:, 2] - z) < 3 * MM
    Q = E[band] if band.any() else E
    p = Q[int(np.argmax(Q[:, 0]))]
    if back:
        near = Q[np.abs(Q[:, 1] - (p[1] + back)) < 2.5 * MM]
        if len(near):
            p = near[int(np.argmax(near[:, 0]))]
    return p


def _front(geo, z: float, x: float) -> np.ndarray:
    """The most anterior epicardial point at height ``z`` and patient-left position ``x``."""
    E = geo.E
    for tol in (3.0, 6.0, 10.0):
        band = (np.abs(E[:, 2] - z) < 3 * MM) & (np.abs(E[:, 0] - x) < tol * MM)
        if band.any():
            break
    Q = E[band] if band.any() else E[np.abs(E[:, 2] - z) < 3 * MM]
    return Q[int(np.argmin(Q[:, 1]))]


def surface_path(geo, way: np.ndarray, *, R: float, lift: float) -> np.ndarray:
    """A smooth epicardial course through way-points (the first is the branch origin on its parent)."""
    P = vs.spline(way, SPACING)
    for _ in range(4):
        P = geo.seat(P, R, lift, snap=True, pin_start=2, iterations=4)
        P = vs.smooth(P, 5)
    P[0] = way[0]
    return P


def _sources(parts, log) -> dict:
    import trimesh

    sk = {}
    lm_src = parts.scene("FMA4685")
    aorta_V = np.asarray(parts.scene("FMA3736")[0])
    lm_ost_src = lm_src[0][np.argmin(cKDTree(aorta_V).query(lm_src[0])[0])]
    sk["LM"] = vs.skeleton_paths(*lm_src, lm_ost_src)
    old_bif = sk["LM"][0]["P"][-1]
    sk["LAD"] = vs.skeleton_paths(*parts.scene("FMA3862nsn"), old_bif)
    sk["LCX"] = vs.skeleton_paths(*parts.scene("FMA3895"), old_bif)
    rca_src = parts.scene("FMA3802")
    rca_ost_src = rca_src[0][np.argmin(cKDTree(aorta_V).query(rca_src[0])[0])]
    sk["RCA"] = vs.skeleton_paths(*rca_src, rca_ost_src)
    old_rca = sk["RCA"][0]["P"]
    sk["PDA"] = vs.skeleton_paths(*parts.scene("FMA3840nsn"), old_rca[-1])
    sk["PL"] = vs.skeleton_paths(*parts.scene("FMA76994"), old_rca[-1])
    sk["AM"] = []
    am_V, am_F = parts.scene("FMA3818")
    rca_tree = cKDTree(old_rca)
    for comp in trimesh.Trimesh(am_V, am_F, process=False).split(only_watertight=False):
        if len(comp.faces) < 40:
            continue
        cV = np.asarray(comp.vertices)
        sk["AM"].append(vs.skeleton_paths(cV, np.asarray(comp.faces), cV[np.argmin(rca_tree.query(cV)[0])]))
    sk["AM"].sort(key=lambda c: -vs.arclen(c[0]["P"])[-1])
    log("coronary sources: " + ", ".join(f"{k} {len(v)}" for k, v in sk.items()))
    return sk


def _children(tree: Tree, parent_idx: int, paths: list[dict], geo, *, code: str, max_d: float = 1.2,
              gap: float = 4 * MM, skip: set | None = None) -> None:
    """Hang the BodyParts3D sub-branches of ``paths`` (children of path 0) on the tree segment ``parent_idx``."""
    sub = {0: parent_idx}
    for j, p in enumerate(paths[1:], start=1):
        if p["parent"] not in sub or (skip and j in skip):
            continue
        par = tree.segs[sub[p["parent"]]]
        ko, _ = _nearest_s(par["P"], p["P"][0])
        if np.linalg.norm(par["P"][ko] - p["P"][0]) > gap:
            continue
        Q = np.vstack([par["P"][ko], p["P"][1:]])
        dd = min(max_d, 0.8 * 2 * float(par["R"][ko]) / MM)
        Rq = vs.radius_law(vs.arclen(Q), vs.arclen(Q)[-1], dd, dd * 0.5)
        sub[j] = tree.add(geo.seat(Q, Rq, LIFT["branch"] * MM, pin_start=2), Rq, parent=sub[p["parent"]], code=code)


def _septal(geo, parent: np.ndarray, R_par: np.ndarray, s_origin: float, length: float, d0: float, goal: np.ndarray,
            depth: float, lead: float = 0.65) -> tuple[np.ndarray, np.ndarray]:
    """A perforator leaving ``parent`` at ``s_origin`` at 50-60 deg to it (``lead`` = forward component of the
    initial direction), running through the mid-septum."""
    k = int(np.clip(np.searchsorted(vs.arclen(parent), s_origin), 2, len(parent) - 3))
    o = parent[k]
    t = vs.tangent(parent, k)
    inward = -geo.normal(o[None])[0]
    d = mo.unit(mo.unit(inward - (inward @ t) * t) + lead * t)
    P = geo.grow(o + d * 1.0 * MM, d, length, R=0.7 * MM, lift=0.0, goal=goal, goal_weight=0.03, mode="septum",
                 target_depth=depth)
    P = vs.resample(np.vstack([o, P]), SPACING)
    R = vs.radius_law(vs.arclen(P), vs.arclen(P)[-1], min(d0, 1.8 * float(R_par[k]) / MM), 0.65)
    return P, R


def design(parts, geo, ostia: dict, log, *, svc_V: np.ndarray, pv_valve_V: np.ndarray) -> dict:
    """Design the coronary trees. ``ostia`` = build_aorta's ``info['_ostia']`` (moved root).

    Returns ``{"trees": {node: Tree}, "landmarks": {...}}`` (bifurcation, crux, trunks) for the cardiac veins."""
    sk = _sources(parts, log)
    ring_ma, ring_ta = geo.rings["MA"], geo.rings["TA"]
    deg = np.radians
    trees: dict[str, Tree] = {n: Tree(n, v) for n, v in (
        ("Coronary_LM", "LM"), ("Coronary_LAD", "LAD"), ("Coronary_LAD_Septal", "LAD_SEPTAL"), ("Coronary_LCX", "LCX"),
        ("Coronary_RCA", "RCA"), ("Coronary_RCA_Marginal", "RCA_MARGINAL"), ("Coronary_RCA_PDA", "RCA_PDA"),
        ("Coronary_RCA_PL", "RCA_PL"), ("Coronary_RCA_Septal", "RCA_SEPTAL"))}

    # ------------------------------------------------------------------ left main + circumflex
    O_L, n_L = ostia["LM"]["point"], ostia["LM"]["normal"]
    th_all = deg(np.arange(0.0, 360.0, 2.0))
    G_ma = geo.groove("MA", th_all, h_mm=-1.0, R=1.6 * MM, lift=LIFT["groove"] * MM)
    # bifurcation: the left-AV-groove point nearest the left-main ostium on the anterolateral quadrant
    # The left main runs leftwards behind the pulmonary trunk for ~10 mm and bifurcates at the anterior end of the
    # left AV groove (under the left auricle); the circumflex turns from there into the groove, where it runs round
    # the obtuse margin (increasing azimuth) and ends on the posterolateral wall.
    # of a fan of mostly-leftward directions, the one that ends nearest the mitral hinge ring
    fan = [mo.unit(np.array([1.0, dy, dz])) * L_ for dy in (-0.3, -0.1, 0.1, 0.3, 0.5) for dz in (-0.4, -0.2, 0.0, 0.2)
           for L_ in (10.5, 13.0)]
    Bs = [geo.seat((O_L + d_ * MM)[None], 2.0 * MM, LIFT["trunk"] * MM, snap=False, iterations=4)[0] for d_ in fan]
    # the left main must stay a leftward course (its chord mostly +X) after seating
    ok_ = [b_ for b_ in Bs if (b_ - O_L)[0] >= 0.75 * np.linalg.norm(b_ - O_L) and np.linalg.norm(b_ - O_L) >= LM_MIN_MM * MM] or Bs
    B = ok_[int(np.argmin([ring_ma.dist(b_[None])[0] for b_ in ok_]))]
    in_groove = (np.degrees(th_all) >= 88) & (np.degrees(th_all) <= 150) & (ring_ma.dist(G_ma) <= 15.0 * MM)
    kj = int(np.flatnonzero(in_groove)[np.argmin(np.linalg.norm(G_ma[in_groove] - B, axis=1))])
    th_B = float(th_all[kj])
    th_lcx = np.arange(th_B, deg(190.0), deg(1.5))
    # the circumflex runs on the ventricular side of the groove bottom (which laterally lies below the hinge plane)
    h_lcx = np.minimum(-2.0, geo.crease_h("MA", th_lcx) - LCX_BELOW_CREASE_MM)
    groove_lcx = vs.resample(geo.groove("MA", th_lcx, h_mm=h_lcx, R=1.5 * MM, lift=LIFT["groove"] * MM, max_mm=9.5,
                                        radial_seat=True), SPACING)
    k_in = min(len(groove_lcx) - 2, int(5 * MM / SPACING))
    t_lcx0 = mo.unit(mo.unit(groove_lcx[k_in] - B) + 0.4 * np.array([1.0, 0.18, 0.0]))
    lead = vs.hermite(B, t_lcx0, groove_lcx[k_in], vs.tangent(groove_lcx, k_in), SPACING, tension=0.5)
    lcx = vs.resample(np.vstack([lead[:-1], groove_lcx[k_in:]]), SPACING)
    # left main: from 1.5 mm inside the sinus wall (the tube start is hidden in the aorta) to the bifurcation
    lm_start = O_L - n_L * 0.6 * MM
    t_l = _level(n_L, -0.1)
    lm = vs.hermite(lm_start, t_l, B, mo.unit(B - O_L), SPACING, tension=0.7)
    lm = geo.seat(lm, 2.1 * MM, LIFT["trunk"] * MM, snap=False, pin_start=3, iterations=5)
    lm[-1] = B
    lm = vs.smooth(lm, 3)
    L_lm = vs.arclen(lm)[-1]
    trees["Coronary_LM"].add(lm, vs.radius_law(vs.arclen(lm), L_lm, *CALIBRE["LM"], tip_frac=0.0), attach="aorta",
                             code="LM", role="trunk", end="flat")
    log(f"coronary: LM {L_lm / MM:.0f} mm, bifurcation at MA azimuth {math.degrees(th_B):.0f} deg "
        f"({ring_ma.dist(B[None])[0] / MM:.0f} mm from the mitral hinge ring)")
    L_lcx = vs.arclen(lcx)[-1]
    R_lcx = vs.radius_law(vs.arclen(lcx), L_lcx, *CALIBRE["LCX"], tip_frac=0.3, tip_ratio=0.55)
    lcx = vs.smooth(lcx, 3)  # radially seated in the groove (the final lift clears any dip into the wall)
    lcx[0] = B
    i_lcx = trees["Coronary_LCX"].add(lcx, R_lcx, attach="LM", code="pCx", role="trunk")

    # ------------------------------------------------------------------ LAD: bridge from the new bifurcation
    lad_src = sk["LAD"]
    lad0 = lad_src[0]["P"]
    s0 = vs.arclen(lad0)
    # join the BodyParts3D LAD where the bridge + remaining course is shortest (the source LAD starts at the old,
    # more anterior bifurcation), at least 12 mm from the new bifurcation and within its first 45 mm
    cand = np.flatnonzero((np.linalg.norm(lad0 - B, axis=1) >= 12 * MM) & (s0 >= 8 * MM) & (s0 <= 45 * MM))
    if len(cand):
        cost = 1.15 * np.linalg.norm(lad0[cand] - B, axis=1) - s0[cand]
        kJ = int(cand[np.argmin(cost)])
    else:
        kJ = len(lad0) // 6
    t_lad0 = mo.unit(mo.unit(lad0[kJ] - B) + 0.8 * mo.unit(B - lm[-4]))
    bridge = vs.hermite(B, t_lad0, lad0[kJ], vs.tangent(lad0, kJ), SPACING, tension=0.8)
    lad = vs.resample(np.vstack([bridge[:-1], lad0[kJ:]]), SPACING)
    L_lad = vs.arclen(lad)[-1]
    R_lad = vs.radius_law(vs.arclen(lad), L_lad, *CALIBRE["LAD"], tip_frac=0.3, tip_ratio=0.6, power=1.3)
    lad = _settle(geo, lad, R_lad, LIFT["trunk"] * MM, pin_start=2)
    lad[0] = B
    i_lad = trees["Coronary_LAD"].add(lad, R_lad, attach="LM", code="LAD", role="trunk")
    s_lad = vs.arclen(lad)

    diag_origins = []
    idx_map = {0: i_lad}
    for j, p in enumerate(lad_src[1:], start=1):
        par = p["parent"]
        if par not in idx_map:
            continue
        P = p["P"]
        L = vs.arclen(P)[-1]
        if par == 0:
            ko, so = _nearest_s(lad, P[0])
            # LV side = the branch ends on the patient-left side of the LAD (in the epicardial tangent plane there)
            ke = int(np.argmin(np.linalg.norm(lad - P[-1], axis=1)))
            onlv = float((P[-1] - lad[ke]) @ lv_dir(geo, lad, ke)) > 0.0
            if onlv and L >= 40 * MM and not diag_origins:
                # the BodyParts3D diagonal: re-attached more proximally (D1 usually leaves within the first 20-30 mm)
                # with a 40-55 deg take-off
                P, ko = _attach(geo, lad, P, s_join=D1_JOIN_MM * MM, R=1.0 * MM, lift=LIFT["branch"] * MM,
                                trunk_range=(D1_ORIGIN_MM[0] * MM, D1_ORIGIN_MM[1] * MM))
                so = float(s_lad[ko])
                code, cal = "D", CALIBRE["D"]
            elif onlv and L >= 15 * MM:
                code, cal = "D", CALIBRE["D"]
            elif not onlv:
                if L < 8 * MM:
                    continue
                P = _clip_len(P, 25 * MM)
                code, cal = "RVb", CALIBRE["RVb"]
            else:
                code, cal = "br", CALIBRE["br"]
            if np.linalg.norm(P[0] - lad[ko]) < 6 * MM:
                P = np.vstack([lad[ko], P[1:]])
            L = vs.arclen(P)[-1]
            d0 = min(cal[0], 1.9 * float(R_lad[ko]) / MM)
            R = vs.radius_law(vs.arclen(P), L, d0, min(cal[1], d0 * 0.6))
            P = geo.seat(P, R, LIFT["branch"] * MM, snap=True, pin_start=2)
            idx_map[j] = trees["Coronary_LAD"].add(P, R, parent=i_lad, code=code)
            if code == "D":
                diag_origins.append((so, j, P))
        else:
            parent_seg = trees["Coronary_LAD"].segs[idx_map[par]]
            if parent_seg["code"] == "RVb":
                continue  # sub-branches of the trimmed RV branches are dropped
            ko, _ = _nearest_s(parent_seg["P"], P[0])
            if np.linalg.norm(parent_seg["P"][ko] - P[0]) > 4 * MM:
                continue
            P = np.vstack([parent_seg["P"][ko], P[1:]])
            d0 = min(0.8 * 2 * float(parent_seg["R"][ko]) / MM, 1.2)
            R = vs.radius_law(vs.arclen(P), vs.arclen(P)[-1], d0, d0 * 0.5)
            P = geo.seat(P, R, LIFT["branch"] * MM, snap=True, pin_start=2)
            idx_map[j] = trees["Coronary_LAD"].add(P, R, parent=idx_map[par], code=parent_seg["code"])
    diag_origins.sort(key=lambda x: x[0])
    # second diagonal: leaves the LAD D2_AFTER_MM distal to D1 at ~45 deg and fans over the anterolateral left
    # ventricle between D1 and the LAD, towards the lateral apical third (never running alongside the LAD)
    s_d1 = diag_origins[0][0] if diag_origins else 28 * MM
    s_d2 = s_d1 + D2_AFTER_MM * MM
    k2 = int(np.searchsorted(s_lad, s_d2))
    z_goal = lad[k2][2] - 45 * MM
    order_z = np.argsort(lad[:, 2])
    xl = float(np.interp(z_goal, lad[order_z, 2], lad[order_z, 0]))
    goal = _front(geo, z_goal, xl + 0.55 * (float(_border(geo, z_goal)[0]) - xl))
    D2 = grow_branch(geo, lad, s_d2, 45.0, lv_dir(geo, lad, k2), 58 * MM, goal, R=0.9 * MM, lift=LIFT["branch"] * MM)
    d0 = min(CALIBRE["D2"][0], 1.8 * float(R_lad[k2]) / MM)
    R = vs.radius_law(vs.arclen(D2), vs.arclen(D2)[-1], d0, CALIBRE["D2"][1])
    trees["Coronary_LAD"].add(geo.seat(D2, R, LIFT["branch"] * MM, pin_start=2), R, parent=i_lad, code="D2")
    # left conus branch (the LAD's contribution to the ring of Vieussens): a twig from the first 10 mm of the LAD over
    # the infundibulum towards the RCA's conus branch
    k_lc = int(np.searchsorted(s_lad, LEFT_CONUS_ON_LAD_MM * MM))
    side_rv = -lv_dir(geo, lad, k_lc)
    z_cb = pv_valve_V.mean(axis=0)[2] - CONUS_BELOW_PV_MM * MM
    lcb_goal = _front(geo, z_cb, lad[int(np.searchsorted(s_lad, 14 * MM))][0] - 16 * MM)
    LCB = grow_branch(geo, lad, LEFT_CONUS_ON_LAD_MM * MM, 70.0, side_rv, 20 * MM, lcb_goal, R=0.5 * MM,
                      lift=LIFT["branch"] * MM, goal_weight=0.06)
    R = vs.radius_law(vs.arclen(LCB), vs.arclen(LCB)[-1], *CALIBRE["LCB"])
    trees["Coronary_LAD"].add(geo.seat(LCB, R, LIFT["branch"] * MM, pin_start=2), R, parent=i_lad, code="CB")

    # septal perforators: 3 regrown from the proximal / mid LAD at ~55-70 deg to it, into the mid-septum; the first
    # leaves S1_ON_LAD_MM from the bifurcation (proximal LAD 15-20 mm)
    pda_src = sk["PDA"][0]["P"]
    s_first = S1_ON_LAD_MM * MM
    for n, (ds, L, d0) in enumerate(((0.0, 36.0, CALIBRE["S1"][0]), (11.0, 30.0, 1.5), (22.0, 25.0, 1.3))):
        k = int(np.searchsorted(s_lad, s_first + ds * MM))
        kp = int(np.argmin(np.linalg.norm(pda_src - (lad[k] + geo.u_ba * 15 * MM), axis=1)))
        goal = 0.5 * (lad[k] + pda_src[kp]) + geo.u_ba * 10 * MM
        P, R = _septal(geo, lad, R_lad, s_first + ds * MM, L * MM, d0, goal, 4.5 * MM, lead=0.9)
        trees["Coronary_LAD_Septal"].add(P, R, attach="LAD", code=f"S{n + 1}")

    # ------------------------------------------------------------------ LCX branches: OM1, OM2 over the lateral wall
    # In BodyParts3D the circumflex's apical run lies on the inferolateral wall, medial to the LAD; the obtuse
    # marginals are grown instead from the circumflex near the obtuse margin down the lateral border of the LV towards
    # its apical third (AHA 5, 6, 11, 12). OM1 leaves the circumflex >= 18 mm from the left-main bifurcation.
    s_lcx = vs.arclen(lcx)
    k_ob = int(np.argmax(np.where(s_lcx <= 0.6 * L_lcx, lcx[:, 0], -np.inf)))
    k_om1 = max(k_ob, int(np.searchsorted(s_lcx, 18 * MM)))
    for code, k, drops, back, cal in (("OM1", k_om1, (12.0, 26.0, 40.0, 50.0), 0.0, CALIBRE["OM"]),
                                     ("OM2", min(len(lcx) - 4, k_om1 + int(14 * MM / SPACING)), (14.0, 28.0, 40.0), 7.0, CALIBRE["OM2"])):
        o = lcx[k]
        way = [o] + [_border(geo, o[2] - dz * MM, back * MM) for dz in drops]
        P = surface_path(geo, np.array(way), R=0.9 * MM, lift=LIFT["branch"] * MM)
        d0 = min(cal[0], 1.8 * float(R_lcx[k]) / MM)
        R = vs.radius_law(vs.arclen(P), vs.arclen(P)[-1], d0, cal[1])
        trees["Coronary_LCX"].add(geo.seat(P, R, LIFT["branch"] * MM, pin_start=2), R, parent=i_lcx, code=code)
    om1 = trees["Coronary_LCX"].segs[1]["P"]

    # ------------------------------------------------------------------ RCA: ostium -> right AV groove -> crux
    O_R, n_R = ostia["RCA"]["point"], ostia["RCA"]["normal"]
    th_ta = deg(np.arange(100.0, -150.0, -1.5))
    G_ta = geo.groove("TA", th_ta, h_mm=-1.0, R=1.6 * MM, lift=LIFT["groove"] * MM)
    # crux: the right-AV-groove point nearest the start of the posterior interventricular groove (the PDA)
    pda_head = pda_src[: max(3, int(15 * MM / SPACING))]
    d_crux = cKDTree(pda_head).query(G_ta)[0]
    late = np.degrees(th_ta) <= -60
    k_c = int(np.flatnonzero(late)[np.argmin(d_crux[late])])
    # entry into the groove: past the top of the groove, the first point no higher than the ostium (no
    # shepherd's-crook loop: the proximal RCA runs forwards and slightly down into the groove)
    k_top = int(np.argmax(G_ta[: k_c // 2, 2]))
    low = np.flatnonzero((np.arange(len(G_ta)) >= k_top) & (G_ta[:, 2] <= O_R[2] - 5.0 * MM))
    k_in = int(low[0]) if len(low) else k_top
    groove_part = G_ta[k_in:k_c + 1]
    rca_start = O_R - n_R * 0.6 * MM
    prox = vs.hermite(rca_start, _level(n_R, -0.3), groove_part[0], vs.tangent(groove_part, 0), SPACING, tension=0.75)
    crux = groove_part[-1]
    # posterolateral continuation past the crux, along the posterior left AV groove (~24 mm)
    th_pl = deg(np.arange(300.0, 240.0, -1.5))
    G_pl = geo.groove("MA", th_pl, h_mm=-1.0, R=1.2 * MM, lift=LIFT["groove"] * MM)
    kp0 = int(np.argmin(np.linalg.norm(G_pl - crux, axis=1)))
    pl_tail = G_pl[min(kp0 + 2, len(G_pl) - 4):]
    pl_tail = _clip_len(pl_tail, 22 * MM)
    link = vs.hermite(crux, vs.tangent(groove_part, len(groove_part) - 1), pl_tail[0], vs.tangent(pl_tail, 0), SPACING, tension=0.6)
    rca = vs.resample(np.vstack([prox[:-1], groove_part, link[1:-1], pl_tail]), SPACING)
    rca = vs.smooth(rca, 8)
    s_rca = vs.arclen(rca)
    k_crux = int(np.argmin(np.linalg.norm(rca - crux, axis=1)))
    s_crux = float(s_rca[k_crux])
    x = s_rca / s_rca[-1]
    R_rca = 0.5 * MM * np.interp(s_rca, [0, s_crux, s_rca[-1]], [CALIBRE["RCA"][0], 2.85, CALIBRE["RCA"][1]])
    R_rca *= 1.0 - 0.25 * mo.smoothstep(0.85, 1.0, x)
    rca = _settle(geo, rca, R_rca, LIFT["groove"] * MM, pin_start=3, free_start=int(15 * MM / SPACING))
    i_rca = trees["Coronary_RCA"].add(rca, R_rca, attach="aorta", code="RCA", role="trunk")
    crux = rca[k_crux]
    mid = (s_rca > 0.25 * s_crux) & (s_rca < 0.6 * s_crux)
    log(f"coronary: RCA {s_rca[-1] / MM:.0f} mm (crux at s = {s_crux / MM:.0f} mm), mid-course ring distance "
        f"{np.median(ring_ta.dist(rca[mid])) / MM:.1f} mm median / {ring_ta.dist(rca[mid]).max() / MM:.1f} max")

    # conus branch (first RCA branch): from the proximal RCA forwards and leftwards over the anterior surface of the
    # infundibulum, CONUS_BELOW_PV_MM below the pulmonary valve, towards the anterior interventricular groove (where
    # the LAD's left conus branch meets it: the ring of Vieussens)
    # origin: where the proximal RCA comes nearest the front of the heart (it first runs forwards from the deep aortic
    # root between the outflow tract and the right auricle)
    prox = np.flatnonzero((s_rca >= 4 * MM) & (s_rca <= 40 * MM))
    k_cb = int(prox[np.argmin(rca[prox, 1])])
    pv_c = pv_valve_V.mean(axis=0)
    z_cb = pv_c[2] - CONUS_BELOW_PV_MM * MM
    x0 = rca[k_cb][0] + 6 * MM
    # it crosses about half the infundibulum; the LAD's left conus branch comes from the other side (ring of Vieussens)
    x1 = x0 + CONUS_REACH * (lad[int(np.searchsorted(s_lad, 14 * MM))][0] - x0)
    way = [rca[k_cb]]
    for f in (0.12, 0.35, 0.6, 0.85):
        way.append(_front(geo, z_cb + (1 - f) * 3 * MM, x0 + f * (x1 - x0)))
    cb = surface_path(geo, np.array(way), R=0.6 * MM, lift=LIFT["branch"] * MM)
    R = vs.radius_law(vs.arclen(cb), vs.arclen(cb)[-1], *CALIBRE["CB"])
    trees["Coronary_RCA"].add(geo.seat(cb, R, LIFT["branch"] * MM, pin_start=2), R, parent=i_rca, code="CB")
    k_sn = int(np.searchsorted(s_rca, 13 * MM))
    svc_low = svc_V[svc_V[:, 2] <= np.quantile(svc_V[:, 2], 0.1)].mean(axis=0)
    san = geo.grow(rca[k_sn], mo.unit(svc_low - rca[k_sn]), 38 * MM, R=0.55 * MM, lift=LIFT["branch"] * MM, goal=svc_low,
                   goal_weight=0.1)
    R = vs.radius_law(vs.arclen(san), vs.arclen(san)[-1], *CALIBRE["SAN"])
    trees["Coronary_RCA"].add(geo.seat(san, R, LIFT["branch"] * MM, pin_start=2), R, parent=i_rca, code="SAN")

    # acute-marginal / right-ventricular branches (BodyParts3D courses) re-attached in the groove
    for n, comp in enumerate(sk["AM"]):
        P, k0 = _attach(geo, rca, comp[0]["P"], s_join=12 * MM, R=0.8 * MM, lift=LIFT["branch"] * MM,
                        trunk_range=(20 * MM, s_crux - 10 * MM))
        cal = CALIBRE["AM"] if n == 0 else CALIBRE["am"]
        d0 = min(cal[0], 1.8 * float(R_rca[k0]) / MM)
        R = vs.radius_law(vs.arclen(P), vs.arclen(P)[-1], d0, cal[1])
        i_am = trees["Coronary_RCA_Marginal"].add(geo.seat(P, R, LIFT["branch"] * MM, pin_start=2), R, attach="RCA", code="AM")
        _children(trees["Coronary_RCA_Marginal"], i_am, comp, geo, code="AM", max_d=1.0, gap=3 * MM)

    # PDA: a bridge from the crux into the BodyParts3D posterior-interventricular course
    pda_path = sk["PDA"][0]["P"]
    t_down = mo.unit(mo.unit(vs.at_s(pda_path, 20 * MM)[0] - crux) + 0.3 * vs.tangent(rca, k_crux))
    pda = _bridge_to(geo, crux, t_down, pda_path, 14 * MM, R=1.0 * MM, lift=LIFT["trunk"] * MM, tension=0.7)
    R_pda = vs.radius_law(vs.arclen(pda), vs.arclen(pda)[-1], *CALIBRE["PDA"], tip_frac=0.35, tip_ratio=0.5)
    pda = geo.seat(pda, R_pda, LIFT["trunk"] * MM, pin_start=2)
    i_pda = trees["Coronary_RCA_PDA"].add(pda, R_pda, attach="RCA", code="R-PDA", role="trunk")
    _children(trees["Coronary_RCA_PDA"], i_pda, sk["PDA"], geo, code="R-PDA", max_d=1.2)

    # inferior septal branches from the PDA (short, intramyocardial)
    s_pda = vs.arclen(pda)
    for n, (sp, L, d0) in enumerate(((24.0, 17.0, 1.2), (34.0, 15.0, 1.1), (44.0, 13.0, 1.0))):
        if sp * MM >= s_pda[-1] - 5 * MM:
            break
        k = int(np.searchsorted(s_pda, sp * MM))
        kl = int(np.argmin(np.linalg.norm(lad - (pda[k] + geo.u_ba * 10 * MM), axis=1)))
        P, R = _septal(geo, pda, R_pda, sp * MM, L * MM, d0, 0.5 * (pda[k] + lad[kl]), 4.0 * MM)
        trees["Coronary_RCA_Septal"].add(P, R, attach="RCA_PDA", code=f"IS{n + 1}")

    # posterolateral branches (BodyParts3D) from the end of the RCA trunk
    pl = _bridge_to(geo, rca[-1], vs.tangent(rca, len(rca) - 1), sk["PL"][0]["P"], 10 * MM, R=0.9 * MM,
                    lift=LIFT["branch"] * MM, tension=0.7)
    R_pl = vs.radius_law(vs.arclen(pl), vs.arclen(pl)[-1], min(CALIBRE["PL"][0], 1.8 * float(R_rca[-1]) / MM), CALIBRE["PL"][1])
    pl = geo.seat(pl, R_pl, LIFT["branch"] * MM, pin_start=2)
    i_pl = trees["Coronary_RCA_PL"].add(pl, R_pl, attach="RCA", code="R-PLB", role="trunk")
    _children(trees["Coronary_RCA_PL"], i_pl, sk["PL"], geo, code="R-PLB", max_d=1.0)

    lift = lift_clear(geo, trees)
    log(f"coronary: deepest tube-wall penetration into the myocardium before -> after the lift, outside tunnels (mm): {lift}")
    lad, lcx, rca = trees["Coronary_LAD"].segs[0]["P"], trees["Coronary_LCX"].segs[0]["P"], trees["Coronary_RCA"].segs[0]["P"]
    pda, om1 = trees["Coronary_RCA_PDA"].segs[0]["P"], trees["Coronary_LCX"].segs[1]["P"]
    # the trees resampled their paths (Tree.add) and the lift moved them: find the crux again on the final trunk
    k_crux = int(np.argmin(np.linalg.norm(rca - crux, axis=1)))
    s_crux = float(vs.arclen(rca)[k_crux])
    crux = rca[k_crux]
    B = trees["Coronary_LM"].segs[0]["P"][-1]
    am_main = trees["Coronary_RCA_Marginal"].segs[0]["P"] if trees["Coronary_RCA_Marginal"].segs else None
    landmarks = {"am": am_main, "bifurcation": B, "theta_B": th_B, "theta_B_deg": math.degrees(th_B), "crux": crux, "s_crux": s_crux, "lcx": lcx, "lad": lad, "rca": rca,
                 "pda": pda, "om1": om1, "ma_groove": (th_all, G_ma), "k_crux": k_crux}
    return {"trees": trees, "landmarks": landmarks}


#: Every coronary tube wall lies at least this far outside the epicardium (septal perforators excepted).
CLEAR_MM = 0.15
#: Trees in dependency order (a branch's parent is lifted before the branch is re-anchored on it).
LIFT_ORDER = ("Coronary_LM", "Coronary_LAD", "Coronary_LAD_Septal", "Coronary_LCX", "Coronary_RCA", "Coronary_RCA_Marginal",
              "Coronary_RCA_PDA", "Coronary_RCA_PL", "Coronary_RCA_Septal")
ATTACH_NODE = {"LM": "Coronary_LM", "LAD": "Coronary_LAD", "RCA": "Coronary_RCA", "RCA_PDA": "Coronary_RCA_PDA"}


def lift_clear(geo, trees: dict[str, Tree]) -> dict:
    """Final pass: lift every epicardial vessel so its tube wall clears the epicardium by CLEAR_MM, parents first; a
    branch origin follows its (lifted) parent. Septal perforators are intramyocardial and only re-anchored."""
    report = {}
    import os
    if os.environ.get("CT_NO_LIFT"):
        return report
    for node in LIFT_ORDER:
        t = trees[node]
        worst_before, worst_after = 0.0, 0.0
        for sg in t.segs:
            P = sg["P"].copy()
            host = None
            if sg["parent"] is not None:
                host = t.segs[sg["parent"]]["P"]
            elif sg["attach"] not in (None, "aorta") and sg["attach"] in ATTACH_NODE:
                host = np.vstack([g["P"] for g in trees[ATTACH_NODE[sg["attach"]]].segs[:1]])
            if host is not None:
                k = int(np.argmin(np.linalg.norm(host - P[0], axis=1)))
                delta = host[k] - P[0]
                # a septal perforator dives into the septum at once: its origin follows the parent over 4 mm only
                n = min(5 if "Septal" in node else 10, len(P))
                P[:n] += delta[None] * (1.0 - np.linspace(0.0, 1.0, n))[:, None]
            if "Septal" in node:
                sg["P"] = P
                continue
            worst_before = max(worst_before, float(vs.tube_depth(geo, P, sg["R"])[3:].max()) if len(P) > 4 else 0.0)
            pin = 2 if host is not None else 3
            P = vs.clear_tube(geo, P, sg["R"], margin=CLEAR_MM * MM, pin_start=pin)
            # where the lift moved neighbouring points by very different amounts (a capped lift beside a tunnel, a
            # crease crossed at right angles) give the path its uniform spacing back (both ends kept, so a branch
            # origin stays on its parent) and lift the chords the resampling drew across the crease once more
            for rnd in range(3):
                if np.linalg.norm(np.diff(P, axis=0), axis=1).max() <= 2.0 * SPACING:
                    break
                P, sg["R"] = vs.resample(P, SPACING, sg["R"])
                if rnd < 2:
                    P = vs.clear_tube(geo, P, sg["R"], margin=CLEAR_MM * MM, pin_start=pin)
            free = ~vs.tunnel_mask(geo, P)
            free[:3] = False
            worst_after = max(worst_after, float(vs.tube_depth(geo, P, sg["R"])[free].max()) if free.any() else 0.0)
            sg["P"] = P
        report[node] = [round(worst_before / MM, 2), round(worst_after / MM, 2)]
    return report


def meshes(trees: dict[str, Tree]) -> dict[str, mo.Mesh]:
    out = {}
    for node, tree in trees.items():
        out[node] = mo.concat([vs.sweep(sg["P"], sg["R"], start="flat", end=sg["end"]) for sg in tree.segs])
    return out


def centrelines_json(trees: dict[str, Tree], to_mm) -> dict:
    return {node: {"vessel": t.vessel, "segments": [
        {"points_mm": np.round(to_mm(sg["P"]), 4).tolist(), "radius_mm": np.round(sg["R"] / MM, 4).tolist(),
         "parent": sg["parent"], "attach": sg["attach"], "code": sg["code"], "role": sg["role"]} for sg in t.segs]}
        for node, t in trees.items()}
