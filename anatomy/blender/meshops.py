"""NumPy-only mesh operations used by the Blender build (and unit-tested outside Blender).

Everything here works on plain ``(V, F)`` arrays — ``V`` float ``(n, 3)`` vertex positions and
``F`` int ``(m, 3)`` triangle indices — so it runs identically inside Blender's bundled Python
and in the project virtualenv (``anatomy/tests``).
"""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

Mesh = tuple[np.ndarray, np.ndarray]

# Blender world frame (+X left, -Y anterior, +Z superior) -> glTF frame (+X left, +Y superior, +Z anterior).
BLENDER_TO_GLTF = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])


# --------------------------------------------------------------------------------------------
# Topology
# --------------------------------------------------------------------------------------------
def vertex_components(F: np.ndarray, n_verts: int) -> np.ndarray:
    """Label each vertex with the id of its connected component (vectorised union-find).

    Isolated vertices get their own label. Labels are the minimum vertex index of each component.
    """
    parent = np.arange(n_verts, dtype=np.int64)
    if len(F) == 0:
        return parent
    edges = np.concatenate([F[:, [0, 1]], F[:, [1, 2]]]).astype(np.int64)
    while True:
        pu, pv = parent[edges[:, 0]], parent[edges[:, 1]]
        lo, hi = np.minimum(pu, pv), np.maximum(pu, pv)
        changed = lo != hi
        if not changed.any():
            break
        np.minimum.at(parent, hi[changed], lo[changed])
        while True:  # pointer jumping until every vertex points at its root
            grand = parent[parent]
            if np.array_equal(grand, parent):
                break
            parent = grand
    return parent


def face_components(F: np.ndarray, n_verts: int) -> np.ndarray:
    """Component label per face (see :func:`vertex_components`)."""
    return vertex_components(F, n_verts)[F[:, 0]]


