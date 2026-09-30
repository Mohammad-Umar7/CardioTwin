"""Atrioventricular valve apparatus (synthesis stage): mitral and tricuspid leaflets, chordae tendineae and papillary
muscles designed on the BodyParts3D heart.

BodyParts3D's AV valves are rigid, opaque "T"-shaped slabs whose chordae are 3-5 mm parallel strings, and its
papillary muscles are corrugated lumps (REFERENCE.md §4.5). They are replaced by an apparatus built from their
positions (the hinge rings fitted exactly as ``anatomy/checks`` fits them and the papillary muscles' roots and
heads), in a half-open (early diastolic) position so both leaflets of the mitral valve and all three of the
tricuspid valve can be named in an opened heart or a four-chamber section:

* **Leaflets** — thin (1.0 mm, thickening to 1.7 mm over the rough zone near the free edge) veils hinged
  continuously on the annulus (the hinge follows the wall at the fitted ring) and hanging into the ventricle
  25-35 deg inward from the ring axis. Mitral: the anterior (aortic) leaflet takes the third of the annulus next to
  the aortic root and is about twice as tall (22 mm) as the posterior leaflet (12 mm, three scallops P1-P3 with
  clefts); commissures dip to ~7 mm. Tricuspid: anterior (largest), septal and posterior leaflets; the septal
  leaflet is hinged on the septum TV_SEPTAL_DROP_MM more apically than the rest of the annulus (the normal
  apical offset of the tricuspid septal hinge relative to the anterior mitral hinge, REFERENCE.md §4.2).
* **Chordae tendineae** — from each papillary head, fans of first-order chordae (Ø 1.0 mm) that divide at ~60 %
  of their length into second-order chordae (Ø 0.6 mm) inserting on the free edge (marginal) and on the rough zone
  of the ventricular surface; each papillary muscle serves the adjacent halves of the two leaflets at its commissure.
* **Papillary muscles** — smooth, endocardium-covered cones from their root on the ventricular wall (sunk into
  it) to a rounded head (two heads for the LV muscles), placed from the BodyParts3D muscles.

Everything is deterministic and written in the synthesis scene frame (``synthesize.py`` converts to millimetres).
"""
from __future__ import annotations

import math

import numpy as np
import trimesh
from scipy import ndimage

import meshops as mo
import vascular as vs
from vascular import MM

#: Leaflet heights (mm, hinge -> free edge) and the inward tilt of the half-open leaflets.
MV_AML_H, MV_PML_H, MV_COMM_H, MV_CLEFT_H = 22.0, 12.5, 7.0, 8.0
MV_AML_SPAN_DEG = 125.0
TV_H = {"anterior": 21.0, "septal": 16.0, "posterior": 16.0}
TV_COMM_H = 8.0
TILT_DEG = {"MV_A": 33.0, "MV_P": 24.0, "TV": 27.0}
#: Tricuspid septal-leaflet hinge: lowered this far towards the apex at the centre of the septal sector.
TV_SEPTAL_DROP_MM = 22.0
TV_SEPTAL_HALF_WIDTH_DEG = 55.0
LEAFLET_T_MM = (1.0, 1.7)   # body, rough zone
N_THETA, N_V = 90, 9
CHORD_D_MM = (1.0, 0.6, 0.42)  # first-order, second-order, at the insertion
PAP_R_MM = (6.5, 4.4, 2.7)     # root, mid, head


def rows(v: np.ndarray) -> np.ndarray:
    """Row-wise unit vectors (``meshops.unit`` normalises a single vector)."""
    v = np.asarray(v, float)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def _closest_on_wall(tm: trimesh.Trimesh, P: np.ndarray) -> np.ndarray:
    return trimesh.proximity.closest_point(tm, P)[0]


