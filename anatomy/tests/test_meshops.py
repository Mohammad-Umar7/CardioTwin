"""Unit tests for the NumPy geometry utilities shared by the Blender build and the tooling."""
from __future__ import annotations

import numpy as np
import pytest

import meshops as mo


def tetra(offset=(0.0, 0.0, 0.0), scale: float = 1.0, flip: bool = False) -> mo.Mesh:
    V = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=float) * scale + np.asarray(offset)
    F = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]])
    return V, (F[:, ::-1] if flip else F)


def cube() -> mo.Mesh:
    V = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=float)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    F = np.array([t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))])
    return V, F


def test_signed_volume_of_unit_cube_and_its_inverse():
    V, F = cube()
    assert mo.signed_volume(V, F) == pytest.approx(1.0)
    assert mo.signed_volume(V, F[:, ::-1]) == pytest.approx(-1.0)


def test_components_label_disjoint_pieces():
    (V1, F1), (V2, F2) = tetra(), tetra(offset=(5, 0, 0))
    V, F = mo.concat([(V1, F1), (V2, F2)])
    labels = mo.face_components(F, len(V))
    assert len(np.unique(labels)) == 2
    assert np.all(labels[:4] == labels[0]) and np.all(labels[4:] == labels[4])


def test_filter_components_drops_fragments_and_inverted_pockets():
    big = tetra(scale=10.0)
    V, F = mo.concat([big, tetra(offset=(20, 0, 0)), tetra(offset=(1, 1, 1), scale=2.0, flip=True)])
    # All three pieces have 4 faces: first isolate the volume-sign rule, then the face-count rule.
    (Vk, Fk), stats = mo.filter_components(V, F, min_fraction=0.0, min_faces=1, drop_inverted=True)
    assert stats["components_in"] == 3
    assert stats["components_kept"] == 2  # the inverted pocket is gone
    assert mo.signed_volume(Vk, Fk) > 0
    (_, Fk2), stats2 = mo.filter_components(V, F, min_fraction=0.0, min_faces=5, drop_inverted=False)
    assert stats2["components_kept"] == 1 and len(Fk2) == 4  # only the largest survives


def test_compact_reindexes_faces():
    V, F = mo.concat([tetra(), tetra(offset=(3, 0, 0))])
    Vc, Fc = mo.compact(V, F, np.arange(len(F)) >= 4)
    assert len(Vc) == 4 and Fc.max() == 3
    assert np.allclose(Vc.min(axis=0), [3, 0, 0])


def test_arm_plane_is_mirrored_and_passes_through_axilla():
    p_l, n_l = mo.arm_plane((159.0, 1140.0), (190.0, 1350.0), side=1)
    p_r, n_r = mo.arm_plane((159.0, 1140.0), (190.0, 1350.0), side=-1)
    assert p_l[0] == pytest.approx(159.0) and p_r[0] == pytest.approx(-159.0)
    assert n_l[0] > 0.9 and n_r[0] < -0.9  # normals point laterally, towards the arms
    assert n_l[1] == 0.0 and np.linalg.norm(n_l) == pytest.approx(1.0)
    shoulder = np.array([190.0, 0.0, 1350.0])
    assert np.dot(shoulder - p_l, n_l) == pytest.approx(0.0, abs=1e-9)


def test_heart_axis_uses_left_anterior_inferior_apex_and_cut_plane_contains_axis():
    rng = np.random.default_rng(0)
    heart = rng.normal(size=(2000, 3)) * [30, 20, 25]
    apex_true = np.array([60.0, -40.0, -50.0])  # left, anterior (-Y), inferior
    heart = np.vstack([heart, apex_true])
    valves = rng.normal(size=(200, 3)) * 5 + [-10, 5, 20]
    base, apex, axis = mo.heart_long_axis(heart, valves)
    assert np.allclose(apex, apex_true)
    assert np.allclose(axis, mo.unit(base - apex))
    point, normal = mo.heart_cut_plane(base, apex, np.array([0.0, -1.0, 0.0]))
    assert abs(np.dot(normal, axis)) < 1e-9  # the plane contains the long axis
    assert np.dot(normal, [0.0, -1.0, 0.0]) > 0  # and faces anteriorly
    assert np.allclose(point, (base + apex) / 2)


def test_territory_weights_follow_nearest_group_and_fade_far_away():
    dist = np.array([[0.1, 1.0, 1.0], [1.0, 0.1, 1.0], [1.0, 1.0, 0.1], [5.0, 5.0, 5.0]])
    w = mo.territory_weights(dist, sigma=0.1, fade_start=0.2, fade_tau=0.2)
    assert list(w[:3].argmax(axis=1)) == [0, 1, 2]
    assert np.all(w.sum(axis=1) <= 1.0 + 1e-12)
    assert w[:3].sum(axis=1).min() > 0.99  # close to an artery: full confidence
    assert w[3].sum() < 1e-6  # far from every artery: neutral
    faded = mo.territory_weights(dist, sigma=0.1, fade_start=0.2, fade_tau=0.2, extra_fade=np.array([0, 1, 1, 1.0]))
    assert faded[0].sum() == 0.0


def test_smooth_vertex_values_preserves_constants_and_range():
    V, F = cube()
    const = np.full((len(V), 3), 0.4)
    assert np.allclose(mo.smooth_vertex_values(const, F, iterations=5), 0.4)
    spike = np.zeros(len(V))
    spike[0] = 1.0
    out = mo.smooth_vertex_values(spike, F, iterations=3)
    assert out.max() < 1.0 and out.min() >= 0.0 and out.sum() > 0


def test_smoothstep_edges():
    x = np.array([-1.0, 0.0, 0.5, 1.0, 2.0])
    assert np.allclose(mo.smoothstep(0.0, 1.0, x), [0, 0, 0.5, 1, 1])


def test_blender_to_gltf_axes():
    # Blender/BodyParts3D: -Y anterior, +Z superior, +X patient-left.
    g = mo.to_gltf(np.array([[0, -1, 0], [0, 0, 1], [1, 0, 0]], dtype=float))
    assert np.allclose(g, [[0, 0, 1], [0, 1, 0], [1, 0, 0]])


def test_ply_round_trip(tmp_path):
    V, F = cube()
    path = tmp_path / "cube.ply"
    mo.write_ply(path, V, F)
    V2, F2 = mo.read_ply(path)
    assert np.allclose(V, V2) and np.array_equal(F, F2)


def test_read_stl_merges_shared_vertices(tmp_path):
    V, F = tetra()
    tri = V[F].astype("<f4")
    rec = np.zeros(len(F), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["v"] = tri
    path = tmp_path / "t.stl"
    path.write_bytes(b"\0" * 80 + np.uint32(len(F)).tobytes() + rec.tobytes())
    V2, F2 = mo.read_stl(path)
    assert len(V2) == 4 and F2.shape == (4, 3)
    assert mo.signed_volume(V2, F2) == pytest.approx(mo.signed_volume(V, F))


def test_inverted_component_faces_flags_only_the_inside_out_piece():
    # A far-away inside-out cube must be detected by its own volume, independent of the offset.
    V1, F1 = cube()
    V2, F2 = cube()
    V, F = mo.concat([(V1, F1), (V2 + 40.0, F2[:, ::-1])])
    mask = mo.inverted_component_faces(V, F)
    assert not mask[: len(F1)].any()
    assert mask[len(F1):].all()

