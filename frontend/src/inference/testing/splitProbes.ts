/**
 * Test-only generator of adversarial inputs for the XGBoost split comparisons.
 *
 * For every distinct (column, float32 threshold) of every tree it finds a split node, solves the
 * ancestors' routing constraints for an input that REACHES that node (within the schema range, using
 * the other features only), then probes the node's own feature exactly where float32 routing is
 * fragile: the threshold, its float32 neighbours, the float32 rounding midpoint (a tie, resolved to
 * even) and its float64 neighbours, and the shortest decimal a user would type (CR 0.8 is
 * 0.800000011920929 in float32 and sits exactly on a CR split).
 *
 * The expected branch of each probe comes from an oracle that never calls `Math.fround`: it compares the
 * probe with the rounding midpoint and applies ties-to-even on the float32 bit pattern.
 */
import type { FeatureSchema, FeatureSpec, FeatureVector, TargetId } from '@/types/contracts';
import type { EncodingSpec, PortableModelSpec, XGBoostNodeSpec } from '../types';

// ------------------------------------------------------------------------------ float bits

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Adjacent float32 of a positive float32-exact `x` (dir +1 = up). */
export function float32Step(x: number, dir: 1 | -1): number {
  if (!(x > 0)) throw new RangeError('float32Step expects a positive value');
  f32[0] = x;
  u32[0] = u32[0]! + dir;
  return f32[0]!;
}

/** Adjacent float64 of a positive `x` (dir +1 = up). */
export function float64Step(x: number, dir: 1 | -1): number {
  if (!(x > 0)) throw new RangeError('float64Step expects a positive value');
  f64[0] = x;
  u64[0] = u64[0]! + BigInt(dir);
  return f64[0]!;
}

/** True when the float32 `x` has an even significand (the winner of a ties-to-even rounding). */
function evenFloat32(x: number): boolean {
  f32[0] = x;
  return (u32[0]! & 1) === 0;
}

/** Shortest decimal that rounds to the float32 `t` (what a user types: 0.8 for 0.800000011920929). */
export function shortestDecimal32(t: number): number {
  for (let p = 1; p <= 9; p++) {
    const d = Number(t.toPrecision(p));
    if (Math.fround(d) === t) return d;
  }
  return t;
}

export type ProbeKind =
  | 'threshold'
  | 'float32-below'
  | 'float32-above'
  | 'tie-below'
  | 'tie-below−ulp'
  | 'tie-below+ulp'
  | 'tie-above'
  | 'threshold−ulp'
  | 'threshold+ulp'
  | 'decimal'
  | 'decimal−ulp'
  | 'decimal+ulp'
  | 'category';

export interface Probe {
  kind: ProbeKind;
  /** Raw value sent for the feature. */
  value: number | string;
  /** Oracle: the node must route this probe to its `yes` child (`x < threshold` in float32). */
  expectYes: boolean;
}

/**
 * Oracle for a positive float32 threshold `t` and a float64 `v`: float32(v) < t ⇔ v rounds below t ⇔
 * v < midpoint(prev32(t), t), or v is exactly that midpoint and prev32(t) is the even one.
 */
export function expectYesAt(t: number, v: number): boolean {
  const below = float32Step(t, -1);
  const mid = (below + t) / 2; // exact in float64
  return v < mid || (v === mid && evenFloat32(below));
}

/** The fragile float64 inputs around a positive float32 threshold `t`, with their oracle branch. */
export function numericProbes(t: number, kinds?: ReadonlySet<ProbeKind>): Probe[] {
  const below = float32Step(t, -1);
  const above = float32Step(t, 1);
  const tieBelow = (below + t) / 2;
  const tieAbove = (t + above) / 2;
  const decimal = shortestDecimal32(t);
  const all: [ProbeKind, number][] = [
    ['threshold', t],
    ['float32-below', below],
    ['float32-above', above],
    ['tie-below', tieBelow],
    ['tie-below−ulp', float64Step(tieBelow, -1)],
    ['tie-below+ulp', float64Step(tieBelow, 1)],
    ['tie-above', tieAbove],
    ['threshold−ulp', float64Step(t, -1)],
    ['threshold+ulp', float64Step(t, 1)],
    ['decimal', decimal],
    ['decimal−ulp', float64Step(decimal, -1)],
    ['decimal+ulp', float64Step(decimal, 1)],
  ];
  const seen = new Set<number>();
  const out: Probe[] = [];
  for (const [kind, value] of all) {
    if (kinds && !kinds.has(kind)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ kind, value, expectYes: expectYesAt(t, value) });
  }
  return out;
}