def hinge_line(tm: trimesh.Trimesh, ring, thetas: np.ndarray, drop: np.ndarray | None = None,
               radial: float = 0.0) -> np.ndarray:
    """The leaflet hinge: the fitted ring (optionally lowered by ``drop`` towards the ventricle) projected onto the
    wall and smoothed along the ring; sunk 0.4 mm into the wall so the veil starts inside the myocardium."""
    h = -(drop if drop is not None else np.zeros(len(thetas)))
    P = np.vstack([ring.point(t, radial=radial, h=hh)[0] for t, hh in zip(thetas, h)])
    W = _closest_on_wall(tm, P)
    for _ in range(3):
        W = vs.smooth(np.vstack([W[-3:], W, W[:3]]), 3, pin_start=False, pin_end=False)[3:-3]
        W = _closest_on_wall(tm, W)
    # halfway between the fitted ring and the wall: attached (<= 1 mm from the wall) yet keeping the ring's size, so
    # the annulus the checks fit on the published valve is the one the grooves were traced on
    return 0.5 * (W + P)


def leaflet_solid(H: np.ndarray, D: np.ndarray, L: np.ndarray, inward: np.ndarray, *, nv: int = N_V,
                  billow_mm: float = 1.6) -> tuple[mo.Mesh, np.ndarray]:
    """Closed veil: hinge ``H`` (n x 3, a closed loop) -> free edge along the unit directions ``D`` over lengths
    ``L``; a gentle billow towards the orifice (``inward``). Returns the mesh and the mid-surface grid."""
    n = len(H)
    v = np.linspace(0.0, 1.0, nv)
    S = H[:, None, :] + (L[:, None] * v[None, :])[..., None] * D[:, None, :]
    S = S + (billow_mm * MM * np.sin(np.pi * v) ** 1.2)[None, :, None] * inward[:, None, :]
    dth = (np.roll(S, -1, axis=0) - np.roll(S, 1, axis=0))
    dv = np.gradient(S, axis=1)
    nrm = np.cross(dth, dv)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-12)
    t = (LEAFLET_T_MM[0] + (LEAFLET_T_MM[1] - LEAFLET_T_MM[0]) * mo.smoothstep(0.62, 0.9, v)
         + 0.3 * (1 - mo.smoothstep(0.0, 0.15, v))) * MM
    A = (S + 0.5 * t[None, :, None] * nrm).reshape(-1, 3)
    Bv = (S - 0.5 * t[None, :, None] * nrm).reshape(-1, 3)
    m = n * nv
    V = np.vstack([A, Bv])

    def idx(i, j):
        return (i % n) * nv + j
    F = []
    for i in range(n):
        for j in range(nv - 1):
            a, b, c, d = idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i + 1, j + 1)
            F += [(a, b, d), (a, d, c), (m + a, m + d, m + b), (m + a, m + c, m + d)]
    for i in range(n):  # hinge and free-edge rims
        for j in (0, nv - 1):
            a, b = idx(i, j), idx(i + 1, j)
            F += [(a, m + a, m + b), (a, m + b, b)] if j == 0 else [(a, b, m + b), (a, m + b, m + a)]
    F = np.array(F, dtype=np.int64)
    if mo.signed_volume(V, F) < 0:
        F = F[:, ::-1]
    return (V, F), S


def chord(P0: np.ndarray, P1: np.ndarray, d0: float, d1: float, *, sides: int = 6, flare: bool = False) -> mo.Mesh:
    """A taut chorda tendinea from ``P0`` to ``P1`` (diameters in mm); ``flare`` widens the insertion."""
    n = max(3, int(np.linalg.norm(P1 - P0) / (7.0 * MM)) + 2)
    t = np.linspace(0.0, 1.0, n)
    if flare:  # an extra ring just before the insertion carries the flare into the leaflet
        t = np.unique(np.r_[t, 0.9])
    P = P0[None] + t[:, None] * (P1 - P0)[None]
    d = d0 + (d1 - d0) * t
    if flare:
        d = d + 0.45 * mo.smoothstep(0.85, 1.0, t)
    # both ends are buried (in a papillary head, a branch point or a leaflet): flat caps
    return vs.sweep(P, 0.5 * d * MM, start="flat", end="flat", sides=sides, adaptive=False)


