"""Stage 1b — correct and complete the BodyParts3D anatomy before the Blender build.

BodyParts3D is a segmentation of one (cadaveric) body. Some structures are collapsed, sunk into the heart wall,
placed where the reference anatomy says they cannot be, or simply absent. This stage writes *derived* meshes
(``anatomy/build/synth/*.ply``, in the BodyParts3D millimetre frame so the Blender build treats them exactly like
source parts), their design centrelines and a machine-readable report. Everything here is deterministic.

What is synthesised or corrected (docs/anatomy/SYNTHESIS.md lists every item and its reference):

* **Aortic root and valve** (``SYN_AorticRoot``, ``SYN_AorticValve``) — BodyParts3D has no root or valve and its
  aorta ends 22 mm from the mitral valve. A root with three sinuses of Valsalva (placed by the coronary ostia) is
  lofted from a 23 mm annulus to the sino-tubular junction and translated down the outflow tract until the
  annulus meets the anterior mitral hinge (aorto-mitral continuity); three semilunar cusps with nodules.
* **Ascending aorta** (``SYN_AortaAscending``) — rounded to an in-vivo calibre and blended onto the moved root.
* **Heart wall** (``SYN_HeartWall``) — the BodyParts3D wall, with the tissue around the moved root pushed out of
  it by a smooth field (the only change to the wall).
* **Coronary arteries** (``SYN_Coronary_*``, ``coronary.py``) — BodyParts3D courses where they agree with the
  reference; the left main, circumflex, RCA and septal perforators re-routed into the atrioventricular grooves /
  septum; D2, OM2, conus branch and sinoatrial-nodal artery grown; in-vivo calibres with tapered tips.
* **Cardiac veins** (``SYN_CardiacVeins``, ``veins.py``) — one labelled tree draining through a coronary sinus
  that runs in the posterior AV groove and opens flush into the right atrium beside the crux, plus anterior
  cardiac veins opening into the right atrium.

Usage::

    ./.venv/Scripts/python anatomy/scripts/synthesize.py
"""
from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "blender"))
import meshops as mo  # noqa: E402
from common import BUILD_DIR, RAW_DIR, load_config, write_json  # noqa: E402

SYNTH_DIR = BUILD_DIR / "synth"
REPORT = SYNTH_DIR / "synth_report.json"
VEIN_LINES = SYNTH_DIR / "vein_centerlines.json"
CORONARY_LINES = SYNTH_DIR / "coronary_centerlines.json"
MM = 0.01  # the synthesis works in scene units (Blender frame, 1 u = 10 cm) and writes millimetres
T0 = time.perf_counter()


def log(msg: str) -> None:
    print(f"[synth {time.perf_counter() - T0:6.1f}s] {msg}", flush=True)


# =============================================================================================
# Inputs
# =============================================================================================
class Parts:
    """Cleaned BodyParts3D parts in scene units (Blender frame: +X left, -Y anterior, +Z superior)."""

    def __init__(self, cfg: dict):
        self.cleanup = cfg["cleanup"]
        self.cache: dict[str, mo.Mesh] = {}
        heart = self.mm("FMA7274")
        self.origin_mm = mo.bbox_center(heart[0])

    def mm(self, pid: str) -> mo.Mesh:
        if pid not in self.cache:
            V, F = mo.read_stl(RAW_DIR / f"{pid}.stl")
            (V, F), _ = mo.filter_components(
                V, F, min_fraction=self.cleanup["min_component_fraction"], min_faces=self.cleanup["min_component_faces"],
                drop_inverted=self.cleanup["drop_inverted_components"],
            )
            self.cache[pid] = (V, F)
        return self.cache[pid]

    def scene(self, pid: str) -> mo.Mesh:
        V, F = self.mm(pid)
        return (V - self.origin_mm) * MM, F

    def to_mm(self, V: np.ndarray) -> np.ndarray:
        return np.asarray(V) / MM + self.origin_mm


