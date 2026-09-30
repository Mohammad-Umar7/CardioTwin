/**
 * Coronary centrelines → flow paths → one GPU texture (pure; unit tested in centreline.test.ts).
 *
 * Input is `vessels.json` (anatomy/README "Coronary centrelines"): per vessel node, segments of points
 * ordered proximal → distal in the scene rest frame, with lumen radius; a segment either starts on its
 * parent segment (`parent` = index in the same vessel) or on another vessel (`attach` = vessel id, or
 * "aorta" for the two ostial trunks).
 *
 * 1. ARC LENGTH from the tree's ostium, computed exactly like `anatomy/scripts/optimize_glb.mjs` writes
 *    the GLB's `_ARCLEN` (child start = arc length of the nearest parent point), normalised per tree
 *    (left tree from the LM ostium, right tree from the RCA ostium), so particles, the pulse overlay and
 *    the mesh attribute all share one coordinate.
 * 2. FLOW PATHS: one root-to-tip route per segment tip — the chain of parent pieces from the ostium to
 *    the branch point, then the segment itself. Segments whose tip hands over to a child (the LM stem
 *    ends where the LAD and LCX begin) do not end a path. Every point remembers its vessel node, so a
 *    particle crossing from the LM (anterior wall) into the LCX (posterior wall) follows each node's own
 *    transform when the heart is exploded.
 * 3. RESAMPLING at a uniform arc-length step h, so texel j of a path sits at exactly j·h from the ostium
 *    and the vertex shader can address a particle at distance d with one division.
 * 4. PACKING into an RGBA32F texture: xyz = rest-frame position, w = node index + radius / RADIUS_SCALE.
 */

export type Vec3 = readonly [number, number, number];

export interface CentrelineSegment {
  points: readonly Vec3[];
  radius?: readonly number[];
  /** Parent segment index within the same vessel (null/absent = starts on `attach`). */
  parent?: number | null;
  /** Vessel id this segment starts on ("aorta" = an ostium). */
  attach?: string | null;
}

export interface CentrelineVessel {
  id: string;
  target?: string | null;
  node: string;
  /** Parent vessel id ("aorta" for ostial trunks). */
  parent?: string | null;
  segments: readonly CentrelineSegment[];
}

export interface CentrelineFile {
  vessels: readonly CentrelineVessel[];
  spacing?: number;
}

