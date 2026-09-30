import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEP,
  RADIUS_SCALE,
  buildFlowPaths,
  computeArcLengths,
  decodeW,
  encodeW,
  joinIndex,
  packCentrelines,
  resamplePolyline,
  samplePacked,
  type CentrelineFile,
  type Vec3,
} from './centreline';
import {
  SHARED_WEIGHT,
  TRUNK_BUILDUP,
  allocateParticles,
  apportion,
  densityAlong,
  mulberry32,
  particleShares,
  thinningFactors,
} from './particles';

const line = (from: Vec3, to: Vec3, n: number): Vec3[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t] as Vec3;
  });

/**
 * A miniature left tree: LM stem (0→0.1 on x) handing over to an "LAD" trunk (down −y, 1.0 long) with a
 * diagonal branching off its middle, and an "LCX" (along +x) attached at the LM tip; plus an ostial RCA.
 */
const TREE: CentrelineFile = {
  vessels: [
    { id: 'LM', node: 'N_LM', target: null, parent: 'aorta', segments: [{ points: line([0, 0, 0], [0.1, 0, 0], 11), attach: 'aorta' }] },
    {
      id: 'LAD',
      node: 'N_LAD',
      target: 'LAD',
      parent: 'LM',
      segments: [
        { points: line([0.1, 0, 0], [0.1, -1, 0], 101), attach: 'LM', radius: Array(101).fill(0.015) },
        { points: line([0.1, -0.5, 0], [0.4, -0.5, 0], 31), parent: 0 },
      ],
    },
    { id: 'LCX', node: 'N_LCX', target: 'LCX', parent: 'LM', segments: [{ points: line([0.1, 0, 0], [0.6, 0, 0], 51), attach: 'LM' }] },
    { id: 'RCA', node: 'N_RCA', target: 'RCA', parent: 'aorta', segments: [{ points: line([-0.2, 0, 0], [-0.2, -0.8, 0], 81), attach: 'aorta' }] },
  ],
};
const NODES = new Map([
  ['N_LM', 0],
  ['N_LAD', 1],
  ['N_LCX', 2],
  ['N_RCA', 3],
]);

describe('arc length from the ostium (same definition as the GLB _ARCLEN)', () => {
  const arc = computeArcLengths(TREE);

  it('starts every ostial trunk at 0 and grows monotonically along each segment', () => {
    expect(arc.segments[0]![0]!.s[0]).toBe(0);
    expect(arc.segments[3]![0]!.s[0]).toBe(0);
    for (const vessel of arc.segments)
      for (const seg of vessel) for (let i = 1; i < seg.s.length; i += 1) expect(seg.s[i]!).toBeGreaterThan(seg.s[i - 1]!);
  });

  it('starts a child at the arc length of its nearest parent point', () => {
    const lad = arc.segments[1]![0]!;
    expect(lad.s[0]).toBeCloseTo(0.1, 6); // LM tip
    const diagonal = arc.segments[1]![1]!;
    expect(diagonal.from).toEqual({ vessel: 1, segment: 0, index: 50 });
    expect(diagonal.s[0]).toBeCloseTo(0.1 + 0.5, 6);
    expect(arc.segments[2]![0]!.s[0]).toBeCloseTo(0.1, 6); // LCX on the LM tip
  });

  it('groups vessels into trees and normalises by the longest route of each tree', () => {
    expect(arc.treeOf).toEqual([0, 0, 0, 3]);
    expect(arc.treeLength.get(0)).toBeCloseTo(1.1, 6); // LM 0.1 + LAD 1.0
    expect(arc.treeLength.get(3)).toBeCloseTo(0.8, 6);
  });
});