class Surface:
    """Closest-point queries on a closed, outward-oriented mesh (signed distance > 0 outside)."""

    def __init__(self, V: np.ndarray, F: np.ndarray):
        self.tm = trimesh.Trimesh(V, F, process=False)
        self.fn = self.tm.face_normals

    def closest(self, P: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(closest point, outward unit normal there, signed distance) for each query point."""
        q, d, tri = trimesh.proximity.closest_point(self.tm, P)
        n = self.fn[tri]
        sign = np.sign(np.einsum("ij,ij->i", P - q, n))
        sign[sign == 0] = 1.0
        return q, n, d * sign


def heart_frame(parts: Parts) -> dict:
    """Long axis and mitral hinge plane (same definitions as the build and anatomy/checks)."""
    wall_V, _ = parts.scene("FMA7274")
    valve_V = np.concatenate([parts.scene(p)[0] for p in ("FMA7235", "FMA7234")])
    base, apex, axis = mo.heart_long_axis(wall_V, valve_V)
    u_ba = -axis  # base -> apex
    tree = cKDTree(wall_V)
    rings = {}
    for key, pid in (("MA", "FMA7235"), ("TA", "FMA7234")):
        V, _ = parts.scene(pid)
        touch = tree.query(V)[0] <= 1.0 * MM
        proj = (V - base) @ u_ba
        sel = touch & (proj <= np.quantile(proj, 0.25))
        P = V[sel]
        c = P.mean(axis=0)
        _, _, vt = np.linalg.svd(P - c, full_matrices=False)
        n = vt[2] if vt[2] @ (-u_ba) > 0 else -vt[2]  # towards the atria
        r = float(np.median(np.linalg.norm((P - c) - np.outer((P - c) @ n, n), axis=1)))
        rings[key] = {"c": c, "n": n, "r": r}
    return {"base": base, "apex": apex, "u_ba": u_ba, **rings}


# =============================================================================================
# Aorta: ascending calibre, root with sinuses of Valsalva, aortic valve
# =============================================================================================
#: Aortic root design (mm). Heights are along the root axis from the annulus; the annulus plane is parallel
#: to BodyParts3D's (tilted) proximal cap and ROOT_EXTENSION_MM below it, which puts the left-main / RCA ostia
#: at ~14 / ~18 mm above the annulus (MDCT 14.4 +/- 2.9 / 17.2 +/- 3.3 mm, REFERENCE.md §5.1).
ROOT_EXTENSION_MM = 11.0
#: The annulus is displaced towards the patient's right (fading out by the STJ) so it sits between the tricuspid
#: and mitral annuli (valve order TA.x < AoV.x < MA.x, REFERENCE.md §4.2) instead of over the mitral centre.
ROOT_RIGHTWARD_MM = 3.0
ROOT_HEIGHT_MM = 21.0          # annulus -> sino-tubular junction (STJ)
ROOT_R_ANNULUS_MM = 11.5       # annulus D 23 mm
ROOT_R_SINUS_MM = 14.6         # inter-sinus (commissural) radius at mid-sinus height: inscribed D ~29 mm
ROOT_R_STJ_MM = 13.0           # STJ D 26 mm
SINUS_BULGE_MM = 2.6           # extra radius at the centre of each sinus (sinus D ~34 mm)
ASC_MIN_RADIUS_MM = 12.8       # ascending aorta rounded to >= 25.6 mm (in-vivo 33 +/- 4, >= 25 accepted)
CUSP_THICKNESS_MM = 0.8


def poly_centroid(L: np.ndarray, c: np.ndarray, d: np.ndarray) -> tuple[np.ndarray, float]:
    e1 = mo.unit(np.cross(d, [1.0, 0.0, 0.0] if abs(d[0]) < 0.9 else [0.0, 1.0, 0.0]))
    e2 = np.cross(d, e1)
    x, y = (L - c) @ e1, (L - c) @ e2
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    cr = x * y2 - x2 * y
    A = cr.sum() / 2.0
    if abs(A) < 1e-12:
        return L.mean(axis=0), 0.0
    return c + ((x + x2) * cr).sum() / (6 * A) * e1 + ((y + y2) * cr).sum() / (6 * A) * e2, abs(A)


def march_centreline(tm: trimesh.Trimesh, start: np.ndarray, direction: np.ndarray, step: float = 2.0 * MM) -> np.ndarray:
    """Centreline of a fat tube by marching cross-section (area) centroids from ``start`` along ``direction``."""
    d = mo.unit(direction)
    p = start + d * 3.0 * MM
    C: list[np.ndarray] = []
    for _ in range(200):
        sec = tm.section(plane_origin=p, plane_normal=d)
        if sec is None:
            break
        cands = [poly_centroid(L, p, d) for L in sec.discrete]
        cc, _area = min(cands, key=lambda ca: np.linalg.norm(ca[0] - p))
        if C and np.linalg.norm(cc - C[-1]) > 3 * step:
            break
        C.append(cc)
        if len(C) >= 3:
            d = mo.unit(0.5 * d + 0.5 * mo.unit(C[-1] - C[-3]))
        p = cc + d * step
    return np.array(C)


def inflate_ascending(V: np.ndarray, F: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Round the (cadaveric, elliptical) ascending aorta to at least ASC_MIN_RADIUS_MM about its centreline,
    full effect over the proximal half, fading to the source shape where it joins the arch."""
    tree = cKDTree(C)
    _, k = tree.query(V)
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    rad = V - C[k]
    rad -= (rad * T[k]).sum(axis=1)[:, None] * T[k]
    rho = np.linalg.norm(rad, axis=1)
    s = arclen(C)
    L = s[-1]
    g = 1.0 - mo.smoothstep(0.7 * L, 1.0 * L, s[k])
    g = np.where(k == len(C) - 1, 0.0, g)  # the distal end joins the (unchanged) arch
    target = rho + g * np.maximum(0.0, ASC_MIN_RADIUS_MM * MM - rho)
    return V + rad / np.maximum(rho, 1e-9)[:, None] * (target - rho)[:, None]


#: The annulus must meet the anterior mitral hinge (aorto-mitral fibrous continuity, intervalvular fibrosa
#: <= 10 mm; REFERENCE.md §4.3). In BodyParts3D the aorta ends 22 mm from the mitral valve, at the top of the
#: left-ventricular outflow tract, so the whole root (annulus, sinuses, valve, coronary ostia) is translated
#: down the outflow tract towards the anterior mitral hinge (the smallest move that brings the annulus nearest to
#: the mitral valve inside ROOT_MOVE_BOX_MM), and the proximal ascending aorta follows with a smooth fade
#: (ASC_BLEND_MM). The box keeps the other valve relations: the aortic valve stays anterior to the mitral centre and
#: to the right of the mitral and pulmonary valves (REFERENCE.md §4.2), and near the 3rd costal cartilage (§4.1).
#: The remaining gap is bridged by the synthesised intervalvular fibrosa (SYN_AortoMitralCurtain).
ROOT_TO_MITRAL_MM = 3.5
ROOT_MOVE_BOX_MM = {"x": (-6.0, 3.5), "y": (-4.0, 10.0), "z": (-10.0, 3.0)}  # scene: +x left, +y posterior, +z up
ASC_BLEND_MM = (12.0, 45.0)  # ascending-aorta points up to 12 mm above the source cap move with the root, fading out by 45 mm
#: Coronary ostia: centre of the left / right sinus at these heights above the annulus, along the root axis (the
#: checks measure from the tilted annulus plane, which gives ~3 mm less; MDCT 14.4 +/- 2.9 and 17.2 +/- 3.3 mm,
#: REFERENCE.md §5.1). They sit in the upper sinus, just below the sino-tubular junction, which keeps the left
#: main level with the start of the left AV groove after the root moved down the outflow tract.
OSTIUM_HEIGHT_MM = {"LM": 18.5, "RCA": 19.5}


def build_aorta(parts: Parts, hf: dict, mitral_V: np.ndarray | None = None) -> tuple[mo.Mesh, mo.Mesh, mo.Mesh, dict]:
    V, F = parts.scene("FMA3736")
    tm = trimesh.Trimesh(V, F, process=False)
    c0 = V.mean(axis=0)
    _, _, vt = np.linalg.svd(V - c0, full_matrices=False)
    a0 = vt[0] * np.sign(vt[0][2])  # pointing superiorly
    fn, fa, fc = tm.face_normals, tm.area_faces, tm.triangles_center
    cap = fn @ (-a0) > 0.8
    cap_c = (fc[cap] * fa[cap, None]).sum(axis=0) / fa[cap].sum()
    n_cap = mo.unit((fn[cap] * fa[cap, None]).sum(axis=0))  # outward (inferior, tilted)
    C = march_centreline(tm, cap_c, a0)
    a_root = mo.unit(C[min(4, len(C) - 1)] - C[0])
    log(f"aorta: ascending centreline {arclen(C)[-1] / MM:.0f} mm; cap tilt {math.degrees(math.acos(abs(n_cap @ a_root))):.0f} deg")

    # --- source ostia (first points of the BodyParts3D LM / RCA parts nearest the aorta) ----------------
    src_ostia = {}
    for key, pid in (("LM", "FMA4685"), ("RCA", "FMA3802")):
        X, _ = parts.scene(pid)
        src_ostia[key] = X[np.argmin(cKDTree(V).query(X)[0])]

    # --- root frame -----------------------------------------------------------------------------
    c_src = cap_c - a_root * ROOT_EXTENSION_MM * MM
    right = np.array([-1.0, 0.0, 0.0])
    shift = mo.unit(right - (right @ a_root) * a_root) * ROOT_RIGHTWARD_MM * MM
    e1 = mo.unit(np.cross(a_root, [1.0, 0.0, 0.0]))
    e2 = np.cross(a_root, e1)

    def azimuth(p, c):
        d = p - c
        return math.atan2(d @ e2, d @ e1)

    th_R, th_L = azimuth(src_ostia["RCA"], c_src), azimuth(src_ostia["LM"], c_src)
    # non-coronary sinus: bisector of the larger arc between the two coronary sinuses
    diff = (th_L - th_R) % (2 * math.pi)
    th_N = th_R + diff / 2 + (math.pi if diff < math.pi else 0.0)
    centres = sorted([("R", th_R % (2 * math.pi)), ("L", th_L % (2 * math.pi)), ("N", th_N % (2 * math.pi))], key=lambda x: x[1])
    ang = np.array([c[1] for c in centres])
    comm = [(ang[i] + ((ang[(i + 1) % 3] - ang[i]) % (2 * math.pi)) / 2) % (2 * math.pi) for i in range(3)]  # after sinus i

    def lobe(theta):
        """0 at commissures, 1 at sinus centres."""
        out = np.zeros_like(theta)
        for i in range(3):
            lo = comm[(i - 1) % 3]
            hi = comm[i]
            width = (hi - lo) % (2 * math.pi)
            t = ((theta - lo) % (2 * math.pi)) / width
            inside = t <= 1.0
            out = np.where(inside, np.sin(np.pi * np.clip(t, 0, 1)) ** 2, out)
        return out

    H = ROOT_HEIGHT_MM * MM

    def base_radius(u):
        r = np.where(u < 0.4, ROOT_R_ANNULUS_MM + (ROOT_R_SINUS_MM - ROOT_R_ANNULUS_MM) * mo.smoothstep(0.0, 0.4, u),
                     ROOT_R_SINUS_MM + (ROOT_R_STJ_MM - ROOT_R_SINUS_MM) * mo.smoothstep(0.4, 1.0, u))
        return r * MM

    def bulge(u):
        return SINUS_BULGE_MM * MM * np.sin(np.pi * np.clip(u / 0.95, 0, 1)) ** 1.3

    def make_wall(c_ann):
        def wall(u, theta):
            """Root wall point (annulus plane parallel to the source cap, tilt fading out by the STJ)."""
            u = np.asarray(u, float)
            theta = np.asarray(theta, float)
            R = base_radius(u) + bulge(u) * lobe(theta)
            e = np.cos(theta)[..., None] * e1 + np.sin(theta)[..., None] * e2
            z0 = -(R[..., None] * e @ n_cap) / (a_root @ n_cap)
            h = z0 * (1.0 - u) + u * H
            return c_ann + R[..., None] * e + h[..., None] * a_root + (1.0 - u)[..., None] * shift
        return wall

    # --- aorto-mitral continuity: translate the root towards the anterior mitral hinge ----------------
    move = np.zeros(3)
    gap0 = gap = float("nan")
    if mitral_V is not None and len(mitral_V):
        mtree = cKDTree(mitral_V)
        th_s = np.linspace(0.0, 2 * math.pi, 180, endpoint=False)
        rim0 = make_wall(c_src)(np.zeros_like(th_s), th_s)
        gap0 = float(mtree.query(rim0)[0].min())
        bx = ROOT_MOVE_BOX_MM
        best = None
        for dx in np.arange(bx["x"][0], bx["x"][1] + 1e-6, 1.0):
            for dy in np.arange(bx["y"][0], bx["y"][1] + 1e-6, 1.0):
                for dz in np.arange(bx["z"][0], bx["z"][1] + 1e-6, 1.0):
                    m_ = np.array([dx, dy, dz]) * MM
                    g_ = float(mtree.query(rim0 + m_)[0].min())
                    key = (max(g_, ROOT_TO_MITRAL_MM * MM), float(np.linalg.norm(m_)))
                    if best is None or key < best[0]:
                        best = (key, m_)
        move = best[1]
        gap = float(mtree.query(rim0 + move)[0].min())
        log(f"aorta: root moved {np.linalg.norm(move) / MM:.1f} mm towards the anterior mitral hinge "
            f"(along the root axis {move @ a_root / MM:+.1f} mm); annulus-to-mitral gap {gap0 / MM:.1f} -> {gap / MM:.1f} mm")
    c_ann = c_src + move
    wall = make_wall(c_ann)

    # --- ascending aorta: calibre, then follow the root over ASC_BLEND_MM ---------------------------------
    V_asc = inflate_ascending(V, F, C)
    if np.linalg.norm(move) > 0:
        s_c = arclen(C)
        _, kk = cKDTree(C).query(V_asc)
        s_v = s_c[kk] + np.minimum(0.0, (V_asc - C[0]) @ a_root)  # points below the cap count as s <= 0
        w = 1.0 - mo.smoothstep(ASC_BLEND_MM[0] * MM, ASC_BLEND_MM[1] * MM, s_v)
        V_asc = V_asc + np.outer(w, move)

    # --- root surface (closed: flat annulus cap, open top closed by a cap inside the ascending aorta) -
    nu, nt = 36, 96
    us = np.linspace(0.0, 1.0, nu)
    ts = np.linspace(0.0, 2 * math.pi, nt, endpoint=False)
    UU, TT = np.meshgrid(us, ts, indexing="ij")
    W = wall(UU, TT).reshape(-1, 3)
    faces = []
    for i in range(nu - 1):
        for j in range(nt):
            a, b = i * nt + j, i * nt + (j + 1) % nt
            c_, d_ = (i + 1) * nt + j, (i + 1) * nt + (j + 1) % nt
            faces += [(a, c_, d_), (a, d_, b)]
    bottom, top = len(W), len(W) + 1
    W = np.vstack([W, W[:nt].mean(axis=0), W[-nt:].mean(axis=0)])
    for j in range(nt):
        faces.append((bottom, (j + 1) % nt, j))
        faces.append((top, (nu - 1) * nt + j, (nu - 1) * nt + (j + 1) % nt))
    RF = np.array(faces, dtype=np.int64)
    if mo.signed_volume(W, RF) < 0:
        RF = RF[:, ::-1]

    # --- aortic valve: three closed semilunar cusps ------------------------------------------------
    # Each cusp is a pocket hinged along a U-shaped line in its sinus (nadir at the annulus, rising to the
    # commissures near the STJ); the free edge runs from commissure to the centre of the root, where the three
    # cusps coapt, with a nodule of Arantius at its midpoint; the belly sags towards the ventricle (closed valve).
    cusp_meshes = []
    for i, (name, th) in enumerate(centres):
        lo, hi = comm[(i - 1) % 3], comm[i]
        width = (hi - lo) % (2 * math.pi)
        nt_c, nv_c = 34, 16
        tt = np.linspace(-1.0, 1.0, nt_c)
        vv = np.linspace(0.0, 1.0, nv_c)
        phi = lo + (tt + 1.0) / 2.0 * width
        u_h = 0.02 + 0.84 * np.abs(tt) ** 1.8
        hinge = wall(u_h, phi) - 0.6 * MM * (np.cos(phi)[:, None] * e1 + np.sin(phi)[:, None] * e2)
        comm_lo, comm_hi = hinge[0], hinge[-1]
        centre = c_ann + a_root * 0.60 * H + 0.4 * shift
        # free edge: a slightly sagging line from each commissure to the coaptation centre
        free = np.where((tt < 0)[:, None], centre + np.abs(tt)[:, None] * (comm_lo - centre), centre + np.abs(tt)[:, None] * (comm_hi - centre))
        free = free - (1.2 * MM * np.sin(np.pi * np.abs(tt)))[:, None] * a_root
        S = hinge[:, None, :] * (1 - vv)[None, :, None] + free[:, None, :] * vv[None, :, None]
        belly = 5.0 * MM * np.sin(np.pi * vv ** 0.85)[None, :] * (1 - tt ** 2)[:, None] ** 0.8
        S = S - belly[..., None] * a_root
        du = np.gradient(S, axis=0)
        dv = np.gradient(S, axis=1)
        nrm = np.cross(du, dv)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-12)
        # thickness: 1.4 mm at the hinge thinning to 0.9 mm (lunula), ~2.2 mm at the nodule of Arantius
        nod = np.exp(-((tt[:, None] / 0.16) ** 2) - ((vv[None, :] - 0.97) / 0.10) ** 2)
        thick = (1.4 - 0.5 * vv[None, :] + 1.3 * nod) * MM
        half = 0.5 * thick[..., None]
        A_, B_ = (S + half * nrm).reshape(-1, 3), (S - half * nrm).reshape(-1, 3)
        n = nt_c * nv_c
        Vc = np.vstack([A_, B_])
        fc_ = []

        def idx(a, b, _n=nv_c):
            return a * _n + b
        for a in range(nt_c - 1):
            for b in range(nv_c - 1):
                p00, p10, p01, p11 = idx(a, b), idx(a + 1, b), idx(a, b + 1), idx(a + 1, b + 1)
                fc_ += [(p00, p10, p11), (p00, p11, p01)]
                fc_ += [(n + p00, n + p11, n + p10), (n + p00, n + p01, n + p11)]
        border = [idx(a, 0) for a in range(nt_c)] + [idx(nt_c - 1, b) for b in range(1, nv_c)] + \
                 [idx(a, nv_c - 1) for a in range(nt_c - 2, -1, -1)] + [idx(0, b) for b in range(nv_c - 2, 0, -1)]
        for k in range(len(border)):
            p, q = border[k], border[(k + 1) % len(border)]
            fc_ += [(p, n + p, n + q), (p, n + q, q)]
        Fc = np.array(fc_, dtype=np.int64)
        if mo.signed_volume(Vc, Fc) < 0:
            Fc = Fc[:, ::-1]
        cusp_meshes.append((Vc, Fc))
    valve = mo.concat(cusp_meshes)

    # --- coronary ostia on the moved root: centre of the left / right sinus ----------------------------------
    ostia = {}
    for key, th in (("LM", th_L), ("RCA", th_R)):
        u = OSTIUM_HEIGHT_MM[key] / ROOT_HEIGHT_MM
        p = wall(u, th)
        e = math.cos(th) * e1 + math.sin(th) * e2
        ostia[key] = {"point": p, "normal": mo.unit(e - 0.15 * a_root), "theta": th}

    info = {
        "annulus_centre_scene": np.round(c_ann, 5).tolist(),
        "root_axis": np.round(a_root, 4).tolist(),
        "annulus_normal": np.round(-n_cap, 4).tolist(),
        "sinus_order": [c[0] for c in centres],
        "root_move_mm": np.round(move / MM, 2).tolist(),
        "annulus_to_mitral_mm": [round(gap0 / MM, 1), round(gap / MM, 1)],
        "ostium_height_mm": {k: round(float(((o["point"] - c_ann) @ n_cap) / (a_root @ n_cap) / MM), 1) for k, o in ostia.items()},
        "ascending_min_radius_mm": ASC_MIN_RADIUS_MM,
        "root_mm": {"annulus_D": 2 * ROOT_R_ANNULUS_MM, "intersinus_D": 2 * ROOT_R_SINUS_MM,
                    "sinus_D": 2 * (ROOT_R_SINUS_MM + SINUS_BULGE_MM), "stj_D": 2 * ROOT_R_STJ_MM, "height": ROOT_HEIGHT_MM},
    }
    info["_ostia"] = ostia
    info["_frame"] = {"c_ann": c_ann, "a_root": a_root, "e1": e1, "e2": e2, "wall": wall, "shift": shift}
    th_r = np.linspace(0.0, 2 * math.pi, 180, endpoint=False)
    info["_rim"] = wall(np.zeros_like(th_r), th_r)
    log(f"aorta: root sinuses {info['sinus_order']}, ostium heights {info['ostium_height_mm']} mm")
    return (V_asc, F), (W, RF), valve, info


