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
* **Papillary muscles** — stout muscular fingers placed from the BodyParts3D muscles: their lower part lies fused
  to the ventricular wall as a broad, low ridge (half sunk into it, flattened against it, with a few trabecular
  roots spreading from the base) and rises free to a conical, rounded head (two heads for the LV muscles), with a
  faint relief of muscle bundles. LV muscles are ~15 mm across at the base; in the RV the anterior muscle is the
  largest, the posterior small and the septal (medial) muscle a little stub.
* **Moderator band** (septomarginal trabecula) — a ~5 mm muscular band across the RV cavity from the septum to the
  base of the anterior papillary muscle.
* **Trabeculae carneae** — muscular ridges on the endocardium: fine ones in the apical third of the LV, coarse ones
  over the RV body and apex (the outflow tract stays smooth), lying along the wall, largely sunk into it.

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
#: Papillary muscles: radii (mm: base, mid, head) and the fraction of the root -> head length that lies fused to the
#: wall before the free head.
PAP_SHAPE = {
    "LV_AL": ((7.0, 5.0, 2.9), 0.45),
    "LV_PM": ((7.4, 5.2, 2.9), 0.5),
    "RV_A": ((5.0, 3.7, 2.3), 0.4),
    "RV_P": ((3.4, 2.7, 1.9), 0.35),
    "RV_S": ((2.6, 2.1, 1.6), 0.3),
}
#: How high the axis of a fused muscle / trabecula lies above the wall, as a fraction of its radius (the rest sinks).
PAP_LIFT, TRAB_LIFT = 0.35, 0.3
MODERATOR_R_MM = 2.5
#: Trabeculae carneae: (count, radius range mm, length range mm) per ventricle.
TRAB_LV = (44, (0.9, 1.7), (12.0, 26.0))
TRAB_RV = (48, (1.2, 2.3), (12.0, 28.0))
#: Most trabeculae run with the long axis (within +-TRAB_ALONG_DEG of it), the rest obliquely, as in an opened
#: ventricle's lower two thirds.
TRAB_ALONG_DEG, TRAB_OBLIQUE_FRACTION = 25.0, 0.25


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


def muscle_tube(P: np.ndarray, R: np.ndarray, *, wall_n: np.ndarray | None = None, flatten: np.ndarray | None = None,
                sides: int = 18, rough: float = 0.07, seed: int = 0, end: str = "round") -> mo.Mesh:
    """Closed tube along ``P`` (radii ``R``): a flat start (buried in the wall) and a rounded (or flat) end, with a
    faint muscular relief (a smooth angular / longitudinal ripple of the radius: bundles running along it), each ring
    flattened against the wall (``wall_n`` per point; ``flatten`` 1 = round, < 1 = a broad, low ridge)."""
    P, R = np.asarray(P, float), np.asarray(R, float)
    T, N, B = vs.frames(P)
    s = vs.arclen(P)
    u = s / max(s[-1], 1e-12)
    ph = np.random.default_rng(seed).uniform(0.0, 2 * np.pi, 3)
    ang = np.linspace(0.0, 2 * np.pi, sides, endpoint=False)
    ca, sa = np.cos(ang)[:, None], np.sin(ang)[:, None]
    rings = []
    for i in range(len(P)):
        relief = 1.0 + rough * (0.55 * np.sin(3 * ang + ph[0] + 6.0 * u[i]) + 0.3 * np.sin(5 * ang + ph[1] - 9.0 * u[i])
                                + 0.15 * np.sin(2 * ang + ph[2] + 3.0 * u[i]))
        d = R[i] * relief[:, None] * (ca * N[i] + sa * B[i])
        if wall_n is not None and flatten is not None and flatten[i] < 1.0:
            n = wall_n[i] - (wall_n[i] @ T[i]) * T[i]
            n = n / max(float(np.linalg.norm(n)), 1e-12)
            d = d - np.outer(d @ n, n) * (1.0 - flatten[i])
        rings.append(P[i] + d)
    if end == "round":
        for f in (0.92, 0.7, 0.38):
            rings.append(P[-1] + T[-1] * R[-1] * math.sqrt(1 - f * f) + R[-1] * f * (ca * N[-1] + sa * B[-1]))
    V = np.vstack(rings)
    F = []
    for a in range(len(rings) - 1):
        o0, o1 = a * sides, (a + 1) * sides
        for k in range(sides):
            k2 = (k + 1) % sides
            F += [(o0 + k, o1 + k, o1 + k2), (o0 + k, o1 + k2, o0 + k2)]
    c0 = len(V)
    tip = P[-1] + T[-1] * R[-1] * (1.0 if end == "round" else 0.0)
    V = np.vstack([V, P[0], tip])
    b = (len(rings) - 1) * sides
    for k in range(sides):
        k2 = (k + 1) % sides
        F += [(c0, k2, k), (c0 + 1, b + k, b + k2)]
    F = np.array(F, dtype=np.int64)
    if mo.signed_volume(V, F) < 0:
        F = F[:, ::-1]
    return V, F