/** Radius is packed into the fractional part of w: radius = fract(w) · RADIUS_SCALE (max 5 mm). */
export const RADIUS_SCALE = 0.05;
/** Default resampling step: 0.8 mm, the spacing the centreline stage already uses. */
export const DEFAULT_STEP = 0.008;
/** Texture width (texels); height grows with the total path length. */
export const TEXTURE_WIDTH = 512;
/** Fallback lumen radius when a file carries none (1.2 mm). */
const DEFAULT_RADIUS = 0.012;
/** A child starting within this many points of its parent's tip continues the parent's flow. */
const HANDOVER_POINTS = 2;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function nearestIndex(points: readonly Vec3[], p: Vec3): number {
  let best = Infinity;
  let index = 0;
  for (let i = 0; i < points.length; i += 1) {
    const d = (points[i]![0] - p[0]) ** 2 + (points[i]![1] - p[1]) ** 2 + (points[i]![2] - p[2]) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return index;
}

/** Where a segment starts on its parent: which vessel/segment, and the point index there. */
export interface BranchPoint {
  vessel: number;
  segment: number;
  index: number;
}

export interface SegmentInfo {
  vessel: number;
  segment: number;
  /** Absolute arc length (scene units) from the tree's ostium, per point. */
  s: Float64Array;
  /** Start on the parent, or null for an ostial segment. */
  from: BranchPoint | null;
}

export interface ArcLengthResult {
  /** [vessel][segment] */
  segments: SegmentInfo[][];
  /** Root vessel index per vessel (the tree it belongs to). */
  treeOf: number[];
  /** Longest arc length per root vessel index (normalisation constant of `_ARCLEN`). */
  treeLength: Map<number, number>;
}

/**
 * Arc length of every centreline point from its tree's ostium. Mirrors optimize_glb.mjs: a segment's
 * first point takes the arc length of the nearest point of its parent (segment or vessel), then
 * accumulates Euclidean distances.
 */
export function computeArcLengths(file: CentrelineFile): ArcLengthResult {
  const vessels = file.vessels;
  const byId = new Map(vessels.map((v, i) => [v.id, i]));
  const segments: SegmentInfo[][] = vessels.map(() => []);
  const done = new Set<number>();
  const treeOf: number[] = vessels.map(() => -1);
  const rootOf = (i: number, guard = 0): number => {
    const parent = vessels[i]!.parent;
    const p = parent && parent !== 'aorta' ? byId.get(parent) : undefined;
    return p === undefined || guard > vessels.length ? i : rootOf(p, guard + 1);
  };

  const visit = (vi: number, guard = 0) => {
    if (done.has(vi) || guard > vessels.length) return;
    const v = vessels[vi]!;
    const parentId = v.parent && v.parent !== 'aorta' ? byId.get(v.parent) : undefined;
    if (parentId !== undefined) visit(parentId, guard + 1);
    for (const seg of v.segments) {
      const n = seg.points.length;
      const s = new Float64Array(n);
      let from: BranchPoint | null = null;
      if (seg.parent !== null && seg.parent !== undefined && segments[vi]![seg.parent]) {
        const parentSeg = v.segments[seg.parent]!;
        const index = nearestIndex(parentSeg.points, seg.points[0]!);
        from = { vessel: vi, segment: seg.parent, index };
        s[0] = segments[vi]![seg.parent]!.s[index]!;
      } else if (seg.attach && seg.attach !== 'aorta' && byId.has(seg.attach)) {
        const pv = byId.get(seg.attach)!;
        visit(pv, guard + 1);
        // nearest point over all segments of the attached vessel
        let best = Infinity;
        for (let k = 0; k < vessels[pv]!.segments.length; k += 1) {
          const pts = vessels[pv]!.segments[k]!.points;
          const index = nearestIndex(pts, seg.points[0]!);
          const d = dist(pts[index]!, seg.points[0]!);
          if (d < best) {
            best = d;
            from = { vessel: pv, segment: k, index };
          }
        }
        if (from) s[0] = segments[pv]![from.segment]!.s[from.index]!;
      }
      for (let i = 1; i < n; i += 1) s[i] = s[i - 1]! + dist(seg.points[i - 1]!, seg.points[i]!);
      segments[vi]!.push({ vessel: vi, segment: segments[vi]!.length, s, from });
    }
    done.add(vi);
  };
  vessels.forEach((_, i) => visit(i));

  const treeLength = new Map<number, number>();
  vessels.forEach((_, i) => {
    const root = rootOf(i);
    treeOf[i] = root;
    for (const seg of segments[i]!) for (const x of seg.s) treeLength.set(root, Math.max(treeLength.get(root) ?? 0, x));
  });
  return { segments, treeOf, treeLength };
}

/** One contiguous piece of a path: points [from, to] (inclusive) of a vessel segment. */
interface Piece {
  vessel: number;
  segment: number;
  from: number;
  to: number;
}

export interface FlowPath {
  /** Vessel/segment whose tip ends this path. */
  vessel: number;
  segment: number;
  /** Target of the tip's vessel (e.g. "LAD"), null when not predicted. */
  target: string | null;
  /** Root vessel index (tree). */
  tree: number;
  /** Length (scene units) of the resampled path. */
  length: number;
  /** Length of the part not shared with the parent chain (the tip segment itself). */
  ownLength: number;
  /** Resampled points (rest frame), node index and radius per sample; sample j is at j·step. */
  positions: Float32Array;
  nodes: Uint8Array;
  radii: Float32Array;
}

/** Squared distance from p to segment ab and the projection parameter t ∈ [0, 1]. */
function projectOnSegment(a: Vec3, b: Vec3, p: Vec3): { d2: number; t: number } {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]! + (p[2] - a[2]) * ab[2]!) / len2)) : 0;
  const q = [a[0] + ab[0]! * t, a[1] + ab[1]! * t, a[2] + ab[2]! * t];
  return { d2: (p[0] - q[0]!) ** 2 + (p[1] - q[1]!) ** 2 + (p[2] - q[2]!) ** 2, t };
}