def signed_volume(V: np.ndarray, F: np.ndarray) -> float:
    """Signed enclosed volume (positive for a closed mesh with outward-facing normals)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def compact(V: np.ndarray, F: np.ndarray, face_mask: np.ndarray | None = None) -> Mesh:
    """Keep the masked faces and drop unreferenced vertices, re-indexing ``F``."""
    if face_mask is not None:
        F = F[face_mask]
    used = np.zeros(len(V), dtype=bool)
    used[F.ravel()] = True
    remap = -np.ones(len(V), dtype=np.int64)
    remap[used] = np.arange(int(used.sum()))
    return V[used], remap[F]


def concat(meshes: list[Mesh]) -> Mesh:
    vs, fs, offset = [], [], 0
    for V, F in meshes:
        vs.append(V)
        fs.append(F + offset)
        offset += len(V)
    if not vs:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.concatenate(vs), np.concatenate(fs)


def filter_components(
    V: np.ndarray,
    F: np.ndarray,
    *,
    min_fraction: float = 0.05,
    min_faces: int = 24,
    drop_inverted: bool = True,
) -> tuple[Mesh, dict]:
    """Delete loose fragments of a single BodyParts3D part.

    A component survives when it has at least ``max(min_faces, min_fraction * largest)`` faces and,
    if ``drop_inverted``, a non-negative signed volume (negative volume = an inward-facing internal
    pocket, e.g. the ~2000 void fragments inside the heart-wall mesh). The largest component is
    always kept.
    """
    labels = face_components(F, len(V))
    uniq, counts = np.unique(labels, return_counts=True)
    largest = uniq[np.argmax(counts)]
    threshold = max(min_faces, int(min_fraction * counts.max()))
    keep = np.zeros(len(F), dtype=bool)
    dropped_faces = 0
    for lab, cnt in zip(uniq, counts):
        sel = labels == lab
        ok = lab == largest or cnt >= threshold
        if ok and drop_inverted and lab != largest and signed_volume(V, F[sel]) < 0:
            ok = False
        if ok:
            keep |= sel
        else:
            dropped_faces += int(cnt)
    stats = {
        "components_in": int(len(uniq)),
        "components_kept": int(len(np.unique(labels[keep]))),
        "faces_dropped": dropped_faces,
    }
    return compact(V, F, keep), stats


def inverted_component_faces(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    """Boolean mask of the faces whose connected component encloses a negative signed volume.

    For a consistently wound component this is the robust "inside-out" test (bmesh's normal
    recalculation guesses outwardness from a single extreme face and inverts thin sheets such as
    pectoralis major). Open components with small holes still give the right sign.
    """
    labels = face_components(F, len(V))
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    contrib = np.einsum("ij,ij->i", a - V.mean(axis=0), np.cross(b - a, c - a))
    uniq, inv = np.unique(labels, return_inverse=True)
    vol = np.bincount(inv, weights=contrib, minlength=len(uniq))
    return vol[inv] < 0.0


def taubin_smooth(
    V: np.ndarray,
    F: np.ndarray,
    *,
    iterations: int = 10,
    lam: float = 0.5,
    mu: float = -0.53,
    pinned: np.ndarray | None = None,
) -> np.ndarray:
    """Taubin lambda|mu smoothing (umbrella Laplacian): a low-pass filter that removes
    high-frequency noise — BodyParts3D's segmentation stair-steps — without the shrinkage of plain
    Laplacian smoothing. ``pinned`` vertices (bool mask) do not move.
    """
    V = np.asarray(V, dtype=np.float64).copy()
    e = unique_edges(F)
    n = len(V)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1.0
    free = np.ones(n, dtype=bool) if pinned is None else ~np.asarray(pinned, dtype=bool)
    for _ in range(iterations):
        for factor in (lam, mu):
            acc = np.empty_like(V)
            for k in range(3):
                acc[:, k] = np.bincount(e[:, 0], weights=V[e[:, 1], k], minlength=n) + np.bincount(
                    e[:, 1], weights=V[e[:, 0], k], minlength=n
                )
            lap = acc / deg[:, None] - V
            V[free] += factor * lap[free]
    return V


def largest_component(V: np.ndarray, F: np.ndarray) -> Mesh:
    labels = face_components(F, len(V))
    uniq, counts = np.unique(labels, return_counts=True)
    return compact(V, F, labels == uniq[np.argmax(counts)])


# --------------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------------
def bbox(V: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return V.min(axis=0), V.max(axis=0)


def bbox_center(V: np.ndarray) -> np.ndarray:
    lo, hi = bbox(V)
    return (lo + hi) / 2.0


def face_centers(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    return V[F].mean(axis=1)


def face_normals(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def unit(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def arm_plane(axilla_xz: tuple[float, float], shoulder_xz: tuple[float, float], side: int) -> tuple[np.ndarray, np.ndarray]:
    """Oblique cutting plane that removes an upper limb at the shoulder.

    The plane contains the antero-posterior axis and passes through the axilla and the lateral
    shoulder point (given for the left side, x > 0; ``side=-1`` mirrors to the right).
    Returns ``(point, normal)`` with the normal pointing laterally (towards the arm).
    """
    ax, az = axilla_xz
    sx, sz = shoulder_xz
    d = np.array([sx - ax, 0.0, sz - az])
    n = unit(np.array([d[2], 0.0, -d[0]]))  # perpendicular to d in the coronal plane, lateral
    point = np.array([side * ax, 0.0, az])
    normal = np.array([side * n[0], 0.0, n[2]])
    return point, normal


#: Anatomical prior for the direction of the cardiac apex from the valve plane, in the Blender /
#: BodyParts3D world frame: patient-left (+X), anterior (-Y), inferior (-Z).
APEX_PRIOR = np.array([1.0, -1.0, -1.0]) / np.sqrt(3.0)


def heart_long_axis(
    heart_V: np.ndarray, valve_V: np.ndarray, apex_prior: np.ndarray = APEX_PRIOR
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(base_center, apex, axis)`` where ``axis`` points from apex to base.

    The base centre is the centroid of the atrioventricular (mitral + tricuspid) valve vertices.
    The apex is the most left-anterior-inferior heart-wall vertex (the extreme point along the
    anatomical prior) — on BodyParts3D it lies 4.5 mm from the distal end of the LAD, whereas the
    point farthest from the base lies on the lateral wall or, unconstrained, on the atria.
    """
    base = valve_V.mean(axis=0)
    apex = heart_V[np.argmax(heart_V @ unit(apex_prior))]
    return base, apex, unit(base - apex)


