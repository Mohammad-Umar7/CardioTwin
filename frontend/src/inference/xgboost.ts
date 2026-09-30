/**
 * XGBoost component — port of `portable.xgboost_margin` / `portable.xgboost_shap`.
 *
 * Trees are flattened once into typed arrays (struct-of-arrays, one slot per node, all trees of a
 * component back to back), so a prediction allocates nothing but its output vectors.
 *
 *   routing   fround(x[split]) < fround(split_condition) → yes, otherwise no; NaN → missing
 *   margin    logit(base_score) + Σ_trees leaf                       (float64, trees in order)
 *   SHAP      exact path-dependent TreeSHAP (Lundberg et al. 2018, Algorithm 2) weighted by `cover`
 *
 * The TreeSHAP recursion keeps the reference's arithmetic order operation by operation; only the
 * storage differs (a preallocated path buffer, as in the SHAP C++ implementation, instead of copied
 * Python lists), so results agree with `portable.py` to the last few ulps.
 */
import { ModelFormatError } from './errors';
import { fround, logit } from './numeric';
import type { XGBoostComponentSpec, XGBoostNodeSpec } from './types';

export interface CompiledXGBoost {
  readonly type: 'xgboost';
  readonly name: string;
  readonly weight: number;
  readonly baseValue: number;
  /** `logit(base_score)`. */
  readonly baseMargin: number;
  readonly nTrees: number;
  /** Slot of each tree's root. */
  readonly roots: Int32Array;
  /** Split column per slot; −1 marks a leaf. */
  readonly feature: Int32Array;
  /** `fround(split_condition)` per slot. */
  readonly threshold: Float64Array;
  readonly yes: Int32Array;
  readonly no: Int32Array;
  /** 1 when the missing branch is the yes branch. */
  readonly missingYes: Uint8Array;
  readonly cover: Float64Array;
  readonly leaf: Float64Array;
  /** Deepest leaf depth (root = 0), sizes the TreeSHAP path buffer. */
  readonly maxDepth: number;
}

function flattenTree(root: XGBoostNodeSpec, where: string): Map<number, XGBoostNodeSpec> {
  const nodes = new Map<number, XGBoostNodeSpec>();
  const stack: XGBoostNodeSpec[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (nodes.has(node.nodeid)) throw new ModelFormatError(`${where}: duplicate nodeid ${node.nodeid}`);
    nodes.set(node.nodeid, node);
    for (const child of node.children ?? []) stack.push(child);
  }
  return nodes;
}

export function compileXGBoost(spec: XGBoostComponentSpec, nColumns: number): CompiledXGBoost {
  if (!(spec.base_score > 0 && spec.base_score < 1)) {
    throw new ModelFormatError(`xgboost component '${spec.name}': base_score must be a probability in (0, 1)`);
  }
  const perTree = spec.trees.map((tree, t) => flattenTree(tree, `xgboost '${spec.name}' tree ${t}`));
  const total = perTree.reduce((n, nodes) => n + nodes.size, 0);
  const roots = new Int32Array(spec.trees.length);
  const feature = new Int32Array(total);
  const threshold = new Float64Array(total);
  const yes = new Int32Array(total);
  const no = new Int32Array(total);
  const missingYes = new Uint8Array(total);
  const cover = new Float64Array(total);
  const leaf = new Float64Array(total);
  let maxDepth = 0;

  let offset = 0;
  perTree.forEach((nodes, t) => {
    const where = `xgboost '${spec.name}' tree ${t}`;
    // Dense slots in nodeid order; the root must be nodeid 0 (XGBoost convention).
    const ids = [...nodes.keys()].sort((a, b) => a - b);
    const slotOf = new Map<number, number>(ids.map((id, i) => [id, offset + i]));
    if (!nodes.has(0)) throw new ModelFormatError(`${where}: missing root node 0`);
    roots[t] = slotOf.get(0)!;
    const slot = (id: number | undefined, field: string, owner: number) => {
      const s = id === undefined ? undefined : slotOf.get(id);
      if (s === undefined) throw new ModelFormatError(`${where}: node ${owner} has no valid '${field}' child`);
      return s;
    };
    for (const id of ids) {
      const node = nodes.get(id)!;
      const s = slotOf.get(id)!;
      if (typeof node.cover !== 'number') throw new ModelFormatError(`${where}: node ${id} has no cover`);
      cover[s] = node.cover;
      if (node.leaf !== undefined) {
        feature[s] = -1;
        leaf[s] = node.leaf;
        continue;
      }
      const split = node.split_index;
      if (split === undefined || split < 0 || split >= nColumns || !Number.isInteger(split)) {
        throw new ModelFormatError(`${where}: node ${id} has an invalid split_index`);
      }
      if (typeof node.split_condition !== 'number') throw new ModelFormatError(`${where}: node ${id} has no split_condition`);
      feature[s] = split;
      threshold[s] = fround(node.split_condition);
      yes[s] = slot(node.yes, 'yes', id);
      no[s] = slot(node.no, 'no', id);
      slot(node.missing, 'missing', id);
      missingYes[s] = node.missing === node.yes ? 1 : 0;
    }
    // Depth of the deepest leaf (iterative walk from the root).
    const walk: [number, number][] = [[roots[t], 0]];
    let visited = 0;
    while (walk.length > 0) {
      const [s, depth] = walk.pop()!;
      if (++visited > nodes.size) throw new ModelFormatError(`${where}: nodes do not form a tree`);
      if (feature[s] === -1) maxDepth = Math.max(maxDepth, depth);
      else walk.push([yes[s], depth + 1], [no[s], depth + 1]);
    }
    offset += nodes.size;
  });

  return {
    type: 'xgboost',
    name: spec.name,
    weight: spec.weight,
    baseValue: spec.base_value,
    baseMargin: logit(spec.base_score),
    nTrees: spec.trees.length,
    roots,
    feature,
    threshold,
    yes,
    no,
    missingYes,
    cover,
    leaf,
    maxDepth,
  };
}