def _seated(geo, P: np.ndarray, lift: np.ndarray, *, snap: bool) -> np.ndarray:
    """Points moved along the wall's distance gradient to ``lift`` above the myocardium (``snap`` False: only out)."""
    return geo.seat(P, 0.0, lift, snap=snap, iterations=8, sigma=1.5)


def wall_band(geo, p0: np.ndarray, d0: np.ndarray, length: float, r0: float, r1: float, *, lift: float = TRAB_LIFT,
              wander: float = 0.0, seed: int = 0, sides: int = 7) -> mo.Mesh | None:
    """A muscular band (trabecula) lying along the wall from ``p0`` heading ``d0``: walked over the surface in
    1 mm steps (each step seated ``lift`` x radius above the wall), tapering from ``r0`` to ``r1`` (scene units)."""
    rng = np.random.default_rng(seed)
    step = 1.4 * MM
    n_steps = max(4, int(length / step))
    r = np.linspace(r0, r1, n_steps + 1)
    # a ridge that rises out of the wall and sinks back into it (no free ends)
    tt = np.linspace(0.0, 1.0, n_steps + 1)
    rise = mo.smoothstep(0.0, 0.22, tt) * mo.smoothstep(1.0, 0.78, tt)
    lifts = r * (-0.7 + (lift + 0.7) * rise)
    P = [np.asarray(p0, float) - geo.normal(np.asarray(p0, float)[None])[0] * 0.7 * r0]
    d = np.asarray(d0, float)
    for k in range(n_steps):
        n = geo.normal(P[-1][None])[0]
        d = d - (d @ n) * n
        nd = float(np.linalg.norm(d))
        if nd < 1e-9:
            return None
        d = d / nd
        if wander:
            b = np.cross(n, d)
            d = mo.unit(d + b * rng.normal(0.0, wander))
        q = _seated(geo, (P[-1] + d * step)[None], np.array([lifts[k + 1]]), snap=True)[0]
        P.append(q)
    P = np.array(P)
    if np.any(np.linalg.norm(np.diff(P, axis=0), axis=1) > 3 * step):  # jumped across a cavity / off an edge
        return None
    # it must lie on the wall all along (a walk over a fold or an orifice leaves it): its axis within 1 mm of the
    # height it was seated at
    if np.abs(geo.sd(P) - lifts).max() > 1.0 * MM:
        return None
    wn = geo.normal(P)
    return muscle_tube(P, r, wall_n=wn, flatten=np.full(len(P), 0.62), sides=sides, rough=0.05, seed=seed, end="flat")


