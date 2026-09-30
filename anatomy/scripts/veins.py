"""Cardiac veins (synthesis stage): one labelled venous tree draining through the coronary sinus, plus the
anterior cardiac veins that open directly into the right atrium.

BodyParts3D's cardiac-vein parts are collapsed (cadaveric), partly sunk into the myocardium and their coronary
sinus approaches the mitral annulus obliquely (REFERENCE.md §6). The courses are rebuilt around the corrected
coronary tree (``coronary.py``):

* **Coronary sinus (CS)** — its ostium opens flush into the posteroinferior right atrium, anteromedial to the IVC
  orifice and next to the crux (where the PDA arises); it runs leftwards in the posterior atrioventricular groove,
  4-5 mm on the atrial side of the mitral hinge, reaching its ostium along the groove, for ~40 mm (to the valve of
  Vieussens / vein of Marshall).
* **Great cardiac vein (GCV)** — continues in the left AV groove, 6-7 mm on the atrial side of the hinge and never
  more than 11 mm out from it (the circumflex lies between it and the annulus), below the left auricle, to the
  left-main bifurcation, where it turns into the **anterior interventricular vein (AIV)** (triangle of Brocq and
  Mouchet). The AIV is designed beside the LAD, 3.5 mm on its left-ventricular side; the BodyParts3D AIV
  tributaries are re-attached to it.
* **Middle cardiac vein (MCV)** — BodyParts3D course with the PDA (<= 105 mm); it joins the CS where the sinus
  passes the crux.
* **Posterior vein of the LV (PVLV)** and **left marginal vein (LMV)** — the two BodyParts3D "posterior LV
  vein" pieces: the posterior one drains into the CS, the lateral one (running with OM1) into the GCV.
* **Small cardiac vein (SCV)** — designed in the posterior right AV groove beside the distal RCA (on its atrial
  side), from the CS near its ostium to the acute margin (<= 60 mm), where it receives the **right marginal vein
  (RMV)**, designed 3 mm beside the acute marginal artery.
* **Anterior cardiac veins (ACV)** — the longest anterior right-ventricular branches of the BodyParts3D "anterior
  cardiac vein" part, cut to <= 45 mm: they cross the RCA in the right AV groove and open into the anterior
  right-atrial wall above the tricuspid annulus.

Calibres grow monotonically towards each drainage end (in-vivo CT: CS ~10 mm at the ostium, MCV 4.5 mm,
proximal AIV 3.5-4 mm) and every distal tip thins to ~0.65 mm over its last 40 %.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

import meshops as mo
import vascular as vs
from vascular import MM

SPACING = 0.8 * MM
#: Vein label codes (``_VEIN`` vertex attribute, manifest ``veins``). 1-8 are unchanged from contract v1.1; 9 (the
#: right marginal vein) is additive.
CODES = {"CS": 1, "GCV": 2, "AIV": 3, "MCV": 4, "PVLV": 5, "ACV": 6, "LMV": 7, "SCV": 8, "RMV": 9}
NAMES = {"CS": "Coronary sinus", "GCV": "Great cardiac vein", "AIV": "Anterior interventricular vein",
         "MCV": "Middle cardiac vein", "PVLV": "Posterior vein of the left ventricle", "ACV": "Anterior cardiac vein",
         "LMV": "Left marginal vein", "SCV": "Small cardiac vein", "RMV": "Right marginal vein"}
#: Diameters (mm): at the drainage end and at the start of the distal taper of each course.
CALIBRE = {"CS": (10.0, 8.6), "GCV": (6.6, 4.6), "AIV": (4.0, 1.3), "MCV": (4.6, 1.3), "PVLV": (3.2, 1.0),
           "LMV": (3.0, 1.0), "SCV": (2.6, 1.8), "RMV": (1.8, 0.8), "ACV": (1.9, 0.8)}
TIP_MM = 0.65
#: Narrowest lumen anywhere (a squeezed crevice or a tip): 0.6 mm diameter, so no tip is thinner than ~1.5 px at
#: the heart framing and none reads as a dashed line where the fat half-buries it.
MIN_RADIUS_MM = 0.3
CS_LENGTH_MM = 40.0
#: Seat height of a vein wall above the epicardium and the least clearance of its tube wall (calibrated wall field).
LIFT_MM = 0.15
CLEAR_MM = 0.2
#: Course parameters (mm / degrees): heights of the sinus and the GCV above the mitral hinge, the farthest the GCV
#: may run out from the hinge, where the groove course ends past the left-main bifurcation's azimuth, where the AIV
#: begins on the LAD (arc length from the bifurcation) and how far beside it, and the length caps.
CS_H_MM = 4.5
GCV_H_MM = 5.0
GCV_ABOVE_CREASE_MM = 2.5
GCV_MAX_MM = 11.0
GCV_END_DEG = 10.0
AIV_START_ON_LAD_MM = 7.0
AIV_OFFSET_MM = 3.5
AIV_LENGTH_MM = 108.0
MCV_MAX_MM = 92.0
SCV_H_MM = 3.0
SCV_MAX_MM = 52.0
RMV_MAX_MM = 70.0
ACV_MAX_MM = 45.0
N_ACV = 3
#: The ostium lies in the right atrium medial to (x), in front of (y) and above (z) the IVC orifice by these margins.
OSTIUM_IVC_MM = (2.0, 0.3, 3.0)


class VeinTree:
    def __init__(self):
        self.segs: list[dict] = []

    def add(self, label, P, R, parent=None, side=False, end="cone", start="flat") -> int:
        P, R = vs.resample(np.asarray(P, float), SPACING, np.asarray(R, float))  # uniform spacing after seating
        self.segs.append({"label": label, "P": P, "R": R, "parent": parent,
                          "side": side, "end": end, "start": start})
        return len(self.segs) - 1


def taper(P: np.ndarray, d0: float, d1: float, *, tip: bool = True) -> np.ndarray:
    """Radius (scene units) from diameter ``d0`` at the drainage end to ``d1``, thinning to ~TIP_MM over the last 40 %."""
    s = vs.arclen(P)
    x = s / max(s[-1], 1e-9)
    d = d0 * (d1 / d0) ** x
    if tip:
        d = d * (1 - mo.smoothstep(0.6, 1.0, x)) + np.minimum(d, TIP_MM) * mo.smoothstep(0.6, 1.0, x)
    return np.maximum(0.5 * d, MIN_RADIUS_MM) * MM


def clear_wall(geo, P: np.ndarray, R: np.ndarray, *, lift: float = LIFT_MM * MM, pin_start: int = 0,
               snap: bool = True) -> np.ndarray:
    """Seat a vein on the epicardium and lift it out wherever its tube wall still dips into the myocardium
    (``vascular.clear_tube``: a vein in a crease is lifted out of it rather than pushed into one of its walls).
    ``snap=False`` keeps a course that is already seated (a groove traced by radial seating)."""
    lift = np.where(R < 0.6 * MM, 0.08 * MM, lift)
    if snap:
        P = geo.seat(P, R, lift, snap=True, pin_start=pin_start, iterations=5)
    P = vs.clear_tube(geo, P, R, margin=CLEAR_MM * MM, pin_start=pin_start, iterations=40)
    Q = vs.smooth(P, 3)  # relax the small wiggles of neighbouring pushes, then clear once more
    if pin_start:
        Q[:pin_start] = P[:pin_start]
    return vs.clear_tube(geo, Q, R, margin=CLEAR_MM * MM, pin_start=pin_start, iterations=20)


def squeeze(geo, P: np.ndarray, R: np.ndarray, *, pin_start: int = 0) -> np.ndarray:
    """Where a vein passes a crevice narrower than itself (e.g. under the left auricle) its lumen is compressed
    rather than pushed into the opposite wall: shrink the radius by the depth its wall still reaches into the
    myocardium (down to 55 %)."""
    ang = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    T, N, B = vs.frames(P)
    ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
    sd = geo.sd(ring.reshape(-1, 3)).reshape(len(P), -1)
    left = np.maximum(0.0, 0.25 * MM - sd).max(axis=1)
    if pin_start:
        left[:pin_start] = 0.0
    R2 = np.maximum(R - ndimage.maximum_filter1d(left, 5), 0.55 * R)
    return np.maximum(np.minimum(R, ndimage.gaussian_filter1d(R2, 2.0, mode="nearest")), MIN_RADIUS_MM * MM)


def _nearest(P, q):
    k = int(np.argmin(np.linalg.norm(P - q, axis=1)))
    return k


def _join(geo, parent: np.ndarray, s_on_parent: float, branch: np.ndarray, s_join: float, R: float) -> np.ndarray:
    """Bridge from the parent centreline at arc length ``s_on_parent`` into ``branch`` at ``s_join``."""
    O, ko = vs.at_s(parent, s_on_parent)
    J, kj = vs.at_s(branch, min(s_join, 0.5 * vs.arclen(branch)[-1]))
    t0 = mo.unit(mo.unit(J - O) - 0.3 * vs.tangent(parent, ko))
    br = vs.hermite(O, t0, J, vs.tangent(branch, kj), SPACING, tension=0.7)
    out = vs.resample(np.vstack([br[:-1], branch[kj:]]), SPACING)
    return geo.seat(out, R, LIFT_MM * MM, snap=True, pin_start=2, iterations=4)


def _hang(tree: VeinTree, parent_idx: int, paths: list[dict], sub_of: dict, label: str, geo, gap=4 * MM, skip=()):
    """Hang BodyParts3D side branches (children of an already placed path) on the tree."""
    for j, p in enumerate(paths):
        if j in sub_of or p["parent"] not in sub_of or j in skip:
            continue
        par = tree.segs[sub_of[p["parent"]]]
        ko = _nearest(par["P"], p["P"][0])
        if np.linalg.norm(par["P"][ko] - p["P"][0]) > gap:
            continue
        Q = np.vstack([par["P"][ko], p["P"][1:]])
        if vs.arclen(Q)[-1] < 8 * MM:
            continue
        d0 = min(0.75 * 2 * float(par["R"][ko]) / MM, CALIBRE[label][0] * 0.6)
        R = taper(Q, d0, max(TIP_MM, 0.5 * d0))
        Q = clear_wall(geo, Q, R, pin_start=2)
        sub_of[j] = tree.add(label, Q, R, parent=sub_of[p["parent"]], side=True)
    return sub_of


def pair_path(geo, P: np.ndarray, side: np.ndarray, offset: float, R: np.ndarray, *, lift: float = LIFT_MM * MM) -> np.ndarray:
    """A companion course beside the path ``P`` (an artery): offset ``offset`` along the epicardial tangent that is
    perpendicular to ``P`` and points towards ``side`` (a direction), then seated on the epicardium."""
    T = np.gradient(vs.smooth(P, 6), axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    N = geo.normal(P)
    B = np.cross(N, T)
    B /= np.maximum(np.linalg.norm(B, axis=1, keepdims=True), 1e-12)
    sgn = np.sign(B @ side)
    sgn[sgn == 0] = 1.0
    sgn = np.sign(ndimage.uniform_filter1d(sgn, 9, mode="nearest") + 1e-9)
    Q = P + B * (sgn * offset)[:, None]
    Q = vs.smooth(Q, 6)
    return geo.seat(Q, R, lift, snap=True, iterations=5, sigma=2.5)


def _graft(geo, host: np.ndarray, branch: np.ndarray, *, max_gap: float, s_join: float = 5 * MM):
    """Re-attach a (BodyParts3D) tributary to a redesigned host course: a Hermite bridge from the host point nearest
    the tributary's drainage end into the tributary at ``s_join``. (None, k) if the tributary starts too far away."""
    k = _nearest(host, branch[0])
    if np.linalg.norm(host[k] - branch[0]) > max_gap or vs.arclen(branch)[-1] < s_join + 6 * MM:
        return None, k
    J, kj = vs.at_s(branch, s_join)
    t0 = mo.unit(mo.unit(J - host[k]) + 0.25 * vs.tangent(host, k))
    br = vs.hermite(host[k], t0, J, vs.tangent(branch, kj), SPACING, tension=0.7)
    return vs.resample(np.vstack([br[:-1], branch[kj:]]), SPACING), k