/** Routing of one internal node for an input whose values were already `fround`ed (`x32`). */
function goesYes(c: CompiledXGBoost, s: number, x32: Float64Array): boolean {
  const v = x32[c.feature[s]];
  if (v !== v) return c.missingYes[s] === 1;
  return v < c.threshold[s];
}

/** Float32 view of the encoded row used for every split comparison (NaN stays NaN). */
export function toFloat32Row(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let j = 0; j < x.length; j++) out[j] = fround(x[j]);
  return out;
}

export function xgboostMargin(c: CompiledXGBoost, x32: Float64Array): number {
  let m = c.baseMargin;
  const { roots, feature, threshold, yes, no, missingYes, leaf } = c;
  for (let t = 0; t < roots.length; t++) {
    let s = roots[t];
    let f = feature[s];
    while (f !== -1) {
      // Inlined goesYes(): hot loop of every prediction and ICE sample.
      const v = x32[f];
      s = (v !== v ? missingYes[s] === 1 : v < threshold[s]) ? yes[s] : no[s];
      f = feature[s];
    }
    m += leaf[s];
  }
  return m;
}

// ---------------------------------------------------------------------------------- TreeSHAP

/**
 * Reusable scratch space for TreeSHAP: path elements `[feature, zero_fraction, one_fraction, weight]`
 * stored as parallel arrays. Every recursion level owns the segment right after its parent's.
 */
export class TreeShapWorkspace {
  feature: Int32Array;
  zero: Float64Array;
  one: Float64Array;
  weight: Float64Array;

  constructor(maxDepth: number) {
    const size = ((maxDepth + 2) * (maxDepth + 3)) / 2;
    this.feature = new Int32Array(size);
    this.zero = new Float64Array(size);
    this.one = new Float64Array(size);
    this.weight = new Float64Array(size);
  }

  get capacity(): number {
    return this.weight.length;
  }
}

/**
 * `_extend_path`: copy the parent's `len` elements from `from` to `to`, then append
 * `(feature, zero, one)` and update the permutation weights. Returns the new length.
 */
function extendPath(w: TreeShapWorkspace, from: number, to: number, len: number, zero: number, one: number, feature: number): number {
  const pf = w.feature;
  const pz = w.zero;
  const po = w.one;
  const pw = w.weight;
  for (let i = 0; i < len; i++) {
    pf[to + i] = pf[from + i];
    pz[to + i] = pz[from + i];
    po[to + i] = po[from + i];
    pw[to + i] = pw[from + i];
  }
  const depth = len;
  pf[to + depth] = feature;
  pz[to + depth] = zero;
  po[to + depth] = one;
  pw[to + depth] = depth === 0 ? 1.0 : 0.0;
  for (let i = depth - 1; i >= 0; i--) {
    pw[to + i + 1] = pw[to + i + 1] + (one * pw[to + i] * (i + 1)) / (depth + 1);
    pw[to + i] = (zero * pw[to + i] * (depth - i)) / (depth + 1);
  }
  return len + 1;
}

