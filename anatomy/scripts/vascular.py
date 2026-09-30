"""Geometry toolkit for the synthesis stage: the heart-wall solid, AV-groove courses, path and tube helpers.

Everything works in the synthesis *scene* frame (Blender world: +X patient left, +Y posterior, +Z superior;
1 unit = 10 cm, origin = heart-wall bounding-box centre) on the cleaned BodyParts3D heart wall (FMA7274).

* :class:`HeartGeo` — voxel solid of the myocardium with a signed-distance field (negative inside the
  muscle), its gradient (outward normal), the epicardial vertices, the long axis and the mitral / tricuspid
  hinge rings fitted exactly like ``anatomy/checks/measure_model.py`` (valve vertices within 1 mm of the wall,
  basal quartile, algebraic circle fit).
* :meth:`HeartGeo.groove` — the course of an atrioventricular groove next to a hinge ring: for every azimuth
  the first exit from the myocardium when marching outward from the hinge in the ring plane (shifted
  ``h_mm`` towards the atrium), robustly smoothed and seated on the epicardium.
* :meth:`HeartGeo.seat` — move a vessel centreline so its wall lies ``lift`` outside the epicardium.
* :meth:`HeartGeo.grow` — grow a branch over the epicardium (or through the septum) from a start point and
  direction, bending towards a goal.
* :func:`sweep` — closed tube along a centreline with per-point radii; flat start cap (hidden in the parent
  lumen or in the atrial wall) and a short conical tip instead of a hemispherical cap.
"""
from __future__ import annotations

import math
import pickle
from pathlib import Path

import numpy as np
import trimesh
from scipy import interpolate, ndimage
from scipy.spatial import cKDTree

import meshops as mo

MM = 0.01
PITCH = 0.5 * MM  # voxel pitch of the myocardial solid


# =============================================================================================
# Path helpers
# =============================================================================================
def arclen(P: np.ndarray) -> np.ndarray:
    P = np.asarray(P, float)
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]


def resample(P: np.ndarray, spacing: float, R: np.ndarray | None = None):
    """Uniform arc-length resampling (keeps both ends); optionally resamples radii ``R`` alongside."""
    P = np.asarray(P, float)
    keep = np.r_[True, np.linalg.norm(np.diff(P, axis=0), axis=1) > 1e-9]
    P = P[keep]
    s = arclen(P)
    n = max(2, int(round(s[-1] / spacing)) + 1)
    t = np.linspace(0.0, s[-1], n)
    out = np.column_stack([np.interp(t, s, P[:, k]) for k in range(3)])
    if R is None:
        return out
    R = np.asarray(R, float)[keep]
    return out, np.interp(t, s, R)


def smooth(P: np.ndarray, iterations: int = 10, *, pin_start: bool = True, pin_end: bool = True, w: float = 0.5) -> np.ndarray:
    P = np.asarray(P, float).copy()
    for _ in range(iterations):
        Q = P.copy()
        Q[1:-1] = (1 - w) * P[1:-1] + 0.5 * w * (P[:-2] + P[2:])
        if not pin_start:
            Q[0] = P[0] + w * (P[1] - P[0]) * 0.5
        if not pin_end:
            Q[-1] = P[-1] + w * (P[-2] - P[-1]) * 0.5
        P = Q
    return P


def tangent(P: np.ndarray, k: int, span: int = 3) -> np.ndarray:
    a, b = max(0, k - span), min(len(P) - 1, k + span)
    return mo.unit(P[b] - P[a])