// ------------------------------------------------------------------------------ split sites

export interface PathStep {
  column: number;
  /** float32-exact threshold. */
  threshold: number;
  yes: boolean;
}

export interface SplitSite {
  target: TargetId;
  component: number;
  tree: number;
  nodeid: number;
  column: number;
  threshold: number;
  /** Ancestor decisions from the root to this node. */
  path: PathStep[];
  /** Node ids in the yes / no subtrees (children included). */
  yesSubtree: Set<number>;
  noSubtree: Set<number>;
}

function subtreeIds(node: XGBoostNodeSpec): Set<number> {
  const ids = new Set<number>();
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    ids.add(n.nodeid);
    for (const c of n.children ?? []) stack.push(c);
  }
  return ids;
}

/** Every internal node of every XGBoost tree, with its ancestor path (depth-first, shallow first per tree). */
export function collectSplitSites(spec: PortableModelSpec): SplitSite[] {
  const sites: SplitSite[] = [];
  for (const target of spec.targets) {
    spec.models[target]!.components.forEach((comp, component) => {
      if (comp.type !== 'xgboost') return;
      comp.trees.forEach((root, tree) => {
        const queue: [XGBoostNodeSpec, PathStep[]][] = [[root, []]];
        while (queue.length > 0) {
          const [node, path] = queue.shift()!;
          if (node.leaf !== undefined) continue;
          const children = new Map((node.children ?? []).map((c) => [c.nodeid, c]));
          const yes = children.get(node.yes!)!;
          const no = children.get(node.no!)!;
          const threshold = Math.fround(node.split_condition!);
          sites.push({
            target,
            component,
            tree,
            nodeid: node.nodeid,
            column: node.split_index!,
            threshold,
            path,
            yesSubtree: subtreeIds(yes),
            noSubtree: subtreeIds(no),
          });
          queue.push([yes, [...path, { column: node.split_index!, threshold, yes: true }]]);
          queue.push([no, [...path, { column: node.split_index!, threshold, yes: false }]]);
        }
      });
    });
  }
  return sites;
}

// ------------------------------------------------------------------------------ constraint solving

interface RawFeature {
  encoding: EncodingSpec;
  columns: number[];
  spec: FeatureSpec;
}

/** Encoded column values of one raw value (`columns` order). */
function encodeRaw(enc: EncodingSpec, value: number | string): number[] {
  switch (enc.kind) {
    case 'numeric':
    case 'binary':
      return [Number(value)];
    case 'ordinal':
      return [enc.map[String(value)]!];
    case 'onehot':
      return enc.categories.map((c) => (c === value ? 1 : 0));
  }
}

function satisfies(enc: EncodingSpec, columns: number[], value: number | string, steps: PathStep[]): boolean {
  const encoded = encodeRaw(enc, value);
  return steps.every((s) => {
    const i = columns.indexOf(s.column);
    return i < 0 || (Math.fround(encoded[i]!) < s.threshold) === s.yes;
  });
}

export class SplitProbeBuilder {
  private readonly raw: RawFeature[];
  private readonly byColumn = new Map<number, RawFeature>();

  constructor(model: PortableModelSpec, schema: FeatureSchema) {
    const specs = new Map(schema.features.map((f) => [f.key, f]));
    const index = new Map(model.columns.map((c, i) => [c, i]));
    this.raw = model.encoding.map((enc) => {
      const names = enc.kind === 'onehot' ? enc.columns : [enc.column];
      const columns = names.map((n) => index.get(n)!);
      const spec = specs.get(enc.feature);
      if (!spec) throw new Error(`schema.json has no feature ${enc.feature}`);
      return { encoding: enc, columns, spec };
    });
    for (const r of this.raw) for (const c of r.columns) this.byColumn.set(c, r);
  }

  /** Raw feature that owns an encoded column. */
  featureOf(column: number): RawFeature {
    const r = this.byColumn.get(column);
    if (!r) throw new Error(`column ${column} is derived, not a raw input`);
    return r;
  }