/** `_unwind_path`: remove element `index` from the path at `at` (length `len`) in place. */
function unwindPath(w: TreeShapWorkspace, at: number, len: number, index: number): void {
  const pf = w.feature;
  const pz = w.zero;
  const po = w.one;
  const pw = w.weight;
  const depth = len - 1;
  const one = po[at + index];
  const zero = pz[at + index];
  let nextOne = pw[at + depth];
  for (let i = depth - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = pw[at + i];
      pw[at + i] = (nextOne * (depth + 1)) / ((i + 1) * one);
      nextOne = tmp - (pw[at + i] * zero * (depth - i)) / (depth + 1);
    } else {
      pw[at + i] = (pw[at + i] * (depth + 1)) / (zero * (depth - i));
    }
  }
  for (let i = index; i < depth; i++) {
    pf[at + i] = pf[at + i + 1];
    pz[at + i] = pz[at + i + 1];
    po[at + i] = po[at + i + 1];
  }
}

/** `_unwound_path_sum`: total permutation weight of the path with element `index` removed. */
function unwoundPathSum(w: TreeShapWorkspace, at: number, len: number, index: number): number {
  const pw = w.weight;
  const depth = len - 1;
  const one = w.one[at + index];
  const zero = w.zero[at + index];
  let nextOne = pw[at + depth];
  let total = 0.0;
  if (one !== 0) {
    for (let i = depth - 1; i >= 0; i--) {
      const tmp = nextOne / ((i + 1) * one);
      total += tmp;
      nextOne = pw[at + i] - tmp * zero * (depth - i);
    }
  } else {
    for (let i = depth - 1; i >= 0; i--) total += pw[at + i] / (zero * (depth - i));
  }
  return total * (depth + 1);
}

/**
 * `_tree_shap_recurse`. `parentAt`/`parentLen` locate the caller's path; this level writes its own
 * path at `parentAt + parentLen`.
 */
function recurse(
  c: CompiledXGBoost,
  x32: Float64Array,
  phi: Float64Array,
  w: TreeShapWorkspace,
  s: number,
  parentAt: number,
  parentLen: number,
  zero: number,
  one: number,
  feature: number,
): void {
  const at = parentAt + parentLen;
  let len = extendPath(w, parentAt, at, parentLen, zero, one, feature);
  const split = c.feature[s];
  if (split === -1) {
    const value = c.leaf[s];
    for (let i = 1; i < len; i++) {
      const f = w.feature[at + i];
      phi[f] = phi[f] + unwoundPathSum(w, at, len, i) * (w.one[at + i] - w.zero[at + i]) * value;
    }
    return;
  }
  let incomingZero = 1.0;
  let incomingOne = 1.0;
  for (let k = 1; k < len; k++) {
    if (w.feature[at + k] === split) {
      // Feature already on the path: undo that split first.
      incomingZero = w.zero[at + k];
      incomingOne = w.one[at + k];
      unwindPath(w, at, len, k);
      len -= 1;
      break;
    }
  }
  const yes = c.yes[s];
  const no = c.no[s];
  const hotYes = goesYes(c, s, x32);
  const cover = c.cover[s];
  recurse(c, x32, phi, w, yes, at, len, (incomingZero * c.cover[yes]) / cover, hotYes ? incomingOne : 0.0, split);
  recurse(c, x32, phi, w, no, at, len, (incomingZero * c.cover[no]) / cover, hotYes ? 0.0 : incomingOne, split);
}

/**
 * Exact path-dependent TreeSHAP of the whole component: `phi` (length = number of columns) receives
 * Σ_trees φ in tree order, as `portable.xgboost_shap` returns it. `phi` must be zeroed by the caller.
 */
export function xgboostShap(c: CompiledXGBoost, x32: Float64Array, phi: Float64Array, workspace?: TreeShapWorkspace): void {
  const w = workspace && workspace.capacity >= ((c.maxDepth + 2) * (c.maxDepth + 3)) / 2 ? workspace : new TreeShapWorkspace(c.maxDepth);
  for (let t = 0; t < c.roots.length; t++) recurse(c, x32, phi, w, c.roots[t], 0, 0, 1.0, 1.0, -1);
}