def _clip_mm(P: np.ndarray, L: float) -> np.ndarray:
    s = vs.arclen(P)
    return P[: max(2, int(np.searchsorted(s, L)) + 1)]


def design(parts, geo, cor: dict, log, *, ivc_V: np.ndarray) -> VeinTree:
    lm = cor["landmarks"]
    ring_ta = geo.rings["TA"]
    ivc_top = ivc_V[ivc_V[:, 2] >= ivc_V[:, 2].max() - 3.0 * MM].mean(axis=0)
    crux = lm["crux"]
    B = lm["bifurcation"]
    src = {
        "GCV": vs.skeleton_paths(*parts.scene("FMA4707"), B),
        "MCV": vs.skeleton_paths(*parts.scene("FMA4713"), crux),
        "PVLV": vs.skeleton_paths(*parts.scene("FMA76751"), crux),
        "ACV": vs.skeleton_paths(*parts.scene("FMA71567"), crux),
    }
    tree = VeinTree()
    deg = np.radians

    # ------------------------------------------------------------------ coronary sinus + great cardiac vein
    # One course in the left AV groove on the atrial side of the mitral hinge: from the septal (posteromedial) end of
    # the annulus round the posterior and lateral wall, below the left auricle, to the left-main bifurcation. The
    # ostium is the first groove point, coming from the septal end, that lies in the right atrium in front of, medial
    # to and above the IVC orifice (REFERENCE.md §6.2); the lumen starts inside the thin right-atrial wall there (a
    # flush ostium). The sinus runs CS_H_MM above the hinge, the GCV GCV_H_MM, never more than GCV_MAX_MM out from it,
    # so it stays in the groove instead of climbing the left-atrial wall (the course of the vein of Marshall).
    th_end = lm["theta_B_deg"] + GCV_END_DEG
    th = deg(np.arange(345.0, th_end, -1.5))
    th_deg = np.degrees(th)
    w = mo.smoothstep(300.0, 270.0, th_deg)
    # laterally the groove bottom lies below the hinge plane (the left atrium bulges out over it): the GCV follows the
    # groove GCV_ABOVE_CREASE_MM on the atrial side of its bottom (the circumflex lies on the ventricular side)
    h_c = geo.crease_h("MA", th)
    w_lat = mo.smoothstep(215.0, 195.0, th_deg)
    h_prof = (1 - w) * CS_H_MM + w * ((1 - w_lat) * GCV_H_MM + w_lat * np.minimum(GCV_H_MM, h_c + GCV_ABOVE_CREASE_MM))
    R_prof = (1 - w) * 4.2 * MM + w * 2.8 * MM
    # posterior groove: seated along the wall normal; lateral groove (below the left auricle and the pulmonary-vein
    # ostia): seated outward along the ring radius at a fixed height, so the vein is never slid up the atrial wall
    G_n = geo.groove("MA", th, h_mm=h_prof, R=R_prof, lift=LIFT_MM * MM, max_mm=GCV_MAX_MM)
    G_r = geo.groove("MA", th, h_mm=h_prof, R=R_prof, lift=LIFT_MM * MM, max_mm=GCV_MAX_MM, radial_seat=True)
    w_r = mo.smoothstep(245.0, 220.0, th_deg)[:, None]
    G = (1 - w_r) * G_n + w_r * G_r
    ok = (G[:, 1] < ivc_top[1] - OSTIUM_IVC_MM[1] * MM) & (G[:, 0] > ivc_top[0] + OSTIUM_IVC_MM[0] * MM)
    ok &= (G[:, 2] > ivc_top[2] + OSTIUM_IVC_MM[2] * MM) & (ring_ta.height(G) > -4 * MM)
    cand = np.flatnonzero(ok & (th_deg >= 280.0))

    def ostium_at(k):
        """The ostium for groove index k: onto the right-atrial wall surface, then 0.8 mm into it."""
        n_ = geo.normal(G[k][None])[0]
        return G[k] - n_ * (geo.sd(G[k][None])[0]) - n_ * 0.8 * MM, n_

    def in_front_of_ivc(o):
        return (o[1] < ivc_top[1] - OSTIUM_IVC_MM[1] * MM and o[0] > ivc_top[0] + OSTIUM_IVC_MM[0] * MM
                and o[2] > ivc_top[2] + OSTIUM_IVC_MM[2] * MM)
    # the valid groove point nearest the crux (the sinus opens beside the crux, COR-26) whose ostium itself lies in
    # front of, medial to and above the IVC orifice
    order = cand[np.argsort(np.linalg.norm(G[cand] - crux, axis=1))] if len(cand) else np.array([_nearest(G, crux)])
    k_os = int(next((k for k in order if in_front_of_ivc(ostium_at(k)[0])), order[0]))
    o_in, o_n = ostium_at(k_os)
    log(f"veins: ostium candidates {len(cand)} (azimuth {th_deg[cand].min() if len(cand) else 0:.0f}-{th_deg[cand].max() if len(cand) else 0:.0f} deg), "
        f"chosen {th_deg[k_os]:.0f} deg, {np.linalg.norm(G[k_os] - crux) / MM:.1f} mm from the crux")
    G = G[k_os:]
    # the sinus reaches its ostium along the groove (tangent to the hinge ring), sinking into the atrial wall over its
    # last few millimetres instead of approaching it obliquely
    k_g = min(int(6 * MM / SPACING), len(G) - 1)
    t_g = vs.tangent(G, min(3, len(G) - 1))
    lead = vs.hermite(o_in, mo.unit(t_g - 0.12 * o_n), G[k_g], vs.tangent(G, k_g), SPACING, tension=0.9)
    trunk = vs.resample(np.vstack([lead[:-1], G[k_g:]]), SPACING)
    trunk = vs.smooth(trunk, 6)
    trunk[0] = o_in
    s = vs.arclen(trunk)
    k_cs = int(np.searchsorted(s, CS_LENGTH_MM * MM))
    cs, gcv_groove = trunk[: k_cs + 1], trunk[k_cs:]
    # GCV -> AIV turn: from the end of the groove course to beside the LAD origin, AIV_START_ON_LAD_MM down the LAD
    # (within ~10 mm of the left-main bifurcation: the triangle of Brocq and Mouchet), on its left-ventricular side
    lad = lm["lad"]
    s_lad = vs.arclen(lad)
    k_j = int(np.searchsorted(s_lad, AIV_START_ON_LAD_MM * MM))
    side_lv = np.array([1.0, 0.0, -0.35])  # patient left (and slightly down): the left-ventricular side of the groove
    aiv_line = pair_path(geo, lad, side_lv, AIV_OFFSET_MM * MM, np.full(len(lad), 1.6 * MM))
    J = aiv_line[k_j]
    t_end = vs.tangent(gcv_groove, len(gcv_groove) - 1)
    bridge = vs.hermite(gcv_groove[-1], t_end, J, vs.tangent(aiv_line, k_j), SPACING, tension=0.8)
    s_end = min(s_lad[-1] - 6 * MM, AIV_LENGTH_MM * MM + s_lad[k_j])
    k_e = int(np.searchsorted(s_lad, s_end))
    course = vs.resample(np.vstack([gcv_groove[:-1], bridge[:-1], aiv_line[k_j: k_e + 1]]), SPACING)
    # the GCV becomes the AIV where the course passes the left-main bifurcation
    k_b = int(np.argmin(np.linalg.norm(course - B, axis=1)))
    gcv, aiv = course[: k_b + 1], course[k_b:]
    R_cs = 0.5 * MM * np.interp(vs.arclen(cs), [0, vs.arclen(cs)[-1]], CALIBRE["CS"])
    R_gcv = 0.5 * MM * np.interp(vs.arclen(gcv), [0, vs.arclen(gcv)[-1]], CALIBRE["GCV"])
    cs = clear_wall(geo, cs, R_cs, pin_start=3)
    cs[0] = o_in
    gcv = clear_wall(geo, gcv, R_gcv, pin_start=1, snap=False)
    gcv[0] = cs[-1]
    i_cs = tree.add("CS", cs, R_cs)
    i_gcv = tree.add("GCV", gcv, R_gcv, parent=i_cs)

    # ------------------------------------------------------------------ AIV: beside the LAD, on its LV side
    aiv[0] = tree.segs[i_gcv]["P"][-1]
    aiv = vs.smooth(aiv, 3)
    R_aiv = taper(aiv, *CALIBRE["AIV"])
    aiv = clear_wall(geo, aiv, R_aiv, pin_start=2)
    i_aiv = tree.add("AIV", aiv, R_aiv, parent=i_gcv)
    g0 = src["GCV"][0]["P"]
    k_turn = int(np.argmin(np.where(np.arange(len(g0)) < len(g0) * 0.6, cKDTree(lad[: max(4, len(lad) // 3)]).query(g0)[0], np.inf)))
    n_trib = 0
    for p in src["GCV"][1:]:  # AIV tributaries (BodyParts3D), re-attached to the new course
        if p["parent"] != 0 or _nearest(g0, p["P"][0]) < k_turn:
            continue
        Q, ko = _graft(geo, aiv, p["P"], max_gap=9 * MM)
        if Q is None:
            continue
        d0 = min(0.75 * 2 * float(R_aiv[ko]) / MM, 2.0)
        R = taper(Q, d0, max(TIP_MM, 0.5 * d0))
        tree.add("AIV", clear_wall(geo, Q, R, pin_start=2), R, parent=i_aiv, side=True)
        n_trib += 1

    # ------------------------------------------------------------------ MCV: joins the CS where it passes the crux
    m0 = _clip_mm(src["MCV"][0]["P"], MCV_MAX_MM * MM)
    k_cx = _nearest(cs, crux)
    s_mj = float(np.clip(vs.arclen(cs)[k_cx], 4 * MM, 14 * MM))
    mcv = _join(geo, cs, s_mj, m0, 14 * MM, 2.2 * MM)
    mcv = _clip_mm(mcv, MCV_MAX_MM * MM)
    R_mcv = taper(mcv, *CALIBRE["MCV"])
    mcv = clear_wall(geo, mcv, R_mcv, pin_start=2)
    i_mcv = tree.add("MCV", mcv, R_mcv, parent=i_cs)
    for p in src["MCV"][1:]:
        if p["parent"] != 0:
            continue
        Q, ko = _graft(geo, mcv, p["P"], max_gap=5 * MM)
        if Q is None or vs.arclen(Q)[-1] < 8 * MM:
            continue
        d0 = min(0.75 * 2 * float(R_mcv[ko]) / MM, 2.0)
        R = taper(Q, d0, max(TIP_MM, 0.5 * d0))
        tree.add("MCV", clear_wall(geo, Q, R, pin_start=2), R, parent=i_mcv, side=True)

    # ------------------------------------------------------------------ PVLV (posterior piece) and LMV (lateral piece)
    comps: dict[int, list[int]] = {}
    for j, p in enumerate(src["PVLV"]):
        comps.setdefault(p["component"], []).append(j)
    pieces = []
    for c, idx in comps.items():
        P0 = src["PVLV"][idx[0]]["P"]
        d_om1 = float(np.median(cKDTree(lm["om1"]).query(P0)[0]))
        pieces.append((d_om1, idx))
    pieces.sort()
    for n, (d_om1, idx) in enumerate(pieces):
        label = "LMV" if (n == 0 and len(pieces) > 1) else "PVLV"
        paths = [src["PVLV"][j] for j in idx]
        remap = {j: i for i, j in enumerate(idx)}
        paths = [{**p, "parent": remap.get(p["parent"])} for p in paths]
        main = paths[0]["P"]
        host = gcv if label == "LMV" else np.vstack([cs, gcv[1:]])
        k_h = _nearest(host, main[0])
        s_h = float(vs.arclen(host)[k_h])
        br = _join(geo, host, s_h, main, 10 * MM, 1.5 * MM)
        R = taper(br, *CALIBRE[label])
        br = clear_wall(geo, br, R, pin_start=2)
        parent = i_gcv if label == "LMV" else (i_cs if s_h <= vs.arclen(cs)[-1] else i_gcv)
        i_p = tree.add(label, br, R, parent=parent)
        _hang(tree, i_p, paths, {0: i_p}, label, geo)
        log(f"veins: {label} joins the {'GCV' if parent == i_gcv else 'CS'} {s_h / MM:.0f} mm from the CS ostium "
            f"(median {d_om1 / MM:.0f} mm from OM1)")

    # ------------------------------------------------------------------ SCV in the right AV groove, RMV on the acute margin
    # The small cardiac vein runs in the posterior right AV groove beside the distal RCA (on its atrial side), from the
    # coronary-sinus ostium towards the acute margin, where it receives the right marginal vein that ascends along the
    # acute margin with the acute marginal artery (REFERENCE.md §6).
    th_o = float(np.degrees(ring_ta.theta_of(o_in[None])[0]))
    am = lm.get("am")
    th_am = float(np.degrees(ring_ta.theta_of(am[:1])[0])) if am is not None else th_o + 60.0
    # the RCA runs from the anterior groove (small azimuths) to the crux: towards the acute margin from the ostium the
    # azimuth rises or falls - go the short way round
    dth = ((th_am - th_o + 180.0) % 360.0) - 180.0
    th_s = deg(th_o + np.sign(dth) * np.arange(0.0, min(abs(dth), 150.0), 1.5))
    G_ta = geo.groove("TA", th_s, h_mm=SCV_H_MM, R=1.2 * MM, lift=LIFT_MM * MM, max_mm=10.0)
    scv_line = _clip_mm(vs.resample(G_ta, SPACING), SCV_MAX_MM * MM)
    k0 = max(2, min(_nearest(cs, scv_line[0]), int(5 * MM / SPACING)))
    J2, kj2 = vs.at_s(scv_line, 6 * MM)
    br = vs.hermite(cs[k0], mo.unit(mo.unit(J2 - cs[k0]) + 0.2 * vs.tangent(cs, k0)), J2, vs.tangent(scv_line, kj2), SPACING, tension=0.7)
    scv = vs.resample(np.vstack([br[:-1], scv_line[kj2:]]), SPACING)
    R_scv = taper(scv, *CALIBRE["SCV"], tip=am is None)
    scv = clear_wall(geo, scv, R_scv, pin_start=2)
    i_scv = tree.add("SCV", scv, R_scv, parent=i_cs, end="cone" if am is None else "round")
    if am is not None:
        am_line = _clip_mm(am, RMV_MAX_MM * MM)
        rmv_line = pair_path(geo, am_line, np.array([0.0, 0.3, -1.0]), 3.0 * MM, np.full(len(am_line), 0.9 * MM))
        J3, kj3 = vs.at_s(rmv_line, 8 * MM)
        br = vs.hermite(scv[-1], vs.tangent(scv, len(scv) - 1), J3, vs.tangent(rmv_line, kj3), SPACING, tension=0.7)
        rmv = vs.resample(np.vstack([br[:-1], rmv_line[kj3:]]), SPACING)
        R_rmv = taper(rmv, *CALIBRE["RMV"])
        rmv = clear_wall(geo, rmv, R_rmv, pin_start=2)
        tree.add("RMV", rmv, R_rmv, parent=i_scv)

    # ------------------------------------------------------------------ anterior cardiac veins: short, anterior RV -> RA
    acv = src["ACV"]
    roots = sorted([j for j, p in enumerate(acv) if p["parent"] is not None and vs.arclen(p["P"])[-1] > 25 * MM],
                   key=lambda j: -vs.arclen(acv[j]["P"])[-1])[:N_ACV]
    for j in roots:
        p = acv[j]["P"]
        # drainage end = the end of the branch nearer the tricuspid annulus; open it into the RA above the annulus
        if ring_ta.dist(p[-1:])[0] < ring_ta.dist(p[:1])[0]:
            p = p[::-1]
        th_e = float(ring_ta.theta_of(p[:1])[0])
        ra = ring_ta.point(th_e, radial=4 * MM, h=12 * MM)[0]
        k_ra = int(np.argmin(np.linalg.norm(geo.E - ra, axis=1)))
        o_s, o_n2 = geo.E[k_ra], geo.EN[k_ra]
        o_in2 = o_s - o_n2 * 0.6 * MM
        J, kj = vs.at_s(p, 6 * MM)
        br = vs.hermite(o_in2, mo.unit(-o_n2 * 0.3 + mo.unit(J - o_in2)), J, vs.tangent(p, kj), SPACING, tension=0.8)
        Q = _clip_mm(vs.resample(np.vstack([br[:-1], p[kj:]]), SPACING), ACV_MAX_MM * MM)
        R = taper(Q, *CALIBRE["ACV"])
        Q = clear_wall(geo, Q, R, pin_start=3)
        Q[0] = o_in2
        keep = int(np.searchsorted(vs.arclen(Q), ACV_MAX_MM * MM)) + 1  # seating stretched it: cut again
        Q = Q[:max(4, keep)]
        R = taper(Q, *CALIBRE["ACV"])  # and thin the new tip out
        tree.add("ACV", Q, R)
    log(f"veins: CS ostium {np.linalg.norm(o_in - crux) / MM:.0f} mm from the crux, MCV joins {s_mj / MM:.0f} mm from it; "
        f"AIV starts {np.linalg.norm(aiv[0] - B) / MM:.0f} mm from the LM bifurcation ({n_trib} tributaries); "
        f"{len(tree.segs)} labelled segments " + str({k: sum(1 for sg in tree.segs if sg['label'] == k) for k in CODES}))
    for sg in tree.segs:  # compress lumens in crevices, but never at a junction (the tree stays one lumen)
        sg["R"] = np.maximum(squeeze(geo, sg["P"], sg["R"], pin_start=6), np.where(np.arange(len(sg["R"])) < 6, sg["R"], 0.0))
    tree.ostium = o_in
    tree.crux = crux
    return tree


#: Ring spacing of the vein tubes relative to the arteries': the veins run along the grooves with gentle curvature, and the
#: coarser rings keep the swept mesh under its triangle budget so it is never collapse-decimated (which leaves loose
#: triangles and open tips on thin tubes).
RING_SPACING = 1.45


def mesh(tree: VeinTree) -> mo.Mesh:
    return mo.concat([vs.sweep(sg["P"], sg["R"], start=sg["start"], end=sg["end"], spacing=RING_SPACING) for sg in tree.segs])


def lines_json(tree: VeinTree, to_mm) -> list[dict]:
    return [{"label": sg["label"], "code": CODES[sg["label"]], "parent": sg["parent"], "side": bool(sg["side"]),
             "points_mm": np.round(to_mm(sg["P"]), 4).tolist(), "radius_mm": np.round(sg["R"] / MM, 4).tolist()}
            for sg in tree.segs]