/**
 * Last parent point to keep before jumping to a child whose first point is `p` and whose nearest parent
 * vertex is k: if p projects onto the parent edge (k−1, k) rather than (k, k+1), p lies BEFORE vertex k
 * and keeping k would make the path fold back on itself at the branch, so stop at k−1.
 */
export function joinIndex(parent: readonly Vec3[], k: number, p: Vec3): number {
  if (k <= 0) return 0;
  const before = projectOnSegment(parent[k - 1]!, parent[k]!, p);
  const after = k + 1 < parent.length ? projectOnSegment(parent[k]!, parent[k + 1]!, p) : null;
  const liesBefore = before.t < 1 && (!after || after.t <= 0 || before.d2 <= after.d2);
  return liesBefore ? k - 1 : k;
}

/** Build the ostium-to-tip piece chain for a segment. */
function chain(file: CentrelineFile, arc: ArcLengthResult, vi: number, si: number, upTo: number, guard = 0): Piece[] {
  const info = arc.segments[vi]![si]!;
  const own: Piece = { vessel: vi, segment: si, from: 0, to: upTo };
  if (!info.from || guard > 64) return [own];
  const parentPoints = file.vessels[info.from.vessel]!.segments[info.from.segment]!.points;
  const firstPoint = file.vessels[vi]!.segments[si]!.points[0]!;
  const end = joinIndex(parentPoints, info.from.index, firstPoint);
  return [...chain(file, arc, info.from.vessel, info.from.segment, end, guard + 1), own];
}

/**
 * Resample a polyline at a uniform arc-length step (the last partial step is dropped). Continuous
 * attributes are interpolated; `source[j]` is the index of the input point at or before sample j, for
 * discrete per-point data such as node ids.
 */
export function resamplePolyline(
  points: readonly Vec3[],
  step: number,
  attributes: readonly (readonly number[])[] = [],
): { positions: Float32Array; attributes: Float32Array[]; source: Uint32Array; count: number } {
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i += 1) cumulative[i] = cumulative[i - 1]! + dist(points[i - 1]!, points[i]!);
  const total = cumulative[points.length - 1] ?? 0;
  const count = Math.max(1, Math.floor(total / step + 1e-9) + 1);
  const positions = new Float32Array(count * 3);
  const out = attributes.map(() => new Float32Array(count));
  const source = new Uint32Array(count);
  let k = 0;
  for (let j = 0; j < count; j += 1) {
    const target = j * step;
    while (k < points.length - 2 && cumulative[k + 1]! <= target) k += 1;
    const span = points.length < 2 ? 0 : cumulative[k + 1]! - cumulative[k]!;
    const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (target - cumulative[k]!) / span));
    const a = points[k]!;
    const b = points[Math.min(k + 1, points.length - 1)]!;
    positions[3 * j] = a[0] + (b[0] - a[0]) * f;
    positions[3 * j + 1] = a[1] + (b[1] - a[1]) * f;
    positions[3 * j + 2] = a[2] + (b[2] - a[2]) * f;
    source[j] = k;
    attributes.forEach((attr, n) => {
      const x = attr[k] ?? 0;
      const y = attr[Math.min(k + 1, points.length - 1)] ?? x;
      out[n]![j] = x + (y - x) * f;
    });
  }
  return { positions, attributes: out, source, count };
}

/**
 * All flow paths of the coronary tree, resampled at `step`. `nodeIndex` maps a vessel node name to the
 * index used for its transform in the shader.
 */