# =============================================================================================
# Intervalvular fibrosa (aorto-mitral curtain)
# =============================================================================================
CURTAIN_THICKNESS_MM = 1.0
CURTAIN_CLEARANCE_MM = 1.2   # stops this short of the aortic annulus (the root is a separate node)


def aortomitral_curtain(rim: np.ndarray, mitral_V: np.ndarray, *, reach_mm: float) -> tuple[mo.Mesh, dict]:
    """The fibrous sheet between the aortic annulus (left / non-coronary sector) and the anterior mitral hinge.

    For every annulus sample within ``reach_mm`` of the mitral valve, the sheet runs from the nearest mitral vertex
    (the anterior leaflet at its hinge) to just short of the annulus; the samples are smoothed along the annulus, the
    sheet bows slightly into the outflow tract and is given a thickness (a closed solid, like the cusps)."""
    tree = cKDTree(mitral_V)
    d, j = tree.query(rim)
    sel = d <= d.min() + reach_mm * MM
    idx = np.flatnonzero(sel)
    if len(idx) < 4:
        return (np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)), {"width_mm": 0.0}
    # keep the contiguous run around the closest sample (the rim is cyclic)
    k0 = int(np.argmin(d))
    n = len(rim)
    run = [k0]
    for step in (1, -1):
        k = k0
        while True:
            k = (k + step) % n
            if not sel[k] or k in run:
                break
            if step == 1:
                run.append(k)
            else:
                run.insert(0, k)
    run = np.array(run)
    top = rim[run]
    bot = mitral_V[j[run]]
    for _ in range(6):  # smooth both edges along the annulus
        top[1:-1] = 0.5 * top[1:-1] + 0.25 * (top[:-2] + top[2:])
        bot[1:-1] = 0.5 * bot[1:-1] + 0.25 * (bot[:-2] + bot[2:])
    dirv = top - bot
    L = np.linalg.norm(dirv, axis=1, keepdims=True)
    top = bot + dirv * np.maximum(0.0, 1.0 - CURTAIN_CLEARANCE_MM * MM / np.maximum(L, 1e-9))
    nu, nv = len(run), 10
    tv = np.linspace(0.0, 1.0, nv)
    S = bot[:, None, :] * (1 - tv)[None, :, None] + top[:, None, :] * tv[None, :, None]
    # taper the width at both ends (the sheet ends at the fibrous trigones)
    du = np.gradient(S, axis=0)
    dv = np.gradient(S, axis=1)
    nrm = np.cross(du, dv)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-12)
    bow = 0.8 * MM * np.sin(np.pi * tv)[None, :] * np.sin(np.pi * np.linspace(0, 1, nu))[:, None]
    S = S + nrm * bow[..., None]
    half = 0.5 * CURTAIN_THICKNESS_MM * MM
    A_, B_ = (S + half * nrm).reshape(-1, 3), (S - half * nrm).reshape(-1, 3)
    m = nu * nv
    Vc = np.vstack([A_, B_])
    F = []

    def idx_(a, b):
        return a * nv + b
    for a in range(nu - 1):
        for b in range(nv - 1):
            p00, p10, p01, p11 = idx_(a, b), idx_(a + 1, b), idx_(a, b + 1), idx_(a + 1, b + 1)
            F += [(p00, p10, p11), (p00, p11, p01), (m + p00, m + p11, m + p10), (m + p00, m + p01, m + p11)]
    border = [idx_(a, 0) for a in range(nu)] + [idx_(nu - 1, b) for b in range(1, nv)] + \
             [idx_(a, nv - 1) for a in range(nu - 2, -1, -1)] + [idx_(0, b) for b in range(nv - 2, 0, -1)]
    for k in range(len(border)):
        p_, q_ = border[k], border[(k + 1) % len(border)]
        F += [(p_, m + p_, m + q_), (p_, m + q_, q_)]
    F = np.array(F, dtype=np.int64)
    if mo.signed_volume(Vc, F) < 0:
        F = F[:, ::-1]
    width = float(arclen(bot)[-1] / MM)
    return (Vc, F), {"width_mm": round(width, 1), "height_mm": [round(float(L.min() / MM), 1), round(float(L.max() / MM), 1)]}