def papillary_muscle(geo, root: np.ndarray, head: np.ndarray, into_wall: np.ndarray, *, radii, fused: float,
                     heads: int = 1, seed: int = 0, cut=None) -> tuple[mo.Mesh, list, dict]:
    """A stout muscular finger from its root on the ventricular wall to a rounded head (two small heads for the LV
    muscles): fused to the wall over its lower ``fused`` fraction (a broad ridge, axis ``PAP_LIFT`` x radius above the
    wall, flattened against it), free and conical above, with three short trabecular roots spreading from its base.
    Returns the mesh, the chordal tips and the base (point, wall normal, direction along the wall)."""
    n0 = mo.unit(into_wall)  # points from the wall into the cavity
    L = float(np.linalg.norm(head - root))
    m = max(14, int(L / (1.0 * MM)))
    t = np.linspace(0.0, 1.0, m)
    chord_ = root + t[:, None] * (head - root)[None]
    r = np.interp(t, [0.0, 0.25, 0.6, 1.0], [radii[0], radii[0] * 0.9, radii[1], radii[2]]) * MM
    # the axis rises out of the wall over the first fifth (the base emerges as a mound, not a stump), then runs
    # PAP_LIFT x radius above it
    lift = r * (-0.55 + (PAP_LIFT + 0.55) * mo.smoothstep(0.0, 0.22, t))
    hug = _seated(geo, chord_, lift, snap=True)
    w = 1.0 - mo.smoothstep(fused - 0.18, fused + 0.12, t)
    P = w[:, None] * hug + (1.0 - w[:, None]) * chord_
    for _ in range(4):  # relax the bend where the head leaves the wall (ends kept)
        P[1:-1] = 0.5 * P[1:-1] + 0.25 * (P[:-2] + P[2:])
    P = _seated(geo, P, np.minimum(lift, PAP_LIFT * r), snap=False)  # never deeper into the wall
    P[-1] = head
    P = np.vstack([P[0] - n0 * 0.5 * r[0], P])  # the base sinks into the wall
    r = np.r_[r[0], r]
    wn = geo.normal(P)
    flat = np.r_[0.68, 0.68 + 0.32 * (1.0 - w)]
    meshes = [muscle_tube(P, r, wall_n=wn, flatten=flat, sides=20, rough=0.07, seed=seed)]
    a = mo.unit(head - P[-3])
    tips = [head]
    if heads == 2:  # bifid: two small heads on the rounded end
        side = mo.unit(np.cross(a, [0.0, 0.0, 1.0]) if abs(a[2]) < 0.9 else np.cross(a, [1.0, 0.0, 0.0]))
        off = side * 2.6 * MM
        tips = []
        for sgn in (-1.0, 1.0):
            h0 = head - a * 3.0 * MM
            h1 = head + a * 2.4 * MM + sgn * off
            Q = vs.resample(np.vstack([h0, 0.5 * (h0 + h1) + sgn * off * 0.3, h1]), 1.0 * MM)
            meshes.append(vs.sweep(Q, np.linspace(2.5, 1.8, len(Q)) * MM, start="round", end="round", sides=12, adaptive=False))
            tips.append(h1)
    # trabecular roots: short bands spreading over the wall from the base (not for the little septal stub)
    i_b = max(2, int(0.12 * len(P)))
    base, nb = P[i_b], wn[i_b]
    along = P[min(len(P) - 1, i_b + 4)] - P[i_b]
    along = mo.unit(along - (along @ nb) * nb)
    if radii[0] >= 3.0:
        rng = np.random.default_rng(seed + 101)
        for k, ang in enumerate((125.0, -140.0, 175.0)):
            a_ = math.radians(ang + rng.uniform(-20.0, 20.0))
            d = math.cos(a_) * along + math.sin(a_) * np.cross(nb, along)
            p0 = base + d * r[i_b] * 0.6
            band = wall_band(geo, p0, d, rng.uniform(7.0, 12.0) * MM * radii[0] / 7.0, 0.33 * r[i_b], 0.12 * r[i_b],
                             wander=0.08, seed=seed * 10 + k)
            # a root opens with its muscle (the viewer splits whole pieces by their centroid)
            if band is not None and (cut is None or one_side(band, cut, 0.0) == np.sign((P.mean(axis=0) - cut[0]) @ cut[1])):
                meshes.append(band)
    return mo.concat(meshes), tips, {"point": base, "normal": nb, "along": along, "path": P, "radius": r}