export function buildFlowPaths(file: CentrelineFile, nodeIndex: ReadonlyMap<string, number>, step = DEFAULT_STEP): FlowPath[] {
  const arc = computeArcLengths(file);
  // Which segment tips hand their flow over to a child?
  const handover = new Set<string>();
  arc.segments.forEach((segs) =>
    segs.forEach((info) => {
      if (!info.from) return;
      const parentLen = file.vessels[info.from.vessel]!.segments[info.from.segment]!.points.length;
      if (info.from.index >= parentLen - 1 - HANDOVER_POINTS) handover.add(`${info.from.vessel}:${info.from.segment}`);
    }),
  );

  const paths: FlowPath[] = [];
  file.vessels.forEach((vessel, vi) => {
    vessel.segments.forEach((segment, si) => {
      if (handover.has(`${vi}:${si}`) || segment.points.length < 2) return;
      const pieces = chain(file, arc, vi, si, segment.points.length - 1);
      const points: Vec3[] = [];
      const radii: number[] = [];
      const nodes: number[] = [];
      for (const piece of pieces) {
        const v = file.vessels[piece.vessel]!;
        const seg = v.segments[piece.segment]!;
        const node = nodeIndex.get(v.node) ?? 0;
        for (let i = piece.from; i <= piece.to; i += 1) {
          points.push(seg.points[i]!);
          radii.push(seg.radius?.[i] ?? DEFAULT_RADIUS);
          nodes.push(node);
        }
      }
      const { positions, attributes, source, count } = resamplePolyline(points, step, [radii]);
      // Node ids are discrete: each sample takes the node of the input point at or before it.
      const sampleNodes = Uint8Array.from(source, (k) => nodes[k]!);
      let ownStart = 0;
      for (let i = 1; i <= points.length - segment.points.length; i += 1) ownStart += dist(points[i - 1]!, points[i]!);
      const length = (count - 1) * step;
      paths.push({
        vessel: vi,
        segment: si,
        target: vessel.target ?? null,
        tree: arc.treeOf[vi]!,
        length,
        ownLength: Math.max(0, length - ownStart),
        positions,
        nodes: sampleNodes,
        radii: attributes[0]!,
      });
    });
  });
  return paths;
}

export interface PackedCentrelines {
  /** RGBA32F texel data, TEXTURE_WIDTH × height. */
  data: Float32Array;
  width: number;
  height: number;
  step: number;
  /** First texel and texel count per path (same order as `paths`). */
  start: Uint32Array;
  count: Uint32Array;
}

/** Pack resampled paths into one float texture. */
export function packCentrelines(paths: readonly FlowPath[], step: number, width = TEXTURE_WIDTH): PackedCentrelines {
  const total = paths.reduce((n, p) => n + p.nodes.length, 0);
  const height = Math.max(1, Math.ceil(total / width));
  const data = new Float32Array(width * height * 4);
  const start = new Uint32Array(paths.length);
  const count = new Uint32Array(paths.length);
  let texel = 0;
  paths.forEach((path, i) => {
    start[i] = texel;
    count[i] = path.nodes.length;
    for (let j = 0; j < path.nodes.length; j += 1, texel += 1) {
      data[4 * texel] = path.positions[3 * j]!;
      data[4 * texel + 1] = path.positions[3 * j + 1]!;
      data[4 * texel + 2] = path.positions[3 * j + 2]!;
      data[4 * texel + 3] = path.nodes[j]! + Math.min(0.999, Math.max(0, path.radii[j]! / RADIUS_SCALE));
    }
  });
  return { data, width, height, step, start, count };
}

/**
 * CPU reference of the vertex shader's lookup: position (rest frame), radius and node at distance `d`
 * along path `i`. Used by tests to prove the GPU addressing, and handy for debugging.
 */
export function samplePacked(packed: PackedCentrelines, i: number, d: number): { position: Vec3; radius: number; node: number } {
  const n = packed.count[i]!;
  const length = (n - 1) * packed.step;
  const x = Math.min(Math.max(d, 0), length) / packed.step;
  const i0 = Math.min(Math.floor(x), n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  const f = x - i0;
  const t0 = packed.start[i]! + i0;
  const t1 = packed.start[i]! + i1;
  const at = (t: number, c: number) => packed.data[4 * t + c]!;
  const lerp = (c: number) => at(t0, c) + (at(t1, c) - at(t0, c)) * f;
  const w0 = at(t0, 3);
  const w1 = at(t1, 3);
  const r0 = (w0 - Math.floor(w0)) * RADIUS_SCALE;
  const r1 = (w1 - Math.floor(w1)) * RADIUS_SCALE;
  return { position: [lerp(0), lerp(1), lerp(2)], radius: r0 + (r1 - r0) * f, node: Math.floor(f < 0.5 ? w0 : w1) };
}
