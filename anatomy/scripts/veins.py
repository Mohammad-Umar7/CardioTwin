"""Cardiac veins (synthesis stage): one labelled venous tree draining through the coronary sinus, plus the
anterior cardiac veins that open directly into the right atrium.

BodyParts3D's cardiac-vein parts are collapsed (cadaveric), partly sunk into the myocardium and their coronary
sinus approaches the mitral annulus obliquely (REFERENCE.md §6). The courses are rebuilt around the corrected
coronary tree (``coronary.py``):

* **Coronary sinus (CS)** — its ostium opens flush into the posteroinferior right atrium, anteromedial to the IVC
  orifice and next to the crux (where the PDA arises); it runs leftwards in the posterior atrioventricular
  groove, 5-15 mm on the atrial side of the mitral hinge, for ~40 mm (valve of Vieussens / vein of Marshall).
* **Great cardiac vein (GCV)** — continues in the left AV groove on the atrial side of the circumflex (the LCX
  lies between it and the mitral annulus), passes below the left auricle and turns at the left-main
  bifurcation into the **anterior interventricular vein (AIV)**, whose course is BodyParts3D (beside the LAD).
* **Middle cardiac vein (MCV)** — BodyParts3D course with the PDA; it joins the CS ~10 mm from the ostium.
* **Posterior vein of the LV (PVLV)** and **left marginal vein (LMV)** — the two BodyParts3D "posterior LV
  vein" pieces: the posterior one drains into the CS, the lateral one (running with OM1) into the GCV.
* **Small cardiac vein (SCV)** — the BodyParts3D "anterior cardiac vein" tree drains on the inferior right
  ventricle next to the MCV, i.e. it is a small-cardiac / right-marginal pattern: its trunk now joins the CS
  near the ostium. Two of its anterior RV branches become true **anterior cardiac veins (ACV)**: they cross
  the RCA in the right AV groove and open into the anterior right-atrial wall above the tricuspid annulus.

Calibres grow monotonically towards each drainage end (in-vivo CT: CS ~10 mm at the ostium, MCV 4.5 mm,
proximal AIV 3.5-4 mm) and every distal tip thins to ~0.6 mm over its last 40 %.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

import meshops as mo
import vascular as vs
from vascular import MM

SPACING = 0.8 * MM
#: Vein label codes (``_VEIN`` vertex attribute, manifest ``veins``). 1-6 are unchanged from contract v1.1.
CODES = {"CS": 1, "GCV": 2, "AIV": 3, "MCV": 4, "PVLV": 5, "ACV": 6, "LMV": 7, "SCV": 8}
NAMES = {"CS": "Coronary sinus", "GCV": "Great cardiac vein", "AIV": "Anterior interventricular vein",
         "MCV": "Middle cardiac vein", "PVLV": "Posterior vein of the left ventricle", "ACV": "Anterior cardiac vein",
         "LMV": "Left marginal vein", "SCV": "Small cardiac vein"}
#: Diameters (mm): at the drainage end and at the start of the distal taper of each course.
CALIBRE = {"CS": (10.0, 8.6), "GCV": (6.6, 4.6), "AIV": (4.0, 1.3), "MCV": (4.6, 1.3), "PVLV": (3.2, 1.0),
           "LMV": (3.0, 1.0), "SCV": (2.4, 0.9), "ACV": (1.9, 0.8)}
TIP_MM = 0.65
CS_LENGTH_MM = 40.0
LIFT_MM = 0.25


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
    return 0.5 * d * MM


def clear_wall(geo, P: np.ndarray, R: np.ndarray, *, lift: float = LIFT_MM * MM, pin_start: int = 0) -> np.ndarray:
    """Seat a vein on the epicardium and push it out wherever its tube wall still dips into the myocardium
    (thin tips lie lower: their wall touches the epicardium)."""
    lift = np.where(R < 0.6 * MM, 0.08 * MM, lift)
    P = geo.seat(P, R, lift, snap=True, pin_start=pin_start, iterations=5)
    ang = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    w = np.ones(len(P))
    if pin_start:
        w[:pin_start] = 0.0
    for _ in range(6):
        T, N, B = vs.frames(P)
        ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
        sd = geo.sd(ring.reshape(-1, 3)).reshape(len(P), -1)
        depth = np.maximum(0.0, 0.3 * MM - sd)
        if depth.max() < 0.05 * MM:
            break
        nrm = geo.normal(ring.reshape(-1, 3)).reshape(len(P), -1, 3)
        disp = (nrm * depth[..., None]).max(axis=1) * w[:, None]
        P = P + ndimage.gaussian_filter1d(disp, 1.5, axis=0, mode="nearest")
    return P


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
    return np.minimum(R, ndimage.gaussian_filter1d(R2, 2.0, mode="nearest"))


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


def design(parts, geo, cor: dict, log, *, ivc_V: np.ndarray) -> VeinTree:
    lm = cor["landmarks"]
    ring_ma, ring_ta = geo.rings["MA"], geo.rings["TA"]
    ivc_top = ivc_V[ivc_V[:, 2] >= ivc_V[:, 2].max() - 3.0 * MM].mean(axis=0)
    crux = lm["crux"]
    src = {
        "GCV": vs.skeleton_paths(*parts.scene("FMA4707"), lm["bifurcation"]),
        "MCV": vs.skeleton_paths(*parts.scene("FMA4713"), crux),
        "PVLV": vs.skeleton_paths(*parts.scene("FMA76751"), lm["bifurcation"] * 0 + crux),
        "ACV": vs.skeleton_paths(*parts.scene("FMA71567"), crux),
    }
    tree = VeinTree()
    deg = np.radians

    # ------------------------------------------------------------------ coronary sinus + great cardiac vein
    # The sinus follows the posterior left AV groove on the atrial side of the mitral hinge (h = 8.5 mm) all the way
    # to its ostium: the groove is traced from the septal (posteromedial) end of the mitral annulus round the
    # posterior and lateral wall to the left-main bifurcation. The ostium is the first groove point, coming from the
    # septal end, that lies in the right atrium anteromedial to and above the IVC orifice (REFERENCE.md §6.2); the
    # lumen enters the thin right-atrial wall there, so its flat start is hidden in the wall (a flush ostium).
    th = deg(np.arange(345.0, lm["theta_B_deg"] + 4.0, -1.5))
    th_deg = np.degrees(th)
    # near the ostium the sinus runs at the hinge level (4 mm atrial), rising to 8.5 mm along the posterior groove
    G_lo = geo.groove("MA", th, h_mm=4.0, R=3.2 * MM, lift=LIFT_MM * MM, max_mm=15.0)
    G_hi = geo.groove("MA", th, h_mm=8.5, R=3.2 * MM, lift=LIFT_MM * MM, max_mm=15.0)
    w = mo.smoothstep(305.0, 280.0, th_deg)[:, None]
    G = geo.seat((1 - w) * G_lo + w * G_hi, 4.0 * MM, LIFT_MM * MM, snap=True, iterations=3, sigma=3.0)
    ok = (G[:, 1] < ivc_top[1] - 0.6 * MM) & (G[:, 0] > ivc_top[0] + 3 * MM) & (G[:, 2] > ivc_top[2] + 4 * MM)
    ok &= ring_ta.height(G) > -4 * MM
    cand = np.flatnonzero(ok & (th_deg >= 280.0))
    k_os = int(cand.max()) if len(cand) else _nearest(G, crux)  # nearest the posterior groove

    def ostium_at(k):
        """The ostium for groove index k: onto the right-atrial wall surface, then 0.8 mm into it."""
        o_n_ = geo.normal(G[k][None])[0]
        o_s_ = G[k] - o_n_ * (geo.sd(G[k][None])[0])
        return o_s_ - o_n_ * 0.8 * MM, o_n_

    o_in, o_n = ostium_at(k_os)
    steps = 0
    while k_os > 0 and steps < 5 and not (o_in[1] < ivc_top[1] - 1.0 * MM and o_in[0] > ivc_top[0] + 3 * MM and o_in[2] > ivc_top[2] + 4 * MM):
        k_os -= 1  # a few degrees towards the septal end of the annulus: the ostium should lie in front of the IVC
        steps += 1
        o_in, o_n = ostium_at(k_os)
    G = G[k_os:]
    k_g = min(3, len(G) - 1)
    t_g = vs.tangent(G, k_g)
    lead = vs.hermite(o_in, mo.unit(t_g - 0.25 * o_n), G[k_g], t_g, SPACING, tension=0.8)
    trunk = vs.resample(np.vstack([lead[:-1], G[k_g:]]), SPACING)
    trunk = vs.smooth(trunk, 8)
    trunk[0] = o_in
    s = vs.arclen(trunk)
    k_cs = int(np.searchsorted(s, CS_LENGTH_MM * MM))
    cs, gcv = trunk[: k_cs + 1], trunk[k_cs:]
    R_cs = 0.5 * MM * np.interp(vs.arclen(cs), [0, vs.arclen(cs)[-1]], CALIBRE["CS"])
    R_gcv = 0.5 * MM * np.interp(vs.arclen(gcv), [0, vs.arclen(gcv)[-1]], CALIBRE["GCV"])
    cs = clear_wall(geo, cs, R_cs, pin_start=3)
    cs[0] = o_in
    gcv = clear_wall(geo, gcv, R_gcv, pin_start=1)
    gcv[0] = cs[-1]
    i_cs = tree.add("CS", cs, R_cs)
    i_gcv = tree.add("GCV", gcv, R_gcv, parent=i_cs)

    # ------------------------------------------------------------------ AIV: BodyParts3D course beside the LAD
    g0 = src["GCV"][0]["P"]
    # the source "great cardiac vein" part = GCV (AV groove) + AIV (interventricular): keep the part that runs
    # down the anterior interventricular groove, from where it is nearest the LAD origin
    lad = lm["lad"]
    d_lad = cKDTree(lad[: max(4, len(lad) // 3)]).query(g0)[0]
    k_turn = int(np.argmin(np.where(np.arange(len(g0)) < len(g0) * 0.6, d_lad, np.inf)))
    aiv_src = g0[k_turn:]
    aiv = _join(geo, gcv, vs.arclen(gcv)[-1], aiv_src, 8 * MM, 1.8 * MM)
    R_aiv = taper(aiv, *CALIBRE["AIV"])
    aiv = clear_wall(geo, aiv, R_aiv, pin_start=2)
    i_aiv = tree.add("AIV", aiv, R_aiv, parent=i_gcv)
    sub = {0: i_aiv}
    for j, p in enumerate(src["GCV"][1:], start=1):  # AIV tributaries
        if p["parent"] != 0 or _nearest(g0, p["P"][0]) < k_turn:
            continue
        ko = _nearest(aiv, p["P"][0])
        if np.linalg.norm(aiv[ko] - p["P"][0]) > 5 * MM:
            continue
        Q = np.vstack([aiv[ko], p["P"][1:]])
        d0 = min(0.75 * 2 * float(R_aiv[ko]) / MM, 2.0)
        R = taper(Q, d0, max(TIP_MM, 0.5 * d0))
        sub[j] = tree.add("AIV", clear_wall(geo, Q, R, pin_start=2), R, parent=i_aiv, side=True)
    _hang(tree, i_aiv, src["GCV"], sub, "AIV", geo)

    # ------------------------------------------------------------------ MCV: joins the CS ~10 mm from the ostium
    m0 = src["MCV"][0]["P"]
    mcv = _join(geo, cs, 9 * MM, m0, 16 * MM, 2.2 * MM)
    R_mcv = taper(mcv, *CALIBRE["MCV"])
    mcv = clear_wall(geo, mcv, R_mcv, pin_start=2)
    i_mcv = tree.add("MCV", mcv, R_mcv, parent=i_cs)
    _hang(tree, i_mcv, src["MCV"], {0: i_mcv}, "MCV", geo)

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

    # ------------------------------------------------------------------ SCV (inferior RV) and ACVs (anterior RV -> RA)
    acv = src["ACV"]
    main = acv[0]["P"]
    scv = _join(geo, cs, 4 * MM, main, 10 * MM, 1.0 * MM)
    R_scv = taper(scv, *CALIBRE["SCV"])
    scv = clear_wall(geo, scv, R_scv, pin_start=2)
    i_scv = tree.add("SCV", scv, R_scv, parent=i_cs)
    acv_roots = [j for j, p in enumerate(acv) if p["parent"] is not None and vs.arclen(p["P"])[-1] > 40 * MM][:2]
    sub = {0: i_scv}
    for j in acv_roots:
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
        Q = vs.resample(np.vstack([br[:-1], p[kj:]]), SPACING)
        R = taper(Q, *CALIBRE["ACV"])
        Q = clear_wall(geo, Q, R, pin_start=3)
        Q[0] = o_in2
        i_a = tree.add("ACV", Q, R)
        sub[j] = i_a
    _hang(tree, i_scv, acv, sub, "SCV", geo)
    for sg in tree.segs:  # side branches of an ACV are ACV tributaries
        if sg["label"] == "SCV" and sg["parent"] is not None and tree.segs[sg["parent"]]["label"] == "ACV":
            sg["label"] = "ACV"
    log(f"veins: CS ostium {np.linalg.norm(o_in - crux) / MM:.0f} mm from the crux; {len(tree.segs)} labelled segments " +
        str({k: sum(1 for sg in tree.segs if sg['label'] == k) for k in CODES}))
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