def papillary_muscle(root: np.ndarray, head: np.ndarray, into_wall: np.ndarray, *, heads: int = 1) -> tuple[mo.Mesh, list]:
    """Smooth cone rising from its root on the ventricular wall (first along the wall normal, so its flat base lies
    1 mm inside the wall and never shows through a thin right-ventricular wall) and bending to a rounded head (two
    small heads for the LV muscles)."""
    n = mo.unit(into_wall)  # points from the wall into the cavity
    start = root - n * 1.0 * MM
    p1 = root + n * 3.5 * MM
    a = mo.unit(head - p1)
    P = vs.hermite(p1, n, head, a, 1.5 * MM, tension=0.8)
    P = np.vstack([start, P])
    s = vs.arclen(P)
    t = s / s[-1]
    r = np.interp(t, [0.0, 0.08, 0.3, 0.65, 1.0], [PAP_R_MM[0] + 0.8, PAP_R_MM[0], PAP_R_MM[0] - 0.8, PAP_R_MM[1], PAP_R_MM[2]]) * MM
    meshes = [vs.sweep(P, r, start="flat", end="round", sides=16, adaptive=False)]
    tips = [head]
    if heads == 2:  # bifid: two small heads on the rounded end
        side = mo.unit(np.cross(a, [0.0, 0.0, 1.0]) if abs(a[2]) < 0.9 else np.cross(a, [1.0, 0.0, 0.0]))
        off = side * 2.6 * MM
        tips = []
        for sgn in (-1.0, 1.0):
            h0 = head - a * 3.0 * MM
            h1 = head + a * 2.2 * MM + sgn * off
            Q = vs.resample(np.vstack([h0, 0.5 * (h0 + h1) + sgn * off * 0.3, h1]), 1.0 * MM)
            meshes.append(vs.sweep(Q, np.linspace(2.4, 1.7, len(Q)) * MM, start="round", end="round", sides=12, adaptive=False))
            tips.append(h1)
    return mo.concat(meshes), tips


def _sector(th: np.ndarray, centre: float, half: float) -> np.ndarray:
    return np.abs(((th - centre + np.pi) % (2 * np.pi)) - np.pi) <= half


def _fan_chordae(tip: np.ndarray, S: np.ndarray, thetas: np.ndarray, centre: float, half: float, *,
                 step: int = 2, per_fan: int = 3) -> list:
    """Chordae from a papillary head to the free edge and rough zone of the leaflet sector ``centre +- half``."""
    idx = np.flatnonzero(_sector(thetas, centre, half))
    if not len(idx):
        return []
    # order the sector along the ring
    rel = ((thetas[idx] - centre + np.pi) % (2 * np.pi)) - np.pi
    idx = idx[np.argsort(rel)]
    nv = S.shape[1]
    ins = [(i, nv - 1) for i in idx[::step]] + [(i, int(round(0.72 * (nv - 1)))) for i in idx[1::step * 2]]
    ins.sort(key=lambda x: (((thetas[x[0]] - centre + np.pi) % (2 * np.pi)) - np.pi, -x[1]))
    meshes = []
    for g in range(0, len(ins), per_fan):
        group = ins[g:g + per_fan]
        pts = np.array([S[i, j] for i, j in group])
        B = tip + 0.6 * (pts.mean(axis=0) - tip)
        meshes.append(chord(tip, B, CHORD_D_MM[0], CHORD_D_MM[0] * 0.9, sides=6))
        for q in pts:
            meshes.append(chord(B, q, CHORD_D_MM[1], CHORD_D_MM[2], sides=5, flare=True))
    return meshes