def hermite(p0, t0, p1, t1, spacing: float, tension: float = 1.0) -> np.ndarray:
    """Cubic Hermite curve from ``p0`` (unit tangent ``t0``) to ``p1`` (unit tangent ``t1``)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    L = float(np.linalg.norm(p1 - p0))
    m0, m1 = mo.unit(np.asarray(t0, float)) * L * tension, mo.unit(np.asarray(t1, float)) * L * tension
    n = max(4, int(L / spacing * 1.5) + 2)
    t = np.linspace(0.0, 1.0, n)[:, None]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    return resample(h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1, spacing)


def spline(points: np.ndarray, spacing: float, smoothing: float = 0.0) -> np.ndarray:
    """Cubic spline through control points, resampled at ``spacing``."""
    pts = np.asarray(points, float)
    pts = pts[np.r_[True, np.linalg.norm(np.diff(pts, axis=0), axis=1) > 1e-9]]
    if len(pts) < 4:
        return resample(pts, spacing)
    u = arclen(pts)
    u /= u[-1]
    tck, _ = interpolate.splprep(pts.T, u=u, k=3, s=smoothing)
    dense = np.array(interpolate.splev(np.linspace(0, 1, max(8, int(arclen(pts)[-1] / spacing) * 4)), tck)).T
    return resample(dense, spacing)


def at_s(P: np.ndarray, s: float) -> tuple[np.ndarray, int]:
    sa = arclen(P)
    k = int(np.clip(np.searchsorted(sa, s), 0, len(P) - 1))
    return P[k], k


def radius_law(s: np.ndarray, L: float, d0_mm: float, d1_mm: float, *, tip_frac: float = 0.4, tip_ratio: float = 0.45,
               power: float = 1.0) -> np.ndarray:
    """Lumen radius (scene units) along a branch of length ``L``: a smooth power-law taper from diameter
    ``d0_mm`` to ``d1_mm`` and, over the last ``tip_frac`` of the length, a further taper to ``tip_ratio`` of
    that value (the vessel thins out instead of ending in a blunt cap)."""
    x = np.clip(np.asarray(s, float) / max(L, 1e-9), 0.0, 1.0)
    d = d0_mm * (d1_mm / d0_mm) ** (x**power)
    tip = 1.0 - (1.0 - tip_ratio) * mo.smoothstep(1.0 - tip_frac, 1.0, x) ** 1.2 if tip_frac > 0 else 1.0
    return 0.5 * d * tip * MM


# =============================================================================================
# Tubes
# =============================================================================================
def frames(P: np.ndarray):
    """Rotation-minimising frames (double reflection, Wang et al. 2008) along a polyline."""
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    n = len(P)
    N = np.zeros_like(P)
    a = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N[0] = mo.unit(np.cross(T[0], a))
    for i in range(n - 1):
        v1 = P[i + 1] - P[i]
        c1 = v1 @ v1
        if c1 < 1e-20:
            N[i + 1] = N[i]
            continue
        rL = N[i] - (2 / c1) * (v1 @ N[i]) * v1
        tL = T[i] - (2 / c1) * (v1 @ T[i]) * v1
        v2 = T[i + 1] - tL
        c2 = v2 @ v2
        N[i + 1] = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-20 else rL
        N[i + 1] = mo.unit(N[i + 1] - (N[i + 1] @ T[i + 1]) * T[i + 1])
    B = np.cross(T, N)
    return T, N, B


def sides_for(r_max: float) -> int:
    r = r_max / MM
    return 18 if r >= 3.0 else 14 if r >= 1.6 else 10 if r >= 0.9 else 8 if r >= 0.5 else 6


def ring_spacing(r: float) -> float:
    """Distance between tube rings for radius ``r`` (thin vessels bend more tightly but need fewer rings)."""
    return float(np.clip(1.1 * r, 0.75 * MM, 1.8 * MM))


def sweep(P: np.ndarray, R: np.ndarray, *, start: str = "flat", end: str = "cone", sides: int | None = None,
          adaptive: bool = True, spacing: float = 1.0) -> mo.Mesh:
    """Closed, outward-oriented tube along ``P`` with radii ``R``.

    ``start`` / ``end``: 'flat' (a disc: used where the end is buried in a parent lumen or a chamber wall),
    'round' (hemisphere) or 'cone' (a short tapered tip, length ~1.6 r, so thin branches fade out to a point).
    ``spacing`` scales the adaptive ring spacing (> 1: fewer rings, for long, gently curved groove vessels).
    """
    P = np.asarray(P, float)
    R = np.asarray(R, float)
    if adaptive and len(P) > 3:
        s = arclen(P)
        pts = [0.0]
        while pts[-1] < s[-1]:
            pts.append(pts[-1] + spacing * ring_spacing(float(np.interp(pts[-1], s, R))))
        pts[-1] = s[-1]
        if len(pts) >= 2 and pts[-1] - pts[-2] < 0.3 * MM and len(pts) > 2:
            pts.pop(-2)
        t = np.array(pts)
        P = np.column_stack([np.interp(t, s, P[:, k]) for k in range(3)])
        R = np.interp(t, s, R)
    sides = sides or sides_for(float(R.max()))
    T, N, B = frames(P)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ca, sa = np.cos(ang), np.sin(ang)
    rings: list[tuple[np.ndarray, float, int]] = []  # (centre, radius, frame index)

    if start == "round":
        for f in (0.35, 0.7, 0.92):
            rings.append((P[0] - T[0] * R[0] * math.sqrt(1 - f * f), R[0] * f, 0))
    for i in range(len(P)):
        rings.append((P[i], R[i], i))
    if end == "round":
        for f in (0.92, 0.7, 0.35):
            rings.append((P[-1] + T[-1] * R[-1] * math.sqrt(1 - f * f), R[-1] * f, len(P) - 1))
    elif end == "cone":
        for f, dz in ((0.72, 0.55), (0.4, 1.1)):
            rings.append((P[-1] + T[-1] * R[-1] * dz, R[-1] * f, len(P) - 1))
    V = np.array([c + r * (ca[k] * N[j] + sa[k] * B[j]) for c, r, j in rings for k in range(sides)])
    F = []
    for a in range(len(rings) - 1):
        o0, o1 = a * sides, (a + 1) * sides
        for k in range(sides):
            k2 = (k + 1) % sides
            F.append((o0 + k, o1 + k, o1 + k2))
            F.append((o0 + k, o1 + k2, o0 + k2))
    c0 = len(V)
    first = P[0] - T[0] * R[0] * (1.0 if start == "round" else 0.0)
    last = P[-1] + T[-1] * R[-1] * (1.0 if end == "round" else 1.6 if end == "cone" else 0.0)
    V = np.vstack([V, first, last])
    b = (len(rings) - 1) * sides
    for k in range(sides):
        k2 = (k + 1) % sides
        F.append((c0, k2, k))
        F.append((c0 + 1, b + k, b + k2))
    F = np.array(F, dtype=np.int64)
    if mo.signed_volume(V, F) < 0:
        F = F[:, ::-1]
    return V, F


# =============================================================================================
# Rings (identical to anatomy/checks/measure_model.py fit_ring)
# =============================================================================================
class Ring:
    def __init__(self, c, n, R, pts):
        self.c, self.n, self.R, self.pts = np.asarray(c, float), mo.unit(np.asarray(n, float)), float(R), pts
        e1 = mo.unit(np.cross(self.n, [0.0, 1.0, 0.0]) if abs(self.n[1]) < 0.9 else np.cross(self.n, [1.0, 0.0, 0.0]))
        # azimuth 0 = the anterior direction (-Y) projected into the ring plane
        ant = np.array([0.0, -1.0, 0.0])
        e1 = mo.unit(ant - (ant @ self.n) * self.n)
        self.e1, self.e2 = e1, np.cross(self.n, e1)

    def dir(self, theta) -> np.ndarray:
        theta = np.atleast_1d(theta)
        return np.outer(np.cos(theta), self.e1) + np.outer(np.sin(theta), self.e2)

    def point(self, theta, radial: float = 0.0, h: float = 0.0) -> np.ndarray:
        return self.c + self.dir(theta) * (self.R + radial) + self.n * h

    def theta_of(self, P) -> np.ndarray:
        d = np.atleast_2d(P) - self.c
        return np.arctan2(d @ self.e2, d @ self.e1) % (2 * np.pi)

    def dist(self, P) -> np.ndarray:
        d = np.atleast_2d(P) - self.c
        h = d @ self.n
        rho = np.linalg.norm(d - np.outer(h, self.n), axis=1)
        return np.sqrt((rho - self.R) ** 2 + h**2)

    def height(self, P) -> np.ndarray:
        return (np.atleast_2d(P) - self.c) @ self.n


def fit_ring(P: np.ndarray, normal_hint: np.ndarray) -> Ring:
    c0 = P.mean(axis=0)
    _, _, vt = np.linalg.svd(P - c0, full_matrices=False)
    n = vt[2] if vt[2] @ normal_hint >= 0 else -vt[2]
    a = mo.unit(np.cross(n, [1.0, 0.0, 0.0] if abs(n[0]) < 0.9 else [0.0, 1.0, 0.0]))
    b = np.cross(n, a)
    x, y = (P - c0) @ a, (P - c0) @ b
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    sol, *_ = np.linalg.lstsq(A, x**2 + y**2, rcond=None)
    R = math.sqrt(max(sol[2] + sol[0] ** 2 + sol[1] ** 2, 1e-12))
    return Ring(c0 + sol[0] * a + sol[1] * b, n, R, P)


# =============================================================================================
# Heart-wall geometry
# =============================================================================================
class HeartGeo:
    """Voxel solid, signed-distance field and landmarks of the BodyParts3D heart wall (scene frame)."""

    def __init__(self, wall: mo.Mesh, mitral: mo.Mesh, tricuspid: mo.Mesh, cache: Path | None = None):
        self.V, self.F = np.asarray(wall[0], float), np.asarray(wall[1])
        self.tm = trimesh.Trimesh(self.V, self.F, process=False)
        key = (len(self.V), round(float(self.V.sum()), 6))
        data = None
        if cache is not None and cache.exists():
            try:
                data = pickle.loads(cache.read_bytes())
                if data.get("key") != key:
                    data = None
            except Exception:  # noqa: BLE001 - a stale cache is rebuilt
                data = None
        if data is None:
            vg = self.tm.voxelized(PITCH).fill()
            occ = np.pad(vg.matrix, 6)
            origin = vg.transform[:3, 3] - 6 * PITCH
            din = ndimage.distance_transform_edt(occ) * PITCH
            dout = ndimage.distance_transform_edt(~occ) * PITCH
            sdf = np.where(occ, -(din - 0.5 * PITCH), dout - 0.5 * PITCH).astype(np.float32)
            data = {"key": key, "occ": occ, "origin": origin, "sdf": sdf}
            if cache is not None:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(pickle.dumps(data, protocol=4))
        self.occ, self.origin, self.sdf = data["occ"], data["origin"], data["sdf"]
        # The voxel field's zero level lies outside the surface it was built from: every voxel the surface touches is
        # solid and the distance is measured from the voxel boundary (0.34 mm on this wall; the build's wall matches
        # the seating mesh to 0.01 mm). Uncorrected, every vessel sat that much off the heart. Calibrate the offset
        # on the mesh itself so that sd = 0 on the surface (the gradient, hence every normal, is unchanged).
        raw = ndimage.map_coordinates(self.sdf, self._ijk(self.V).T, order=1, mode="nearest")
        self.sdf_bias = float(np.clip(-np.median(raw), 0.0, PITCH))
        self.sdf = (self.sdf + self.sdf_bias).astype(np.float32)
        self.grad = [g.astype(np.float32) for g in np.gradient(self.sdf.astype(np.float64), PITCH)]
        # epicardial vertices: the outward normal ray never re-enters the solid
        N = self.tm.vertex_normals
        occd = ndimage.binary_dilation(self.occ, iterations=1)
        epi = np.ones(len(self.V), dtype=bool)
        for s in np.arange(2.0, 160.0, 1.0) * MM:
            epi &= ~self._lookup(occd, self.V + N * s)
        self.epi = epi
        self.E, self.EN = self.V[epi], N[epi]
        self.etree = cKDTree(self.E)
        # long axis (build_anatomy / mo.heart_long_axis) and hinge rings (measure_model definition)
        self.mv, self.tv = np.asarray(mitral[0], float), np.asarray(tricuspid[0], float)
        self.base, self.apex, axis = mo.heart_long_axis(self.V, np.vstack([self.mv, self.tv]))
        self.u_ba = -axis
        self.rings = {}
        for key_, X in (("MA", self.mv), ("TA", self.tv)):
            d, _ = trimesh.proximity.closest_point(self.tm, X)[1], None
            touch = d <= 1.0 * MM
            proj = (X - self.base) @ self.u_ba
            sel = touch & (proj <= np.quantile(proj, 0.25))
            if sel.sum() < 20:
                sel = proj <= np.quantile(proj, 0.25)
            self.rings[key_] = fit_ring(X[sel], -self.u_ba)

    # --- field lookups ----------------------------------------------------------------------------
    def _ijk(self, P):
        return (np.atleast_2d(P) - self.origin) / PITCH

    def _lookup(self, grid, P):
        ijk = np.round(self._ijk(P)).astype(int)
        ok = np.all((ijk >= 0) & (ijk < np.array(grid.shape)), axis=1)
        out = np.zeros(len(ijk), dtype=grid.dtype)
        out[ok] = grid[ijk[ok, 0], ijk[ok, 1], ijk[ok, 2]]
        return out

    def sd(self, P) -> np.ndarray:
        """Signed distance to the heart-wall surface (scene units; < 0 inside the myocardium)."""
        ijk = self._ijk(P).T
        return ndimage.map_coordinates(self.sdf, ijk, order=1, mode="nearest").astype(float)

    def normal(self, P) -> np.ndarray:
        ijk = self._ijk(P).T
        g = np.column_stack([ndimage.map_coordinates(gg, ijk, order=1, mode="nearest") for gg in self.grad])
        return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)

    def inside(self, P) -> np.ndarray:
        return self.sd(P) < 0

    # --- vessels on the epicardium ----------------------------------------------------------------
    def seat(self, P: np.ndarray, R: np.ndarray, lift: float | np.ndarray, *, snap: bool = True, pin_start: int = 0,
             iterations: int = 6, sigma: float = 2.0) -> np.ndarray:
        """Move centreline points along the SDF gradient so each lies ``R + lift`` outside the myocardium.

        ``snap`` also pulls points that float higher down onto that height (vessels lie on the heart, not
        above it). The first ``pin_start`` points (an ostium, a branch origin) stay where they are and the
        correction fades in over the next few points; the displacement is smoothed along the path."""
        P = np.asarray(P, float).copy()
        R = np.broadcast_to(np.asarray(R, float), (len(P),))
        lift = np.broadcast_to(np.asarray(lift, float), (len(P),))
        w = np.ones(len(P))
        if pin_start:
            w[:pin_start] = 0.0
            ramp = min(len(P) - pin_start, 6)
            w[pin_start:pin_start + ramp] = np.linspace(0.2, 1.0, ramp)
        for _ in range(iterations):
            s = self.sd(P)
            n = self.normal(P)
            want = R + lift
            delta = want - s
            if not snap:
                delta = np.maximum(delta, 0.0)
            delta = np.clip(delta, -4 * MM, 4 * MM)
            disp = n * (delta * w)[:, None]
            disp = ndimage.gaussian_filter1d(disp, sigma, axis=0, mode="nearest") if len(P) > 4 else disp
            P = P + disp
        return P

    def groove(self, key: str, thetas: np.ndarray, *, h_mm: float | np.ndarray, R: np.ndarray | float, lift: float,
               max_mm: float = 16.0, min_mm: float = 3.0, smooth_deg: float = 12.0, radial_seat: bool = False) -> np.ndarray:
        """Course of the AV groove beside ring ``key`` over the azimuths ``thetas`` (radians, in order).

        For every azimuth: march outward from the hinge in the ring plane shifted ``h_mm`` towards the atrium and
        take the first exit from the myocardium (the epicardial crease at the atrioventricular junction). The
        radial exit distance is median-filtered, smoothed, clamped to [min_mm, max_mm] beyond the hinge and the
        points are seated ``R + lift`` outside the wall: along the SDF gradient, or (``radial_seat``) only outward
        along the ring radius at the same height, so a vessel in a crease below a bulging atrium (the left auricle,
        the pulmonary-vein ostia) is not slid up the atrial wall."""
        if radial_seat:
            return self._groove_radial(key, thetas, h_mm=h_mm, R=R, lift=lift, max_mm=max_mm, min_mm=min_mm, smooth_deg=smooth_deg)
        ring = self.rings[key]
        thetas = np.asarray(thetas, float)
        hh_mm = np.broadcast_to(np.asarray(h_mm, float), (len(thetas),))
        steps = np.arange(-2.0, max_mm + 12.0, 0.25) * MM
        rho = np.full(len(thetas), np.nan)
        for i, t in enumerate(thetas):
            d = ring.dir(t)[0]
            Q = ring.c + ring.n * hh_mm[i] * MM + np.outer(ring.R + steps, d)
            ins = self.sd(Q) < 0
            k = np.flatnonzero(ins)
            if len(k) == 0:
                continue
            j = k[0]
            while j + 1 < len(ins) and ins[j + 1]:
                j += 1
            if j + 1 < len(ins):
                rho[i] = steps[j + 1]
        ok = np.isfinite(rho)
        if not ok.any():
            rho[:] = 8.0 * MM
        rho = np.interp(np.arange(len(rho)), np.flatnonzero(ok), rho[ok]) if (~ok).any() else rho
        dth = float(np.median(np.abs(np.diff(thetas)))) if len(thetas) > 1 else 1.0
        win = max(3, int(round(math.radians(smooth_deg) / max(dth, 1e-6))) | 1)
        rho = ndimage.median_filter(rho, size=win, mode="nearest")
        rho = ndimage.gaussian_filter1d(rho, win / 2.0, mode="nearest")
        rho = np.clip(rho, min_mm * MM, max_mm * MM)
        P = np.vstack([ring.point(t, radial=r_, h=hh * MM)[0] for t, r_, hh in zip(thetas, rho, hh_mm)])
        R = np.broadcast_to(np.asarray(R, float), (len(P),))
        for _ in range(2):
            P = self.seat(P, R, lift, snap=True, iterations=4, sigma=3.0)
            P = smooth(P, 4)
        return P

    def crease_h(self, key: str, thetas: np.ndarray, *, window_deg: float = 4.0, smooth_deg: float = 20.0) -> np.ndarray:
        """Height (mm, along the ring normal; + = atrial) of the bottom of the atrioventricular groove beside ring
        ``key`` at each azimuth: the epicardial vertex nearest the hinge ring within ``window_deg``, median-filtered and
        smoothed along the ring. The groove vessels are placed relative to it (the circumflex on its ventricular side,
        the great cardiac vein on its atrial side)."""
        ring = self.rings[key]
        thetas = np.asarray(thetas, float)
        th_e = ring.theta_of(self.E)
        rd = ring.dist(self.E)
        he = ring.height(self.E)
        h = np.full(len(thetas), np.nan)
        for i, t in enumerate(thetas):
            sel = np.flatnonzero(np.abs(((th_e - t + np.pi) % (2 * np.pi)) - np.pi) < math.radians(window_deg))
            if len(sel):
                h[i] = he[sel[np.argmin(rd[sel])]]
        ok = np.isfinite(h)
        h = np.interp(np.arange(len(h)), np.flatnonzero(ok), h[ok]) if ok.any() else np.zeros(len(h))
        dth = float(np.median(np.abs(np.diff(thetas)))) if len(thetas) > 1 else 1.0
        win = max(3, int(round(math.radians(smooth_deg) / max(dth, 1e-6))) | 1)
        h = ndimage.median_filter(h, size=win, mode="nearest")
        return ndimage.gaussian_filter1d(h, win / 2.0, mode="nearest") / MM

    def _groove_radial(self, key, thetas, *, h_mm, R, lift, max_mm, min_mm, smooth_deg) -> np.ndarray:
        ring = self.rings[key]
        thetas = np.asarray(thetas, float)
        h = np.broadcast_to(np.asarray(h_mm, float), (len(thetas),)) * MM
        Rr = np.broadcast_to(np.asarray(R, float), (len(thetas),))
        steps = np.arange(-2.0, max_mm + 16.0, 0.2) * MM
        want = Rr + lift
        rho = np.full(len(thetas), np.nan)
        for i, t in enumerate(thetas):
            d = ring.dir(t)[0]
            Q = ring.c + ring.n * h[i] + np.outer(ring.R + steps, d)
            sd = self.sd(Q)
            ins = np.flatnonzero(sd < 0)
            if not len(ins):
                continue
            j = ins[0]
            while j + 1 < len(sd) and sd[j + 1] < 0:
                j += 1
            out = np.flatnonzero((np.arange(len(sd)) > j) & (sd >= want[i]))
            if len(out):
                rho[i] = steps[out[0]]
        ok = np.isfinite(rho)
        if not ok.any():
            rho[:] = 8.0 * MM
        rho = np.interp(np.arange(len(rho)), np.flatnonzero(ok), rho[ok]) if (~ok).any() else rho
        dth = float(np.median(np.abs(np.diff(thetas)))) if len(thetas) > 1 else 1.0
        win = max(3, int(round(math.radians(smooth_deg) / max(dth, 1e-6))) | 1)
        rho = ndimage.median_filter(rho, size=win, mode="nearest")
        rho = ndimage.gaussian_filter1d(rho, win / 2.0, mode="nearest")
        rho = np.clip(rho, min_mm * MM, (max_mm + 3.0) * MM)
        P = np.vstack([ring.point(t, radial=r_, h=hh)[0] for t, r_, hh in zip(thetas, rho, h)])
        # never inside: a last outward nudge along the ring radius where smoothing pulled a point into the wall
        for _ in range(8):
            short = np.maximum(0.0, want - self.sd(P))
            if short.max() < 0.05 * MM:
                break
            rho = rho + ndimage.maximum_filter1d(short, 3)
            P = np.vstack([ring.point(t, radial=r_, h=hh)[0] for t, r_, hh in zip(thetas, rho, h)])
        return P

    def grow(self, start: np.ndarray, direction: np.ndarray, length: float, *, R: float, lift: float,
             goal: np.ndarray | None = None, goal_weight: float = 0.15, step: float = 0.8 * MM,
             mode: str = "surface", target_depth: float | None = None) -> np.ndarray:
        """Grow a path from ``start`` along ``direction``.

        ``mode='surface'``: the path stays ``R + lift`` outside the epicardium (tangent kept in the local tangent
        plane), bending gradually towards ``goal`` (a point or ``None``).
        ``mode='septum'``: the path runs inside the myocardium at ``target_depth`` (default: as deep as possible,
        i.e. up the SDF gradient into the mid-wall), bending towards ``goal``."""
        P = [np.asarray(start, float)]
        d = mo.unit(np.asarray(direction, float))
        n_steps = max(2, int(length / step))
        for _ in range(n_steps):
            p = P[-1]
            if goal is not None:
                d = mo.unit(d + goal_weight * mo.unit(goal - p))
            if mode == "surface":
                nrm = self.normal(p[None])[0]
                d = mo.unit(d - (d @ nrm) * nrm)
                q = p + d * step
                q = q + nrm * (R + lift - self.sd(q[None])[0]) * 0.8
            else:
                g = self.normal(p[None])[0]  # points outward; the mid-wall lies against it
                s = self.sd(p[None])[0]
                want = -(target_depth if target_depth is not None else 6.0 * MM)
                d = mo.unit(d - 0.35 * (d @ g) * g)
                q = p + d * step - g * np.clip(s - want, -1.0 * MM, 1.0 * MM) * 0.35
            d = mo.unit(q - p)
            P.append(q)
        return resample(np.array(P), step)


#: A centreline point this far inside the myocardial solid is not in a crease but under a fused structure (in
#: BodyParts3D the tip of the left auricle is fused onto the ventricle over the proximal LAD, the circumflex and the
#: great cardiac vein): it is not pushed out (it would jump over the auricle) but tunnelled - the build carves the
#: channel of the vessel out of the wall (``tunnel_cutter``), so the auricle overlies it as in vivo.
TUNNEL_SD = -2.1 * MM  # on the calibrated field (the uncorrected field read -1.8 mm here)


def tunnel_mask(geo: "HeartGeo", P: np.ndarray, *, grow: int = 3) -> np.ndarray:
    """Centreline points buried under a fused structure (centre inside the solid by more than -TUNNEL_SD), dilated."""
    m = geo.sd(P) < TUNNEL_SD
    return ndimage.binary_dilation(m, iterations=grow) if m.any() else m


#: The lift out of a crease never moves a centreline point further than this (deeper stretches are tunnelled).
MAX_LIFT = 3.5 * MM


def clear_tube(geo: "HeartGeo", P: np.ndarray, R: np.ndarray, *, margin: float, pin_start: int = 0,
               iterations: int = 40) -> np.ndarray:
    """Push a tube out of the myocardium: sample a ring of the tube wall at every centreline point and move the point
    along the wall's outward normal wherever the ring still dips below ``margin`` outside the epicardium (a groove
    vessel is lifted out of the crease instead of cutting into both of its walls). The first ``pin_start`` points (an
    origin on the parent) and tunnelled stretches (``tunnel_mask``) stay; the correction is smoothed along the path."""
    P = np.asarray(P, float).copy()
    P0 = P.copy()
    R = np.asarray(R, float)
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    w = np.ones(len(P))
    if pin_start:
        w[:pin_start] = 0.0
        ramp = min(len(P) - pin_start, 4)
        w[pin_start:pin_start + ramp] = np.linspace(0.3, 1.0, ramp)
    tun = tunnel_mask(geo, P)
    if tun.any():
        w = w * (1.0 - ndimage.uniform_filter1d(tun.astype(float), 5, mode="nearest"))
    for _ in range(iterations):
        T, N, B = frames(P)
        ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
        sd = geo.sd(ring.reshape(-1, 3)).reshape(len(P), -1)
        depth = np.maximum(0.0, margin - sd)
        if (depth.max(axis=1) * w).max() < 0.03 * MM:
            break
        nrm = geo.normal(ring.reshape(-1, 3)).reshape(len(P), -1, 3)
        disp = (nrm * depth[..., None]).sum(axis=1)
        mag = depth.max(axis=1)
        u = disp / np.maximum(np.linalg.norm(disp, axis=1, keepdims=True), 1e-12)
        disp = ndimage.maximum_filter1d(mag, 3)[:, None] * u
        disp = ndimage.gaussian_filter1d(disp * w[:, None], 1.5, axis=0, mode="nearest") if len(P) > 4 else disp * w[:, None]
        step = np.linalg.norm(disp, axis=1, keepdims=True)
        P = P + disp * np.minimum(1.0, 1.0 * MM / np.maximum(step, 1e-12))
        off = P - P0
        mag = np.linalg.norm(off, axis=1, keepdims=True)
        P = P0 + off * np.minimum(1.0, MAX_LIFT / np.maximum(mag, 1e-12))
    return P


def tunnel_cutter(geo: "HeartGeo", paths: list, *, clearance: float = 0.7 * MM, extend: float = 4.0 * MM,
                  residual: float = 0.25 * MM, skip_start: float = 6.0 * MM):
    """Closed tubes (radius + ``clearance``) over every tunnelled stretch of the given (points, radii) centrelines,
    extended ``extend`` on both sides: the build subtracts them from the heart wall. Stretches whose tube wall still
    reaches more than ``residual`` into the myocardium after the lift (a lift capped at ``MAX_LIFT`` over a ridge of the
    wall) get the same channel, a shallow bed, so no vessel is left half inside the wall. The first ``skip_start`` of
    every path is never carved: an origin on its parent vessel, or a vein's ostium that opens through the atrial wall."""
    tubes, stretches = [], []
    for P, R in paths:
        s = arclen(P)
        m = tunnel_mask(geo, P)
        td = tube_depth(geo, P, np.asarray(R, float))
        bed = td > residual
        bed[: int(np.searchsorted(s, skip_start))] = False
        bed &= ~m
        m = m | bed
        if not m.any():
            continue
        idx = np.flatnonzero(m)
        for run in np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1):
            a = int(np.searchsorted(s, s[run[0]] - extend))
            b = int(np.searchsorted(s, s[run[-1]] + extend))
            only_bed = bool(bed[run].all())
            # a bed hugs the vessel (it lies on the wall beside it); a tunnel keeps room for the Boolean
            Q, Rq = P[a:b + 1], R[a:b + 1] + (0.5 * clearance if only_bed else clearance)
            if len(Q) < 3:
                continue
            tubes.append(sweep(Q, Rq, start="round", end="round", adaptive=True, spacing=0.8))
            stretches.append({"kind": "bed" if only_bed else "tunnel",
                              "length_mm": round(float(s[run[-1]] - s[run[0]]) / MM, 1),
                              "depth_mm": round(float(-geo.sd(P[run]).min()) / MM, 1),
                              "wall_depth_mm": round(float(td[run].max()) / MM, 1)})
    if not tubes:
        return (np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)), {"stretches": []}
    return mo.concat(tubes), {"stretches": stretches}