def heart_cut_plane(base: np.ndarray, apex: np.ndarray, anterior: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Long-axis cutting plane whose normal is the anterior direction made orthogonal to the axis.

    The plane contains the apex-to-base axis, so it opens both ventricles along their length
    (a coronal long-axis section), and passes through the axis midpoint.
    """
    axis = unit(base - apex)
    a = np.asarray(anterior, dtype=np.float64)
    n = unit(a - np.dot(a, axis) * axis)
    return (base + apex) / 2.0, n


def territory_weights(
    dist: np.ndarray,
    *,
    sigma: float,
    fade_start: float,
    fade_tau: float,
    extra_fade: np.ndarray | None = None,
) -> np.ndarray:
    """Soft perfusion-territory weights from distances to each coronary group.

    ``dist`` is ``(n, k)`` (distance from each vertex to the nearest point of each of the ``k``
    groups). Weights are ``softmax(-d / sigma)`` scaled by a proximity fade
    ``exp(-max(0, min_d - fade_start) / fade_tau)`` (and an optional extra per-vertex fade, used to
    keep the atria neutral), so each row sums to the vertex's territory confidence in ``[0, 1]``.
    """
    dist = np.asarray(dist, dtype=np.float64)
    logits = -dist / sigma
    logits -= logits.max(axis=1, keepdims=True)
    w = np.exp(logits)
    w /= w.sum(axis=1, keepdims=True)
    dmin = dist.min(axis=1)
    fade = np.exp(-np.maximum(0.0, dmin - fade_start) / fade_tau)
    if extra_fade is not None:
        fade = fade * extra_fade
    return w * fade[:, None]


def unique_edges(F: np.ndarray) -> np.ndarray:
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    return np.unique(e, axis=0)


def smooth_vertex_values(values: np.ndarray, F: np.ndarray, *, iterations: int = 6, lam: float = 0.5) -> np.ndarray:
    """Laplacian smoothing of per-vertex values over the mesh graph (umbrella operator).

    Used to soften territory boundaries so that decimated-mesh Voronoi seams do not look jagged.
    """
    vals = np.asarray(values, dtype=np.float64).copy()
    squeeze = vals.ndim == 1
    if squeeze:
        vals = vals[:, None]
    e = unique_edges(F)
    deg = np.bincount(e.ravel(), minlength=len(vals)).astype(np.float64)
    deg[deg == 0] = 1.0
    for _ in range(iterations):
        acc = np.zeros_like(vals)
        np.add.at(acc, e[:, 0], vals[e[:, 1]])
        np.add.at(acc, e[:, 1], vals[e[:, 0]])
        vals = (1.0 - lam) * vals + lam * acc / deg[:, None]
    return vals[:, 0] if squeeze else vals


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((np.asarray(x, dtype=np.float64) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def to_gltf(V: np.ndarray) -> np.ndarray:
    """Convert Blender world coordinates to the glTF / contract frame."""
    return np.asarray(V, dtype=np.float64) @ BLENDER_TO_GLTF.T


# --------------------------------------------------------------------------------------------
# I/O
# --------------------------------------------------------------------------------------------
def write_ply(path: Path, V: np.ndarray, F: np.ndarray) -> None:
    """Write a little-endian binary PLY (float32 vertices, uint32 triangle indices)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(V)}\nproperty float x\nproperty float y\nproperty float z\n"
        f"element face {len(F)}\nproperty list uchar uint vertex_indices\nend_header\n"
    ).encode("ascii")
    faces = np.empty(len(F), dtype=[("n", "u1"), ("i", "<u4", (3,))])
    faces["n"] = 3
    faces["i"] = F
    with open(path, "wb") as fh:
        fh.write(header)
        fh.write(np.asarray(V, dtype="<f4").tobytes())
        fh.write(faces.tobytes())


def read_ply(path: Path) -> Mesh:
    """Read a binary PLY written by :func:`write_ply`."""
    data = Path(path).read_bytes()
    end = data.index(b"end_header\n") + len(b"end_header\n")
    header = data[:end].decode("ascii").splitlines()
    nv = int(next(l for l in header if l.startswith("element vertex")).split()[-1])
    nf = int(next(l for l in header if l.startswith("element face")).split()[-1])
    V = np.frombuffer(data, dtype="<f4", count=nv * 3, offset=end).reshape(nv, 3).astype(np.float64)
    faces = np.frombuffer(data, dtype=[("n", "u1"), ("i", "<u4", (3,))], count=nf, offset=end + nv * 12)
    return V, faces["i"].astype(np.int64)


def read_stl(path: Path) -> Mesh:
    """Read a binary STL, merging exactly coincident vertices."""
    raw = Path(path).read_bytes()
    (n,) = struct.unpack("<I", raw[80:84])
    rec = np.frombuffer(raw, dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")], count=n, offset=84)
    tri = rec["v"].reshape(-1, 3).astype(np.float64)
    V, inv = np.unique(tri, axis=0, return_inverse=True)
    return V, inv.reshape(-1, 3).astype(np.int64)
