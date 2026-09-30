/**
 * Float32 split routing, attacked node by node: for every distinct (column, threshold) of every XGBoost
 * tree an input is built that reaches that split, and the split's feature is set exactly on, beside and
 * between the float32 values around the threshold (including rounding ties and the decimal a user types).
 * The branch the engine takes must match an oracle that decides "x < threshold in float32" from the
 * float32 midpoint and ties-to-even alone — without calling `Math.fround`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeatureSchema } from '@/types/contracts';
import schemaRaw from '../../public/model/schema.json?raw';
import { EdgeModel } from './model';
import { loadModelSpec } from './testing/artifacts';
import {
  SplitProbeBuilder,
  collectSplitSites,
  expectYesAt,
  float32Step,
  float64Step,
  numericProbes,
  shortestDecimal32,
  type SplitSite,
} from './testing/splitProbes';
import type { PortableModelSpec, XGBoostComponentSpec } from './types';
import { compileXGBoost, leafSlot, toFloat32Row, type CompiledXGBoost } from './xgboost';

let spec: PortableModelSpec;
let model: EdgeModel;
let sites: SplitSite[];
let builder: SplitProbeBuilder;
const compiled = new Map<string, CompiledXGBoost>();

beforeAll(() => {
  spec = loadModelSpec();
  model = new EdgeModel(loadModelSpec());
  sites = collectSplitSites(spec);
  builder = new SplitProbeBuilder(spec, JSON.parse(schemaRaw) as FeatureSchema);
});

function component(site: SplitSite): CompiledXGBoost {
  const key = `${site.target}/${site.component}`;
  let c = compiled.get(key);
  if (!c) {
    c = compileXGBoost(spec.models[site.target]!.components[site.component] as XGBoostComponentSpec, spec.columns.length);
    compiled.set(key, c);
  }
  return c;
}

describe('float32 oracle', () => {
  it('knows the float32 facts the probes rely on', () => {
    // CR 0.8 is stored as float32 0.800000011920929; 0.8 in float64 is below it, yet routes "no".
    const t = Math.fround(0.8);
    expect(t).toBe(0.800000011920929);
    expect(0.8 < t).toBe(true);
    expect(expectYesAt(t, 0.8)).toBe(false);
    expect(shortestDecimal32(t)).toBe(0.8);
    expect(shortestDecimal32(Math.fround(11.9))).toBe(11.9);
    // Neighbours and ties.
    const below = float32Step(t, -1);
    expect(Math.fround(below)).toBe(below);
    expect(below).toBeLessThan(t);
    expect(float64Step(t, 1)).toBeGreaterThan(t);
    const tie = (below + t) / 2;
    expect(Math.fround(tie) === t).toBe(!expectYesAt(t, tie));
  });

  it('agrees with Math.fround on every generated probe (self-check of the oracle)', () => {
    let checked = 0;
    for (const t of [Math.fround(0.8), Math.fround(4.1), Math.fround(11.9), 45, 5300, Math.fround(23.30109405517578), 1, 2]) {
      for (const p of numericProbes(t)) {
        expect(Math.fround(p.value as number) < t, `${p.kind} ${p.value}`).toBe(p.expectYes);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('has teeth: a float64 comparison, `<=`, or truncation to float32 would each misroute some probes', () => {
    const cases = builder.distinctThresholdCases(sites);
    const probes = cases.flatMap(({ site, probes: list }) => list.map((p) => ({ t: site.threshold, p })));
    const truncate32 = (v: number) => {
      const r = Math.fround(v);
      return r > v ? float32Step(r, -1) : r; // round toward zero (positive values)
    };
    const numeric = probes.filter(({ p }) => typeof p.value === 'number' && p.kind !== 'category');
    const wrong = (route: (v: number, t: number) => boolean) =>
      numeric.filter(({ t, p }) => route(p.value as number, t) !== p.expectYes).length;
    expect(wrong((v, t) => v < t)).toBeGreaterThan(100);
    expect(wrong((v, t) => Math.fround(v) <= t)).toBeGreaterThan(100);
    expect(wrong((v, t) => truncate32(v) < t)).toBeGreaterThan(100);
    expect(wrong((v, t) => Math.fround(v) < t)).toBe(0);
  });
});

describe('XGBoost routing at every split threshold', () => {
  it('reaches a node for (almost) every distinct threshold and routes every probe as the oracle says', () => {
    const cases = builder.distinctThresholdCases(sites);
    const distinct = SplitProbeBuilder.distinctThresholds(sites);
    let probes = 0;
    let ties = 0;
    const failures: string[] = [];
    for (const { site, feature, base, probes: list } of cases) {
      const c = component(site);
      for (const probe of list) {
        const { x } = model.encode({ ...base, [feature]: probe.value });
        const leaf = c.nodeId[leafSlot(c, site.tree, toFloat32Row(x))]!;
        const expected = probe.expectYes ? site.yesSubtree : site.noSubtree;
        if (!expected.has(leaf)) {
          const reached = site.yesSubtree.has(leaf) || site.noSubtree.has(leaf);
          failures.push(
            `${site.target} tree ${site.tree} node ${site.nodeid} ${feature} < ${site.threshold}: ${probe.kind} ${String(probe.value)} ` +
              (reached ? `went ${probe.expectYes ? 'no' : 'yes'}` : 'did not reach the node'),
          );
        }
        probes += 1;
        if (probe.kind === 'tie-below') ties += 1;
      }
    }
    console.info(`[split routing] ${cases.length} / ${distinct} distinct thresholds reached, ${probes} probes (${ties} float32 ties)`);
    expect(failures.slice(0, 10)).toEqual([]);
    // Every threshold inside the schema range is reachable except a handful whose paths need
    // mutually exclusive inputs; losing more than that means the builder (or the model) changed.
    expect(cases.length).toBeGreaterThanOrEqual(distinct - 10);
    expect(ties).toBeGreaterThan(300);
  });

  it('computes the same margin as walking the reference routing for every probe (full model)', () => {
    // The margin of the compiled, flattened trees must equal a direct walk of the nested JSON dump.
    const cases = builder.distinctThresholdCases(sites);
    let checked = 0;
    for (const { site, feature, base, probes } of cases.filter((_, i) => i % 7 === 0)) {
      for (const probe of probes) {
        const input = { ...base, [feature]: probe.value };
        const { x } = model.encode(input);
        const comp = spec.models[site.target]!.components[site.component] as XGBoostComponentSpec;
        let expected = Math.log(comp.base_score / (1 - comp.base_score));
        for (const root of comp.trees) {
          let node = root;
          while (node.leaf === undefined) {
            const v = x[node.split_index!]!;
            const yes = Math.fround(v) < Math.fround(node.split_condition!);
            const next = yes ? node.yes : node.no;
            node = node.children!.find((ch) => ch.nodeid === next)!;
          }
          expected += node.leaf;
        }
        const c = component(site);
        let margin = c.baseMargin;
        const x32 = toFloat32Row(x);
        for (let t = 0; t < c.nTrees; t++) margin += c.leaf[leafSlot(c, t, x32)]!;
        expect(margin).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