def resample_n(P: np.ndarray, n: int) -> np.ndarray:
    """``n`` points at uniform arc length along the polyline ``P`` (both ends kept)."""
    P = np.asarray(P, float)
    s = arclen(P)
    if s[-1] <= 0:
        return P.copy()
    t = np.linspace(0.0, s[-1], n)
    return np.column_stack([np.interp(t, s, P[:, k]) for k in range(3)])


def tube_depth(geo: "HeartGeo", P: np.ndarray, R: np.ndarray) -> np.ndarray:
    """Deepest penetration of the tube wall into the myocardium at every centreline point (scene units, > 0 inside)."""
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    T, N, B = frames(P)
    ring = P[:, None, :] + R[:, None, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
    return -geo.sd(ring.reshape(-1, 3)).reshape(len(P), -1).min(axis=1)


# =============================================================================================
# Skeletons of BodyParts3D vessel parts (trees of centreline paths)
# =============================================================================================
def skeleton_paths(V: np.ndarray, F: np.ndarray, root_point: np.ndarray, *, pitch: float = 0.3 * MM,
                   min_branch: float = 4.0 * MM, spacing: float = 0.8 * MM) -> list[dict]:
    """Centreline paths of a vessel part (every connected component), each rooted at the leaf nearest
    ``root_point``: ``[{P, parent, r}]``, longest path first, parents before children."""
    import networkx as nx
    from skimage.morphology import skeletonize

    from extract_centerlines import decompose, prune_spurs, smooth_resample

    mesh = trimesh.Trimesh(V, F, process=False)
    out: list[dict] = []
    for comp in mesh.split(only_watertight=False):
        if len(comp.faces) < 40:
            continue
        vg = comp.voxelized(pitch).fill()
        grid = np.pad(vg.matrix, 2)
        origin = vg.transform[:3, 3] - 2 * pitch
        edt = ndimage.distance_transform_edt(grid)
        idx = np.argwhere(skeletonize(grid))
        if len(idx) < 4:
            continue
        pos = origin + idx * pitch
        lookup = {tuple(v): i for i, v in enumerate(idx)}
        g = nx.Graph()
        g.add_nodes_from(range(len(idx)))
        offs = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) > (0, 0, 0)]
        for i, (x, y, z) in enumerate(idx):
            for dx, dy, dz in offs:
                j = lookup.get((x + dx, y + dy, z + dz))
                if j is not None:
                    g.add_edge(i, j, weight=pitch * math.sqrt(dx * dx + dy * dy + dz * dz))
        local_r = edt[idx[:, 0], idx[:, 1], idx[:, 2]] * pitch
        for cc in sorted(nx.connected_components(g), key=len, reverse=True):
            if len(cc) < 6:
                continue
            tree = nx.minimum_spanning_tree(g.subgraph(cc), weight="weight")
            leaves = [n for n in tree.nodes if tree.degree(n) <= 1] or list(tree.nodes)
            root = leaves[int(np.argmin(np.linalg.norm(pos[leaves] - root_point, axis=1)))]
            tree = prune_spurs(tree, root, np.maximum(local_r, 3 * pitch))
            base = len(out)
            keep: dict[int, int] = {}
            for k, (path, parent) in enumerate(decompose(tree, root)):
                P = pos[path]
                L = float(arclen(P)[-1])
                if parent is not None and (L < min_branch or parent not in keep):
                    continue
                keep[k] = len(out)
                out.append({"P": smooth_resample(P, spacing), "parent": None if parent is None else keep[parent],
                            "r": float(np.median(local_r[path])), "component": base})
    return out


def subtree(paths: list[dict], root: int) -> list[int]:
    """Indices of ``root`` and all its descendants (paths are parent-before-child)."""
    out = [root]
    for i, p in enumerate(paths):
        if p["parent"] in out and i not in out:
            out.append(i)
    return out