def _pap_root_head(X: np.ndarray, ring, tm: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Root (on the wall) and head (towards the valve) of a BodyParts3D papillary muscle."""
    d = ring.dist(X)
    head = X[d <= np.quantile(d, 0.04)].mean(axis=0)
    root_pts = X[d >= np.quantile(d, 0.8)]
    root = root_pts.mean(axis=0)
    q, _, tri = trimesh.proximity.closest_point(tm, root[None])
    root = q[0]
    into = tm.face_normals[tri[0]]
    return root, head, into


def design(parts, geo, log, *, aortic_centre: np.ndarray) -> dict:
    """Mitral and tricuspid apparatus. Returns meshes (scene frame) and the mitral hinge line for the curtain."""
    tm = geo.tm
    out = {}
    report = {}
    th = np.linspace(0.0, 2 * np.pi, N_THETA, endpoint=False)

    # ------------------------------------------------------------------ papillary muscles
    pap = {}
    for key, pid, ring_key, heads in (("LV_AL", "FMA9352nsn", "MA", 2), ("LV_PM", "FMA7266", "MA", 2),
                                      ("RV_A", "FMA7260", "TA", 1), ("RV_P", "FMA7261", "TA", 1), ("RV_S", "FMA7262", "TA", 1)):
        X, _ = parts.scene(pid)
        root, head, into = _pap_root_head(X, geo.rings[ring_key], tm)
        # the head is pulled 25 % towards the root: BodyParts3D's heads reach up into the leaflets
        head = root + 0.8 * (head - root)
        mesh, tips = papillary_muscle(root, head, into, heads=heads)
        pap[key] = {"mesh": mesh, "tips": tips, "ring": ring_key, "theta": float(geo.rings[ring_key].theta_of(head[None])[0])}
    out["SYN_PapillaryMuscles"] = mo.concat([p["mesh"] for p in pap.values()])

    # ------------------------------------------------------------------ mitral valve
    ma = geo.rings["MA"]
    th_a = float(ma.theta_of(aortic_centre[None])[0])
    half_a = math.radians(MV_AML_SPAN_DEG / 2)
    rel = ((th - th_a + np.pi) % (2 * np.pi)) - np.pi
    aml = np.abs(rel) <= half_a
    # heights: AML dome, PML three scallops with clefts, commissures low
    h_aml = MV_COMM_H + (MV_AML_H - MV_COMM_H) * np.cos(np.clip(rel / half_a, -1, 1) * np.pi / 2) ** 1.2
    prel = (np.abs(rel) - half_a) / (np.pi - half_a)  # 0 at the commissures, 1 opposite the AML
    ppos = np.where(rel >= 0, prel, -prel)             # -1..1 along the PML
    u = (ppos + 1.0) / 2.0 * 3.0                       # 0..3: three scallops
    scal = np.abs(np.sin(np.pi * u))
    h_pml = MV_CLEFT_H + (MV_PML_H - MV_CLEFT_H) * scal ** 0.7
    comm = mo.smoothstep(0.0, 0.12, np.abs(prel))
    h_pml = MV_COMM_H + (h_pml - MV_COMM_H) * comm
    L = np.where(aml, h_aml, h_pml)
    L = ndimage.gaussian_filter1d(L, 1.2, mode="wrap") * MM
    H = hinge_line(tm, ma, th)
    radial = np.vstack([ma.dir(t)[0] for t in th])
    tilt = np.radians(np.where(aml, TILT_DEG["MV_A"], TILT_DEG["MV_P"]))
    tilt = ndimage.gaussian_filter1d(tilt, 2.0, mode="wrap")
    D = rows(np.cos(tilt)[:, None] * (-ma.n)[None] - np.sin(tilt)[:, None] * radial)
    leaf, S = leaflet_solid(H, D, L, -radial)
    comm_th = [th_a + half_a, th_a - half_a]
    chords = []
    for key in ("LV_AL", "LV_PM"):
        p = pap[key]
        c = min(comm_th, key=lambda x: abs(((x - p["theta"] + np.pi) % (2 * np.pi)) - np.pi))
        for tip in p["tips"]:
            sub = _fan_chordae(tip, S, th, c, math.radians(52.0) / len(p["tips"]) * 1.4, step=3, per_fan=4)
            chords += sub
    out["SYN_MitralValve"] = mo.concat([leaf] + chords)
    out["_mitral_hinge"] = H
    report["mitral"] = {"aml_centre_deg": round(math.degrees(th_a), 1), "aml_height_mm": MV_AML_H, "pml_height_mm": MV_PML_H,
                        "chordae": len(chords), "triangles": int(len(out["SYN_MitralValve"][1]))}

    # ------------------------------------------------------------------ tricuspid valve
    ta = geo.rings["TA"]
    # septal sector: the part of the annulus that faces the mitral valve
    th_s = float(ta.theta_of(ma.c[None])[0])
    rel_t = ((th - th_s + np.pi) % (2 * np.pi)) - np.pi
    drop = TV_SEPTAL_DROP_MM * MM * np.cos(np.clip(rel_t / math.radians(TV_SEPTAL_HALF_WIDTH_DEG), -1, 1) * np.pi / 2) ** 2
    Ht = hinge_line(tm, ta, th, drop=drop)
    # leaflets: septal centred on the septal sector (120 deg), anterior (140 deg) and posterior (100 deg)
    spans = {"septal": (0.0, 120.0), "anterior": (130.0, 140.0), "posterior": (-110.0, 100.0)}
    Lt = np.full(len(th), TV_COMM_H)
    for name, (c_deg, w_deg) in spans.items():
        c = math.radians(c_deg)
        r_ = ((rel_t - c + np.pi) % (2 * np.pi)) - np.pi
        inside = np.abs(r_) <= math.radians(w_deg / 2)
        prof = TV_COMM_H + (TV_H[name] - TV_COMM_H) * np.cos(np.clip(r_ / math.radians(w_deg / 2), -1, 1) * np.pi / 2) ** 0.9
        Lt = np.where(inside, np.maximum(Lt, prof), Lt)
    Lt = ndimage.gaussian_filter1d(Lt, 1.2, mode="wrap") * MM
    rad_t = np.vstack([ta.dir(t)[0] for t in th])
    tilt_t = math.radians(TILT_DEG["TV"])
    Dt = rows(math.cos(tilt_t) * (-ta.n)[None] - math.sin(tilt_t) * rad_t)
    leaf_t, St = leaflet_solid(Ht, Dt, Lt, -rad_t)
    comm_t = [th_s + math.radians(c) for c in (-60.0, 60.0, 180.0 - 5.0)]
    chords_t = []
    for key in ("RV_A", "RV_P", "RV_S"):
        p = pap[key]
        c = min(comm_t, key=lambda x: abs(((x - p["theta"] + np.pi) % (2 * np.pi)) - np.pi))
        chords_t += _fan_chordae(p["tips"][0], St, th, c, math.radians(45.0), step=3, per_fan=4)
    out["SYN_TricuspidValve"] = mo.concat([leaf_t] + chords_t)
    # hinge offset (the checks' definition: facing eighth of each hinge line)
    ta_s = Ht[np.argsort(np.linalg.norm(Ht - ma.c, axis=1))[: max(5, len(Ht) // 8)]]
    ma_a = H[np.argsort(np.linalg.norm(H - ta.c, axis=1))[: max(5, len(H) // 8)]]
    off = float((ta_s.mean(axis=0) - ma_a.mean(axis=0)) @ geo.u_ba)
    report["tricuspid"] = {"septal_centre_deg": round(math.degrees(th_s), 1), "septal_drop_mm": TV_SEPTAL_DROP_MM,
                           "septal_hinge_apical_offset_mm": round(off / MM, 1), "chordae": len(chords_t),
                           "triangles": int(len(out["SYN_TricuspidValve"][1]))}
    report["papillary"] = {k: {"heads": len(p["tips"])} for k, p in pap.items()}
    log(f"valves: {report}")
    out["_report"] = report
    return out