  /** In-range candidate raw values of a feature that could satisfy `steps`. */
  private candidates(r: RawFeature, steps: PathStep[]): (number | string)[] {
    const { spec, encoding } = r;
    if (encoding.kind === 'binary') return [0, 1];
    if (encoding.kind === 'ordinal') return Object.keys(encoding.map);
    if (encoding.kind === 'onehot') return [...encoding.categories];
    const lo = spec.min ?? -Infinity;
    const hi = spec.max ?? Infinity;
    const out: number[] = [];
    if (typeof spec.default === 'number') out.push(spec.default);
    if (Number.isFinite(lo)) out.push(lo);
    if (Number.isFinite(hi)) out.push(hi);
    for (const s of steps) {
      out.push(s.threshold);
      if (s.threshold > 0) out.push(float32Step(s.threshold, -1));
    }
    return out.filter((v) => v >= lo && v <= hi);
  }

  /**
   * An input reaching `site` (its ancestors' constraints satisfied by features other than `probed`),
   * plus the ancestors' constraints on `probed` itself. Null when unreachable within the schema range.
   */
  reach(site: SplitSite): { base: FeatureVector; own: PathStep[] } | null {
    const probed = this.featureOf(site.column);
    const byFeature = new Map<RawFeature, PathStep[]>();
    for (const step of site.path) {
      const r = this.featureOf(step.column);
      byFeature.set(r, [...(byFeature.get(r) ?? []), step]);
    }
    const base: FeatureVector = {};
    for (const [r, steps] of byFeature) {
      if (r === probed) continue;
      const value = this.candidates(r, steps).find((v) => satisfies(r.encoding, r.columns, v, steps));
      if (value === undefined) return null;
      base[r.spec.key] = value;
    }
    return { base, own: byFeature.get(probed) ?? [] };
  }

  /** Probes of the node's own feature that still reach the node (ancestor constraints on it hold). */
  probes(site: SplitSite, own: PathStep[], kinds?: ReadonlySet<ProbeKind>): Probe[] {
    const r = this.featureOf(site.column);
    const { spec, encoding, columns } = r;
    let probes: Probe[];
    if (encoding.kind === 'numeric') {
      probes = site.threshold > 0 ? numericProbes(site.threshold, kinds) : [];
      probes = probes.filter((p) => (p.value as number) >= (spec.min ?? -Infinity) && (p.value as number) <= (spec.max ?? Infinity));
    } else {
      // Discrete encodings: every value, oracle = exact comparison of the (small integer) code.
      const at = columns.indexOf(site.column);
      probes = this.candidates(r, []).map((value) => ({
        kind: 'category' as const,
        value,
        expectYes: encodeRaw(encoding, value)[at]! < site.threshold,
      }));
    }
    return probes.filter((p) => satisfies(encoding, columns, p.value, own));
  }

  /**
   * One reachable site per distinct (column, threshold), shallowest first, with its base input and
   * probes. `sites` must come from `collectSplitSites` on the same model.
   */
  distinctThresholdCases(
    sites: readonly SplitSite[],
    kinds?: ReadonlySet<ProbeKind>,
  ): { site: SplitSite; feature: string; base: FeatureVector; probes: Probe[] }[] {
    const ordered = [...sites].sort((a, b) => a.path.length - b.path.length);
    const done = new Set<string>();
    const out: { site: SplitSite; feature: string; base: FeatureVector; probes: Probe[] }[] = [];
    for (const site of ordered) {
      const key = `${site.column}:${site.threshold}`;
      if (done.has(key)) continue;
      const reached = this.reach(site);
      if (!reached) continue;
      const probes = this.probes(site, reached.own, kinds);
      // A useful case reaches the node on both sides of the split.
      if (!probes.some((p) => p.expectYes) || !probes.some((p) => !p.expectYes)) continue;
      done.add(key);
      out.push({ site, feature: this.featureOf(site.column).spec.key, base: reached.base, probes });
    }
    return out;
  }

  /** Distinct (column, threshold) pairs in the model, for coverage reporting. */
  static distinctThresholds(sites: readonly SplitSite[]): number {
    return new Set(sites.map((s) => `${s.column}:${s.threshold}`)).size;
  }
}
