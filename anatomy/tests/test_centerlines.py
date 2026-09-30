"""Tests for the centreline graph algorithms on synthetic trees and a synthetic tube."""
from __future__ import annotations

import networkx as nx
import numpy as np
import pytest
import trimesh

import extract_centerlines as ec


def chain(g: nx.Graph, nodes: list[int], step: float = 1.0) -> None:
    for a, b in zip(nodes, nodes[1:]):
        g.add_edge(a, b, weight=step)


def y_tree() -> nx.Graph:
    """Root 0 -> 1..10 (trunk), junction at 5 with a 3-long side branch 20..22."""
    g = nx.Graph()
    chain(g, list(range(0, 11)))
    chain(g, [5, 20, 21, 22])
    return g


def test_decompose_follows_longest_path_then_side_branch():
    paths = ec.decompose(y_tree(), root=0)
    assert paths[0] == (list(range(0, 11)), None)
    side, parent = paths[1]
    assert parent == 0 and side == [5, 20, 21, 22]  # starts at the junction on the trunk
    assert len(paths) == 2


def test_decompose_side_branch_can_have_sub_branches():
    g = y_tree()
    chain(g, [21, 30, 31])  # a 2-step sub-branch: longer than 21->22, so it continues the side path
    paths = ec.decompose(g, root=0)
    nodes = [p for p, _ in paths]
    assert nodes[0] == list(range(0, 11))
    assert nodes[1][:3] == [5, 20, 21] and nodes[1][-1] in (31, 22)
    assert paths[2][1] == 1  # the third path hangs off the side branch


def test_prune_spurs_removes_short_twigs_but_keeps_real_branches():
    g = y_tree()
    chain(g, [8, 40])  # 1-step spur off the trunk
    radius = np.full(100, 0.0)
    radius[8] = 1.0  # lumen radius 1 at the spur's junction -> spurs < 1.6 are noise
    radius[5] = 1.0
    pruned = ec.prune_spurs(g, root=0, local_radius=radius)
    assert 40 not in pruned  # spur length 1 < 1.6
    assert all(n in pruned for n in (20, 21, 22))  # side branch length 3 kept


def test_smooth_resample_has_uniform_spacing_and_keeps_endpoints():
    t = np.linspace(0, np.pi, 40)
    pts = np.column_stack([np.cos(t), np.sin(t), np.zeros_like(t)]) * 0.05
    out = ec.smooth_resample(pts, spacing=0.004)
    steps = np.linalg.norm(np.diff(out, axis=0), axis=1)
    assert steps.std() / steps.mean() < 0.05
    assert np.linalg.norm(out[0] - pts[0]) < 0.002 and np.linalg.norm(out[-1] - pts[-1]) < 0.002


def test_extract_vessel_on_a_straight_tube_recovers_axis_and_radius():
    radius = 1.0 * ec.MM
    length = 20.0 * ec.MM
    tube = trimesh.creation.cylinder(radius=radius, height=length, sections=48)
    parent = np.array([[0.0, 0.0, -length / 2 - 0.5 * ec.MM]])  # parent just below the -Z end
    segments, stats = ec.extract_vessel("tube", tube, parent, "aorta")
    assert stats["components"] == 1
    main = segments[0]
    assert main.attach == "aorta"
    # proximal -> distal: starts at the parent end (-Z) and runs towards +Z
    assert main.points[0][2] < main.points[-1][2]
    assert np.max(np.abs(main.points[:, :2])) < 0.3 * ec.MM  # on the tube axis
    assert np.median(main.radius) == pytest.approx(radius, rel=0.2)
    report = ec.validate(tube, segments, None)
    assert report["inside_fraction"] == 1.0