describe('uniform arc-length resampling', () => {
  it('places sample j at exactly j·step along the polyline', () => {
    const bent: Vec3[] = [
      [0, 0, 0],
      [0.1, 0, 0],
      [0.1, 0.13, 0],
      [0.25, 0.13, 0.02],
    ];
    const step = 0.01;
    const { positions, count, source } = resamplePolyline(bent, step);
    expect(count).toBe(Math.floor((0.1 + 0.13 + Math.hypot(0.15, 0.02)) / step) + 1);
    // walk the polyline independently and compare
    for (let j = 0; j < count; j += 1) {
      const s = j * step;
      let acc = 0;
      for (let k = 0; k < bent.length - 1; k += 1) {
        const a = bent[k]!;
        const b = bent[k + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (s <= acc + len + 1e-12) {
          const f = (s - acc) / len;
          expect(positions[3 * j]).toBeCloseTo(a[0] + (b[0] - a[0]) * f, 5);
          expect(positions[3 * j + 1]).toBeCloseTo(a[1] + (b[1] - a[1]) * f, 5);
          expect(positions[3 * j + 2]).toBeCloseTo(a[2] + (b[2] - a[2]) * f, 5);
          // exactly on a vertex either adjacent edge is correct
          expect(f > 1 - 1e-9 ? [k, k + 1] : [k]).toContain(source[j]);
          break;
        }
        acc += len;
      }
    }
  });

  it('interpolates continuous attributes', () => {
    const { attributes } = resamplePolyline(line([0, 0, 0], [1, 0, 0], 2), 0.25, [[0, 1]]);
    expect(Array.from(attributes[0]!)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('branch joins', () => {
  const parent = line([0, 0, 0], [1, 0, 0], 11); // vertices every 0.1
  it('stops before the nearest vertex when the child starts behind it (no fold-back)', () => {
    expect(joinIndex(parent, 5, [0.47, 0.01, 0])).toBe(4);
  });
  it('keeps the nearest vertex when the child starts after it', () => {
    expect(joinIndex(parent, 5, [0.53, 0.01, 0])).toBe(5);
  });
  it('handles both ends of the parent', () => {
    expect(joinIndex(parent, 0, [0.01, 0.02, 0])).toBe(0);
    expect(joinIndex(parent, 10, [0.99, 0.02, 0])).toBe(9);
    expect(joinIndex(parent, 10, [1.02, 0.02, 0])).toBe(10);
  });
});

describe('flow paths', () => {
  const paths = buildFlowPaths(TREE, NODES, 0.01);

  it('creates one ostium-to-tip path per segment tip, skipping the LM stem that hands over', () => {
    const tips = paths.map((p) => `${TREE.vessels[p.vessel]!.id}:${p.segment}`).sort();
    expect(tips).toEqual(['LAD:0', 'LAD:1', 'LCX:0', 'RCA:0']);
  });

  it('routes a branch through its parents from the ostium, switching node ids on the way', () => {
    const diagonal = paths.find((p) => p.vessel === 1 && p.segment === 1)!;
    expect(diagonal.length).toBeCloseTo(0.1 + 0.5 + 0.3, 1);
    expect(diagonal.ownLength).toBeCloseTo(0.3, 1);
    expect(Array.from(diagonal.positions.slice(0, 3))).toEqual([0, 0, 0]); // starts at the LM ostium
    expect(diagonal.nodes[0]).toBe(0); // LM
    expect(diagonal.nodes[diagonal.nodes.length - 1]).toBe(1); // LAD node
    const tip = diagonal.positions.slice(-3);
    expect(tip[0]).toBeCloseTo(0.4, 1);
    expect(tip[1]).toBeCloseTo(-0.5, 5);
  });

  it('carries the tip vessel target and the tree', () => {
    const lcx = paths.find((p) => p.vessel === 2)!;
    expect(lcx.target).toBe('LCX');
    expect(lcx.tree).toBe(0);
    expect(paths.find((p) => p.vessel === 3)!.tree).toBe(3);
  });

  it('packs into a float texture that the CPU reference sampler reads back exactly', () => {
    const packed = packCentrelines(paths, 0.01, 64);
    expect(packed.width).toBe(64);
    expect(packed.height).toBe(Math.ceil(paths.reduce((n, p) => n + p.nodes.length, 0) / 64));
    const lad = paths.findIndex((p) => p.vessel === 1 && p.segment === 0);
    const mid = samplePacked(packed, lad, 0.1 + 0.5 + 0.005); // halfway between two texels
    expect(mid.position[0]).toBeCloseTo(0.1, 5);
    expect(mid.position[1]).toBeCloseTo(-0.505, 4);
    expect(mid.radius).toBeCloseTo(0.015, 4);
    expect(mid.node).toBe(1);
    const start = samplePacked(packed, lad, 0);
    expect(start.node).toBe(0);
  });
});

describe('texel packing', () => {
  it('round-trips node, thinning factor and radius through one float32', () => {
    for (const [node, keep, radius] of [
      [0, 1, 0.012],
      [15, 0, 0.0],
      [8, 0.37, 0.049],
      [3, 0.5, 0.02],
    ] as const) {
      const w = Math.fround(encodeW(node, keep, radius));
      const out = decodeW(w);
      expect(out.node).toBe(node);
      expect(out.keep).toBeCloseTo(Math.round(keep * 63) / 63, 6);
      expect(out.radius).toBeCloseTo(radius, 4);
    }
  });
});

describe('particle allocation', () => {
  it('apportions exactly the requested total', () => {
    expect(apportion([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10);
    expect(apportion([3, 1], 8)).toEqual([6, 2]);
    expect(apportion([0, 0], 5)).toEqual([0, 0]);
  });

  it('is deterministic and fills every attribute in range', () => {
    const paths = buildFlowPaths(TREE, NODES, 0.01);
    const packed = packCentrelines(paths, 0.01);
    const alloc = () =>
      allocateParticles(paths, packed, 300, () => 1.1, (t) => (t ? ['LAD', 'LCX', 'RCA'].indexOf(t) + 1 : 0));
    const a = alloc();
    const b = alloc();
    expect(a.count).toBe(300);
    expect(Array.from(a.seed)).toEqual(Array.from(b.seed));
    for (let i = 0; i < a.count; i += 1) {
      expect(a.seed[4 * i]).toBeGreaterThanOrEqual(0);
      expect(a.seed[4 * i]).toBeLessThan(1);
      expect(a.seed[4 * i + 1]).toBeGreaterThanOrEqual(0.85);
      expect(a.seed[4 * i + 1]).toBeLessThanOrEqual(1.15);
      expect(Math.abs(a.seed[4 * i + 2]!)).toBeLessThanOrEqual(1);
      expect([0, 1, 2, 3]).toContain(a.path[4 * i + 3]);
    }
  });

  it('mulberry32 is uniform enough', () => {
    const r = mulberry32(7);
    let mean = 0;
    for (let i = 0; i < 10000; i += 1) mean += r() / 10000;
    expect(mean).toBeCloseTo(0.5, 1);
  });
});

describe('published vessels.json', () => {
  const file = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/anatomy/vessels.json'), 'utf8'),
  ) as CentrelineFile & { spacing: number };
  const nodes = new Map(file.vessels.map((v, i) => [v.node, i]));
  const paths = buildFlowPaths(file, nodes, DEFAULT_STEP);
  const arc = computeArcLengths(file);

  it('has two trees rooted at the LM and RCA ostia', () => {
    const roots = new Set(arc.treeOf.map((i) => file.vessels[i]!.id));
    expect(roots).toEqual(new Set(['LM', 'RCA']));
  });

  it('builds a path for every segment tip except hand-overs, all starting at an ostium', () => {
    const segments = file.vessels.reduce((n, v) => n + v.segments.length, 0);
    expect(paths.length).toBeGreaterThan(segments * 0.8);
    expect(paths.length).toBeLessThanOrEqual(segments);
    expect(paths.some((p) => file.vessels[p.vessel]!.id === 'LM')).toBe(false);
    const lmStart = file.vessels.find((v) => v.id === 'LM')!.segments[0]!.points[0]!;
    const rcaStart = file.vessels.find((v) => v.id === 'RCA')!.segments[0]!.points[0]!;
    for (const p of paths) {
      const start = [p.positions[0]!, p.positions[1]!, p.positions[2]!];
      const ostium = arc.treeOf[p.vessel] === arc.treeOf[0] ? lmStart : rcaStart;
      expect(Math.hypot(start[0]! - ostium[0], start[1]! - ostium[1], start[2]! - ostium[2])).toBeLessThan(1e-5);
    }
  });

  it('keeps consecutive samples one step apart (arc-length parameterisation) without folds', () => {
    let samples = 0;
    let sharp = 0;
    for (const p of paths) {
      for (let j = 1; j < p.nodes.length; j += 1) {
        const d = Math.hypot(
          p.positions[3 * j]! - p.positions[3 * j - 3]!,
          p.positions[3 * j + 1]! - p.positions[3 * j - 2]!,
          p.positions[3 * j + 2]! - p.positions[3 * j - 1]!,
        );
        // chords of a curved polyline are never longer than the arc step…
        expect(d).toBeLessThanOrEqual(DEFAULT_STEP + 1e-6);
        // …and only a sharp real turn (a branch leaving at a steep angle) shortens one noticeably
        expect(d).toBeGreaterThan(DEFAULT_STEP * 0.3);
        samples += 1;
        if (d < DEFAULT_STEP * 0.9) sharp += 1;
      }
    }
    expect(sharp / samples).toBeLessThan(0.01);
  });

  it('normalised arc length stays within [0, 1] like the GLB attribute', () => {
    for (const p of paths) {
      const tree = arc.treeLength.get(p.tree)!;
      expect(p.length / tree).toBeLessThanOrEqual(1.01);
    }
    expect(Math.max(...paths.filter((p) => p.tree === arc.treeOf[0]).map((p) => p.length))).toBeCloseTo(
      arc.treeLength.get(arc.treeOf[0]!)!,
      1,
    );
  });

  it('packs radii within the encodable range and fits a small texture', () => {
    const packed = packCentrelines(paths, DEFAULT_STEP);
    for (const p of paths) for (const r of p.radii) expect(r).toBeLessThan(RADIUS_SCALE);
    expect(packed.width * packed.height).toBeLessThan(64 * 1024); // < 1 MB of RGBA32F
  });

  it('thins the overlapping proximal trunks down to a few times the branch density', () => {
    const shares = particleShares(paths, 4096);
    const keep = thinningFactors(paths, shares);
    const lad = paths.findIndex((p) => file.vessels[p.vessel]!.id === 'LAD' && p.segment === 0);
    const proximal = keep[lad]![20]!; // ≈ 16 mm from the LM ostium: every left-tree path passes here
    const distal = keep[lad]![keep[lad]!.length - 10]!;
    expect(proximal).toBeLessThan(0.35);
    expect(distal).toBeGreaterThan(proximal * 2);
    // a short side branch's own tip is barely thinned
    const branchTips = paths.map((p, i) => (p.ownLength < 0.15 ? keep[i]![keep[i]!.length - 1]! : 1));
    expect(Math.min(...branchTips)).toBeGreaterThan(0.6);
    for (const k of keep) {
      for (const v of k) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // effective density after thinning stays within TRUNK_BUILDUP (+ smoothing slack) of the target
    const effective = densityAlong(paths, shares, lad, 0.16) * proximal;
    const own = paths.map((p, i) => shares[i]! / p.length).sort((a, b) => a - b);
    expect(effective / own[Math.floor(own.length / 2)]!).toBeLessThan(TRUNK_BUILDUP * 1.6);
  });

  it('allocation keeps the proximal trunk build-up readable (≤ 8× the distal density)', () => {
    const shares = apportion(
      paths.map((p) => p.ownLength + SHARED_WEIGHT * p.length),
      2048,
    );
    const lad = paths.findIndex((p) => file.vessels[p.vessel]!.id === 'LAD' && p.segment === 0);
    const proximal = densityAlong(paths, shares, lad, 0.12);
    const distal = densityAlong(paths, shares, lad, paths[lad]!.length - 0.05);
    expect(distal).toBeGreaterThan(0);
    expect(proximal / distal).toBeGreaterThan(1);
    expect(proximal / distal).toBeLessThan(8);
  });
});