# =============================================================================================
# Heart wall: the tissue around the moved aortic root yields to it
# =============================================================================================
#: Clearance between the moved aortic root / proximal ascending aorta and the heart wall, and the reach of the
#: smooth dent (the wall slab between the root and the atria moves as a whole instead of folding).
ROOT_CLEARANCE_MM = 1.0
ROOT_YIELD_REACH_MM = 16.0


def yield_wall_to(V: np.ndarray, F: np.ndarray, solids: list[mo.Mesh], centre: np.ndarray, *, margin: float,
                  reach: float) -> tuple[np.ndarray, dict]:
    """Push heart-wall vertices out of ``solids`` (closed meshes) with a smooth, spatially decaying field.

    Wall vertices inside a solid (or closer than ``margin`` to it) get a displacement to its surface +
    ``margin`` along the solid's outward normal; every wall vertex within ``reach`` of such a vertex takes the
    largest decayed displacement (quadratic falloff), so both faces of the wall slab move together. The field
    is then relaxed over the mesh edges until no face is folded over."""
    near = np.flatnonzero(np.linalg.norm(V - centre, axis=1) < 70 * MM)
    P = V[near]
    vec = np.zeros_like(P)
    mag = np.zeros(len(P))
    for Vs, Fs in solids:
        tm = trimesh.Trimesh(Vs, Fs, process=False)
        lo, hi = tm.bounds[0] - 3 * MM, tm.bounds[1] + 3 * MM
        box = np.flatnonzero(np.all((P >= lo) & (P <= hi), axis=1))
        for ch in np.array_split(box, max(1, len(box) // 1500)):
            if not len(ch):
                continue
            _, dist, tri = trimesh.proximity.closest_point(tm, P[ch])
            inside = tm.contains(P[ch])
            need = margin + np.where(inside, dist, -dist)
            nrm = tm.face_normals[tri]
            upd = (need > 0) & (need > mag[ch])
            vec[ch[upd]] = nrm[upd] * need[upd, None]
            mag[ch[upd]] = need[upd]
    src = np.flatnonzero(mag > 0)
    info = {"penetrating_vertices": int(len(src)), "max_depth_mm": round(float(mag.max()) / MM, 2) if len(src) else 0.0}
    if not len(src):
        return V, info
    kd = cKDTree(P[src])
    disp = np.zeros_like(P)
    for i, nb in enumerate(kd.query_ball_point(P, reach)):
        if not nb:
            continue
        nb = np.asarray(nb)
        fall = (1.0 - np.linalg.norm(P[src[nb]] - P[i], axis=1) / reach) ** 2
        # Shepard blend of the penetration vectors (weighted by depth), scaled by the strongest decayed one:
        # smooth in direction, full strength where the wall is penetrated
        w = fall * mag[src[nb]]
        dirv = (vec[src[nb]] * w[:, None]).sum(axis=0) / max(w.sum(), 1e-12)
        amp = float((mag[src[nb]] * fall).max())
        disp[i] = mo.unit(dirv) * amp
    D = np.zeros_like(V)
    D[near] = disp
    fn0 = mo.face_normals(V, F)
    e = mo.unique_edges(F)
    deg = np.maximum(np.bincount(e.ravel(), minlength=len(V)), 1).astype(float)
    moved = np.linalg.norm(D, axis=1) > 1e-6
    for it in range(40):
        folded = int(((mo.face_normals(V + D, F) * fn0).sum(axis=1) < 0).sum())
        if folded == 0:
            break
        acc = np.zeros_like(D)
        for k in range(3):
            acc[:, k] = np.bincount(e[:, 0], weights=D[e[:, 1], k], minlength=len(V)) + np.bincount(e[:, 1], weights=D[e[:, 0], k], minlength=len(V))
        D = np.where(moved[:, None], 0.5 * D + 0.5 * acc / deg[:, None], D)
    info.update({"moved_vertices": int((np.linalg.norm(D, axis=1) > 0.5 * MM).sum()),
                 "max_shift_mm": round(float(np.linalg.norm(D, axis=1).max()) / MM, 2),
                 "folded_faces": int(((mo.face_normals(V + D, F) * fn0).sum(axis=1) < 0).sum()), "relax_iterations": it})
    return V + D, info


# =============================================================================================
# Mitral isthmus: the left pulmonary veins enter the left atrium 20-40 mm from the mitral hinge
# =============================================================================================
#: In BodyParts3D the left pulmonary-vein ostia sit 10 mm (median 17 mm) from the mitral hinge ring, i.e. in the
#: left atrioventricular groove itself, so the circumflex and the great cardiac vein pass within 2-4 mm of them and
#: there is no mitral isthmus (in vivo the lateral mitral isthmus, from the mitral annulus to the left inferior
#: pulmonary vein ostium, is 20-40 mm; REFERENCE.md §4.4 and §6). The posterolateral left-atrial wall is stretched
#: away from the annulus by a smooth field: nothing moves within ISTHMUS_RAMP_MM[0] of the hinge ring or on the
#: ventricular side of it, wall farther than ISTHMUS_RAMP_MM[1] from the ring and within ISTHMUS_REACH_MM[0] of a
#: left pulmonary-vein ostium moves by ISTHMUS_LIFT_MM cranially and posteriorly, fading out by ISTHMUS_REACH_MM[1];
#: the pulmonary veins follow with the same field (their extrapericardial trunks bend, the intrapulmonary tree
#: stays: PV_REACH_MM). The only other change to the wall is the yield round the aortic root.
ISTHMUS_LIFT_MM = 20.0
ISTHMUS_DIR = (0.45, 0.2, 0.87)   # scene: +x patient left, +y posterior, +z superior
ISTHMUS_RAMP_MM = (3.0, 11.0)     # ring distance over which the wall stretches
ISTHMUS_REACH_MM = (14.0, 38.0)   # distance from the left PV ostia (full move / none)
PV_REACH_MM = (16.0, 60.0)


def hinge_ring(wall_V: np.ndarray, wall_F: np.ndarray, valve_V: np.ndarray, hf: dict):
    """Hinge ring of an AV valve exactly as ``vascular.HeartGeo`` / ``anatomy/checks`` fit it (valve vertices within
    1 mm of the wall, basal quartile along the long axis, algebraic circle fit)."""
    import vascular as vs

    d = trimesh.proximity.closest_point(trimesh.Trimesh(wall_V, wall_F, process=False), valve_V)[1]
    proj = (valve_V - hf["base"]) @ hf["u_ba"]
    sel = (d <= 1.0 * MM) & (proj <= np.quantile(proj, 0.25))
    if sel.sum() < 20:
        sel = proj <= np.quantile(proj, 0.25)
    return vs.fit_ring(valve_V[sel], -hf["u_ba"])


#: In BodyParts3D the superior vena cava is only 37 mm long and joins a right-atrial roof that sits at the level of
#: the 2nd costal cartilage, so the right superior heart border is higher than the left (in vivo the SVC is 60-80 mm
#: long and enters the right atrium at the right 3rd costal cartilage; REFERENCE.md §3.1, §4.1). The right-atrial roof
#: round the cavo-atrial junction is lowered by SVC_DROP_MM (fading out over RA_ROOF_REACH_MM) and the lower SVC
#: follows, so the vein is that much longer.
SVC_DROP_MM = 10.0
RA_ROOF_REACH_MM = (10.0, 38.0)
SVC_STRETCH_MM = 40.0


def lower_ra_roof(wall_V: np.ndarray, wall_F: np.ndarray, svc_V: np.ndarray, ta_ring) -> tuple[np.ndarray, np.ndarray, dict]:
    """Lower the right-atrial roof round the SVC junction and stretch the lower SVC with it (smooth fields)."""
    z0 = float(svc_V[:, 2].min())
    foot = svc_V[svc_V[:, 2] <= z0 + 3.0 * MM]
    c = foot.mean(axis=0)
    d = np.linalg.norm(wall_V - c, axis=1)
    w = 1.0 - mo.smoothstep(RA_ROOF_REACH_MM[0] * MM, RA_ROOF_REACH_MM[1] * MM, d)
    w = w * mo.smoothstep(2.0 * MM, 8.0 * MM, ta_ring.height(wall_V))  # atrial side of the tricuspid hinge only
    D = np.zeros_like(wall_V)
    D[:, 2] = -SVC_DROP_MM * MM * w
    fn0 = mo.face_normals(wall_V, wall_F)
    new_wall = wall_V + D
    ws = 1.0 - mo.smoothstep(0.0, SVC_STRETCH_MM * MM, svc_V[:, 2] - z0)
    new_svc = svc_V.copy()
    new_svc[:, 2] -= SVC_DROP_MM * MM * ws
    info = {"svc_bottom_mm": round(float((z0 - SVC_DROP_MM * MM) / MM), 1), "moved_wall_vertices": int((w > 0.05).sum()),
            "svc_length_gain_mm": SVC_DROP_MM,
            "folded_faces": int(((mo.face_normals(new_wall, wall_F) * fn0).sum(axis=1) < 0).sum())}
    return new_wall, new_svc, info


def left_pv_contact(pv_V: np.ndarray, wall_V: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Pulmonary-vein vertices touching the heart wall (<= 1.5 mm) on the patient's left of the heart base."""
    d = cKDTree(wall_V).query(pv_V)[0]
    C = pv_V[d <= 1.5 * MM]
    return C[C[:, 0] > base[0]]


def mitral_isthmus(wall_V: np.ndarray, wall_F: np.ndarray, pv_V: np.ndarray, ring, base: np.ndarray
                   ) -> tuple[np.ndarray, np.ndarray, dict]:
    """Stretch the posterolateral left atrium so the left pulmonary-vein ostia lie >= 20 mm from the mitral hinge."""
    import vascular as vs

    C = left_pv_contact(pv_V, wall_V, base)
    before = ring.dist(C)
    d = mo.unit(np.array(ISTHMUS_DIR, float))

    def field(P: np.ndarray, reach: tuple[float, float], wall: bool = True) -> np.ndarray:
        g = 1.0 - mo.smoothstep(reach[0] * MM, reach[1] * MM, cKDTree(C).query(P)[0])
        if not wall:  # the extrapericardial veins move with their ostia (the inferior trunk crosses the groove level)
            return g[:, None] * d[None] * ISTHMUS_LIFT_MM * MM
        s = mo.smoothstep(ISTHMUS_RAMP_MM[0] * MM, ISTHMUS_RAMP_MM[1] * MM, ring.dist(P))
        s = s * mo.smoothstep(-4.0 * MM, 2.0 * MM, ring.height(P))  # atrial side of the hinge only
        return (s * g)[:, None] * d[None] * ISTHMUS_LIFT_MM * MM

    D = field(wall_V, ISTHMUS_REACH_MM)
    fn0 = mo.face_normals(wall_V, wall_F)
    moved = np.linalg.norm(D, axis=1) > 1e-6
    e = mo.unique_edges(wall_F)
    deg = np.maximum(np.bincount(e.ravel(), minlength=len(wall_V)), 1).astype(float)
    it = 0
    for it in range(120):  # relax the field over the mesh edges until no face folds over
        folded = int(((mo.face_normals(wall_V + D, wall_F) * fn0).sum(axis=1) < 0).sum())
        if folded == 0:
            break
        acc = np.zeros_like(D)
        for k in range(3):
            acc[:, k] = np.bincount(e[:, 0], weights=D[e[:, 1], k], minlength=len(wall_V)) + np.bincount(e[:, 1], weights=D[e[:, 0], k], minlength=len(wall_V))
        D = np.where(moved[:, None], 0.5 * D + 0.5 * acc / deg[:, None], D)
    new_wall = wall_V + D
    new_pv = pv_V + field(pv_V, PV_REACH_MM, wall=False)
    C2 = left_pv_contact(new_pv, new_wall, base)
    after = ring.dist(C2)
    info = {"left_pv_ring_dist_mm_min_median": [[round(float(before.min() / MM), 1), round(float(np.median(before) / MM), 1)],
                                                [round(float(after.min() / MM), 1), round(float(np.median(after) / MM), 1)]],
            "moved_wall_vertices": int((np.linalg.norm(D, axis=1) > 0.5 * MM).sum()),
            "max_shift_mm": round(float(np.linalg.norm(D, axis=1).max() / MM), 1),
            "folded_faces": int(((mo.face_normals(new_wall, wall_F) * fn0).sum(axis=1) < 0).sum()), "relax_iterations": it}
    _ = vs
    return new_wall, new_pv, info


# =============================================================================================
def arclen(P: np.ndarray) -> np.ndarray:
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]


def main() -> int:
    import coronary
    import vascular
    import veins

    cfg = load_config()
    SYNTH_DIR.mkdir(parents=True, exist_ok=True)
    parts = Parts(cfg)
    log(f"origin (heart-wall bbox centre) {np.round(parts.origin_mm, 4).tolist()} mm")
    hf = heart_frame(parts)
    report: dict = {"origin_mm": np.round(parts.origin_mm, 4).tolist()}

    # --- aortic root at the anterior mitral hinge, ascending aorta blended onto it ---------------------------
    mitral_V, _ = parts.scene("FMA7235")
    asc, root, valve, aorta_info = build_aorta(parts, hf, mitral_V)
    for name, (V, F) in (("SYN_AortaAscending", asc), ("SYN_AorticRoot", root), ("SYN_AorticValve", valve)):
        mo.write_ply(SYNTH_DIR / f"{name}.ply", parts.to_mm(V), F)
    curtain, cinfo = aortomitral_curtain(aorta_info["_rim"], mitral_V, reach_mm=5.0)
    mo.write_ply(SYNTH_DIR / "SYN_AortoMitralCurtain.ply", parts.to_mm(curtain[0]), curtain[1])
    log(f"aorto-mitral curtain (intervalvular fibrosa): {cinfo}")
    report["aortomitral_curtain"] = cinfo

    # --- heart wall yields to the moved root --------------------------------------------------------------
    wall_V, wall_F = parts.scene("FMA7274")
    wall_V, yinfo = yield_wall_to(wall_V, wall_F, [root, asc], np.array(aorta_info["annulus_centre_scene"]),
                                  margin=ROOT_CLEARANCE_MM * MM, reach=ROOT_YIELD_REACH_MM * MM)
    log(f"heart wall: yields to the root {yinfo}")
    report["heart_wall_yield"] = yinfo
    # --- mitral isthmus: the left pulmonary veins move away from the mitral hinge -----------------------------
    pv_V, pv_F = parts.scene("FMA66643")
    ring_ma = hinge_ring(wall_V, wall_F, parts.scene("FMA7235")[0], hf)
    wall_V, pv_V, iinfo = mitral_isthmus(wall_V, wall_F, pv_V, ring_ma, hf["base"])
    log(f"mitral isthmus: {iinfo}")
    report["mitral_isthmus"] = iinfo
    # --- right-atrial roof and SVC: the cavo-atrial junction at the right 3rd costal cartilage -------------------
    svc_V, svc_F = parts.scene("FMA4720")
    ring_ta = hinge_ring(wall_V, wall_F, parts.scene("FMA7234")[0], hf)
    wall_V, svc_V, rinfo = lower_ra_roof(wall_V, wall_F, svc_V, ring_ta)
    log(f"right-atrial roof and SVC: {rinfo}")
    report["ra_roof_svc"] = rinfo
    mo.write_ply(SYNTH_DIR / "SYN_HeartWall.ply", parts.to_mm(wall_V), wall_F)
    mo.write_ply(SYNTH_DIR / "SYN_PulmonaryVeins.ply", parts.to_mm(pv_V), pv_F)
    mo.write_ply(SYNTH_DIR / "SYN_SVC.ply", parts.to_mm(svc_V), svc_F)

    # --- coronary arteries and cardiac veins on the corrected heart ----------------------------------------
    # vessels are seated on the wall as the build will show it: the build Taubin-smooths the wall (10 + 5 passes)
    # before decimating, which fills grooves slightly, so the seating surface gets the same smoothing
    seat_V = mo.taubin_smooth(wall_V, wall_F, iterations=15)
    geo = vascular.HeartGeo((seat_V, wall_F), parts.scene("FMA7235"), parts.scene("FMA7234"),
                            cache=SYNTH_DIR / "_cache" / "wall_sdf.pkl")
    log(f"heart geometry: MA ring D {2 * geo.rings['MA'].R / MM:.1f} mm, TA ring D {2 * geo.rings['TA'].R / MM:.1f} mm")
    # --- atrioventricular valve apparatus: leaflets, chordae, papillary muscles (valves.py) --------------------
    import valves
    vap = valves.design(parts, geo, log, aortic_centre=np.array(aorta_info["annulus_centre_scene"]))
    for name in ("SYN_MitralValve", "SYN_TricuspidValve", "SYN_PapillaryMuscles"):
        mo.write_ply(SYNTH_DIR / f"{name}.ply", parts.to_mm(vap[name][0]), vap[name][1])
    report["valves"] = vap["_report"]
    # the aorto-mitral curtain now joins the designed anterior mitral hinge
    curtain, cinfo = aortomitral_curtain(aorta_info["_rim"], vap["_mitral_hinge"], reach_mm=5.0)
    mo.write_ply(SYNTH_DIR / "SYN_AortoMitralCurtain.ply", parts.to_mm(curtain[0]), curtain[1])
    report["aortomitral_curtain"] = cinfo
    log(f"aorto-mitral curtain on the designed mitral hinge: {cinfo}")

    cor = coronary.design(parts, geo, aorta_info["_ostia"], log, svc_V=svc_V,
                          pv_valve_V=parts.scene("FMA7246")[0])
    cmesh = coronary.meshes(cor["trees"])
    for node, (V, F) in cmesh.items():
        mo.write_ply(SYNTH_DIR / f"SYN_{node}.ply", parts.to_mm(V), F)
    write_json(CORONARY_LINES, {"frame": "BodyParts3D millimetres",
                                "nodes": coronary.centrelines_json(cor["trees"], parts.to_mm)}, indent=None)
    lmk = cor["landmarks"]
    report["coronary"] = {
        "triangles": {n: int(len(F)) for n, (V, F) in cmesh.items()},
        "segments": {n: [(sg["code"], round(float(arclen(sg["P"])[-1] / MM), 1)) for sg in t.segs] for n, t in cor["trees"].items()},
        "lm_bifurcation_to_mitral_ring_mm": round(float(geo.rings["MA"].dist(lmk["bifurcation"][None])[0] / MM), 1),
        "rca_crux_s_mm": round(float(lmk["s_crux"] / MM), 1),
    }
    vtree = veins.design(parts, geo, cor, log, ivc_V=parts.scene("FMA10951")[0])
    vV, vF = veins.mesh(vtree)
    mo.write_ply(SYNTH_DIR / "SYN_CardiacVeins.ply", parts.to_mm(vV), vF)
    write_json(VEIN_LINES, {"frame": "BodyParts3D millimetres", "codes": veins.CODES, "names": veins.NAMES,
                            "paths": veins.lines_json(vtree, parts.to_mm)}, indent=None)
    report["veins"] = {
        "triangles": int(len(vF)),
        "cs_ostium_scene": np.round(vtree.ostium, 5).tolist(),
        "cs_ostium_to_crux_mm": round(float(np.linalg.norm(vtree.ostium - vtree.crux) / MM), 1),
        "paths": [{"label": sg["label"], "parent": sg["parent"], "length_mm": round(float(arclen(sg["P"])[-1] / MM), 1),
                   "diameter_mm": [round(float(2 * sg["R"][0] / MM), 2), round(float(2 * sg["R"][-1] / MM), 2)]}
                  for sg in vtree.segs],
    }
    # --- channels for the vessels that pass under the fused tip of the left auricle (carved by the build) ---------
    paths = [(sg["P"], sg["R"]) for t in cor["trees"].values() for sg in t.segs if not sg["code"].startswith(("S", "IS"))]
    paths += [(sg["P"], sg["R"]) for sg in vtree.segs]
    cut, cinfo = vascular.tunnel_cutter(geo, paths)
    mo.write_ply(SYNTH_DIR / "SYN_TunnelCutter.ply", parts.to_mm(cut[0]), cut[1])
    log(f"tunnels under fused structures: {len(cinfo['stretches'])} stretches {cinfo['stretches']}")
    report["tunnels"] = cinfo
    report["aorta"] = {k: v for k, v in aorta_info.items() if not k.startswith("_")}
    write_json(REPORT, report)
    log("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