def _ray_to_wall(geo, o: np.ndarray, d: np.ndarray, *, max_len: float = 0.8, clearance: float = 0.3 * MM):
    """March from ``o`` (in a cavity) along ``d`` to the wall (sphere tracing on the distance field): the hit point,
    or None when the ray leaves the field or starts inside the myocardium."""
    p = np.asarray(o, float).copy()
    if geo.sd(p[None])[0] <= clearance:
        return None
    travelled = 0.0
    while travelled < max_len:
        s = float(geo.sd(p[None])[0])
        if s <= clearance:
            return p
        stepd = max(s - clearance * 0.5, 0.25 * MM)
        p = p + d * stepd
        travelled += stepd
    return None


def moderator_band(geo, base: dict, axis_c: np.ndarray, axis_u: np.ndarray, *, seed: int = 0) -> mo.Mesh | None:
    """The septomarginal trabecula: from the RV anterior papillary muscle's base straight across the RV cavity to the
    septum (towards the LV axis), slightly bowed towards the apex, both ends sunk."""
    p = base["point"] + base["normal"] * 2.0 * MM
    x = axis_c + ((p - axis_c) @ axis_u) * axis_u  # closest point on the LV axis
    d = mo.unit(x - p)
    hit = _ray_to_wall(geo, p, d, max_len=0.6)
    if hit is None:
        return None
    a, b = base["point"], hit
    L = float(np.linalg.norm(b - a))
    if not (8.0 * MM <= L <= 40.0 * MM):
        return None
    t = np.linspace(0.0, 1.0, max(8, int(L / (1.0 * MM))))
    P = a[None] + t[:, None] * (b - a)[None] + (np.sin(np.pi * t) * 2.0 * MM)[:, None] * axis_u[None]
    n_a, n_b = geo.normal(a[None])[0], geo.normal(b[None])[0]
    R = np.interp(t, [0.0, 0.2, 0.8, 1.0], [1.25, 1.0, 1.0, 1.2]) * MODERATOR_R_MM * MM
    P = np.vstack([a - n_a * 1.5 * MM, P[1:-1], b - n_b * 1.5 * MM])  # both ends buried
    return muscle_tube(P, R, sides=12, rough=0.06, seed=seed, end="flat")


#: Pieces this close to the heart's cut plane are not made: the viewer opens each loose piece with the half its
#: centroid lies in, so a trabecula across the plane would hang off the opened wall it no longer lies on.
CUT_MARGIN_MM = 2.5


def one_side(mesh: mo.Mesh, cut, margin: float = CUT_MARGIN_MM * MM) -> int:
    """+1 / -1 when every vertex lies beyond ``margin`` on that side of the cut plane ``(point, normal)``, else 0."""
    if cut is None:
        return 1
    sd = (np.asarray(mesh[0]) - cut[0]) @ cut[1]
    return 1 if sd.min() > margin else -1 if sd.max() < -margin else 0


def trabeculae(geo, centres: np.ndarray, rng: np.random.Generator, *, count: int, r_mm, len_mm, longitudinal: np.ndarray,
               keep=None, cut=None) -> list:
    """Trabeculae carneae seeded where rays from ``centres`` (points in the cavity) meet the endocardium, each lying
    along the wall in a direction between the long axis (``longitudinal``) and the circumferential one."""
    out = []
    tries = 0
    while len(out) < count and tries < count * 12:
        tries += 1
        c = centres[rng.integers(len(centres))]
        d = rng.normal(size=3)
        d = d - (d @ longitudinal) * longitudinal * 0.7  # mostly sideways: towards the free wall / septum
        d = mo.unit(d)
        hit = _ray_to_wall(geo, c, d)
        if hit is None or (keep is not None and not keep(hit)):
            continue
        n = geo.normal(hit[None])[0]
        lon = longitudinal - (longitudinal @ n) * n
        if np.linalg.norm(lon) < 1e-6:
            continue
        lon = mo.unit(lon)
        circ = np.cross(n, lon)
        spread = 70.0 if rng.uniform() < TRAB_OBLIQUE_FRACTION else TRAB_ALONG_DEG
        beta = math.radians(rng.uniform(-spread, spread))
        dirn = math.cos(beta) * lon + math.sin(beta) * circ
        r0 = rng.uniform(*r_mm) * MM
        band = wall_band(geo, hit, dirn, rng.uniform(*len_mm) * MM, r0, r0 * 0.55, wander=0.1, seed=int(rng.integers(1 << 30)))
        if band is not None and one_side(band, cut):
            out.append(band)
    return out


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
    cut = mo.heart_cut_plane(geo.base, geo.apex, np.array([0.0, -1.0, 0.0]))  # the build's heart cut (meshops)
    pap = {}
    for k_, (key, pid, ring_key, heads) in enumerate((("LV_AL", "FMA9352nsn", "MA", 2), ("LV_PM", "FMA7266", "MA", 2),
                                                      ("RV_A", "FMA7260", "TA", 1), ("RV_P", "FMA7261", "TA", 1),
                                                      ("RV_S", "FMA7262", "TA", 1))):
        X, _ = parts.scene(pid)
        root, head, into = _pap_root_head(X, geo.rings[ring_key], tm)
        # the head is pulled 25 % towards the root: BodyParts3D's heads reach up into the leaflets
        head = root + 0.8 * (head - root)
        radii, fused = PAP_SHAPE[key]
        mesh, tips, base = papillary_muscle(geo, root, head, into, radii=radii, fused=fused, heads=heads, seed=7 + k_,
                                            cut=cut)
        pap[key] = {"mesh": mesh, "tips": tips, "base": base, "ring": ring_key,
                    "theta": float(geo.rings[ring_key].theta_of(head[None])[0])}
    # moderator band and trabeculae carneae (REFERENCE.md §4.5)
    ma_r, ta_r = geo.rings["MA"], geo.rings["TA"]
    lv_u = mo.unit(geo.apex - ma_r.c)
    extra = []
    mb = moderator_band(geo, pap["RV_A"]["base"], ma_r.c, lv_u, seed=3)
    if mb is not None:
        extra.append(mb)
    rng = np.random.default_rng(2024)
    lv_len = float(np.linalg.norm(geo.apex - ma_r.c))
    lv_centres = ma_r.c[None] + np.linspace(0.5, 0.86, 8)[:, None] * (geo.apex - ma_r.c)[None]
    lv_centres = lv_centres[geo.sd(lv_centres) > 2.0 * MM]

    def lv_keep(p):  # the lower half of the LV (its apical part is the most trabeculated)
        return ((p - ma_r.c) @ lv_u) / lv_len >= 0.45

    trab_lv = trabeculae(geo, lv_centres, rng, count=TRAB_LV[0], r_mm=TRAB_LV[1], len_mm=TRAB_LV[2], longitudinal=lv_u,
                         keep=lv_keep, cut=cut) if len(lv_centres) else []
    pv_c = parts.scene("FMA7246")[0].mean(axis=0)  # pulmonary valve: its outflow tract stays smooth
    rv_targets = [pap[k]["base"]["point"] for k in ("RV_A", "RV_P")]
    rv_centres = np.array([ta_r.c + f * (q - ta_r.c) for q in rv_targets for f in (0.45, 0.6, 0.75)])
    rv_centres = rv_centres[geo.sd(rv_centres) > 2.0 * MM]

    def rv_keep(p):  # below the tricuspid hinge, away from the infundibulum
        return ((ta_r.c - p) @ ta_r.n) >= 8.0 * MM and np.linalg.norm(p - pv_c) >= 22.0 * MM

    trab_rv = trabeculae(geo, rv_centres, rng, count=TRAB_RV[0], r_mm=TRAB_RV[1], len_mm=TRAB_RV[2],
                         longitudinal=mo.unit(geo.apex - ta_r.c), keep=rv_keep, cut=cut) if len(rv_centres) else []
    extra += trab_lv + trab_rv
    out["SYN_PapillaryMuscles"] = mo.concat([p["mesh"] for p in pap.values()] + extra)
    report["moderator_band"] = mb is not None
    report["trabeculae"] = {"lv": len(trab_lv), "rv": len(trab_rv)}

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
