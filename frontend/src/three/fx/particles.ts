/**
 * Particle allocation over flow paths (pure; unit tested in centreline.test.ts).
 *
 * Every particle belongs to one ostium-to-tip path and loops along it; its distance at time t is
 *     d = (offset · L + D_target(t) · jitter) mod L
 * where D_target is the integrated flow distance of the path's target (advanced on the CPU from the
 * cardiac waveform, see cardiacCycle.ts) and L the path length. Paths overlap near the ostia, so the
 * proximal trunks carry the particles of every branch downstream — denser where more flow passes,
 * like the real tree. Weighting the share of each path by its OWN (unshared) length plus a fraction of
 * its total length keeps that proximal build-up within a readable range (see the density test).
 */
import type { FlowPath } from './centreline';

/** Share weight = ownLength + SHARED_WEIGHT · length. */
export const SHARED_WEIGHT = 0.04;

/** Per-instance attributes, 4 floats each (matching the shader's aPath / aSeed). */
export interface ParticleAttributes {
  count: number;
  /** start texel, texel count, tree length (normalises arc length), target slot. */
  path: Float32Array;
  /** offset ∈ [0,1), speed jitter ∈ [0.85, 1.15], lateral ∈ [−1, 1], keep ∈ [0, 1). */
  seed: Float32Array;
}

/** Deterministic PRNG (mulberry32) so the same tree always gets the same particle layout. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largest-remainder apportionment of `total` items by `weights` (sums exactly to total). */
export function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k]![1]]! += 1;
  return out;
}

/**
 * Allocate `total` particles over `paths`. `start`/`count` locate each path in the packed texture,
 * `treeLength(tree)` gives the arc-length normaliser and `slotOf(target)` the uniform slot of a target.
 * Offsets are stratified along each path (evenly spaced + jitter) so particles never start clumped.
 */
export function allocateParticles(
  paths: readonly FlowPath[],
  packed: { start: ArrayLike<number>; count: ArrayLike<number> },
  total: number,
  treeLength: (tree: number) => number,
  slotOf: (target: string | null) => number,
  seed = 0xc0ffee,
): ParticleAttributes {
  const shares = apportion(
    paths.map((p) => p.ownLength + SHARED_WEIGHT * p.length),
    total,
  );
  const random = mulberry32(seed);
  const path = new Float32Array(total * 4);
  const seedAttr = new Float32Array(total * 4);
  let n = 0;
  paths.forEach((p, i) => {
    const k = shares[i]!;
    for (let j = 0; j < k; j += 1, n += 1) {
      path[4 * n] = packed.start[i]!;
      path[4 * n + 1] = packed.count[i]!;
      path[4 * n + 2] = Math.max(1e-6, treeLength(p.tree));
      path[4 * n + 3] = slotOf(p.target);
      seedAttr[4 * n] = (j + random()) / k;
      seedAttr[4 * n + 1] = 0.85 + 0.3 * random();
      seedAttr[4 * n + 2] = random() * 2 - 1;
      seedAttr[4 * n + 3] = random();
    }
  });
  return { count: n, path, seed: seedAttr };
}

/**
 * Expected particle count per unit length at arc-length position `s` of path `probe`
 * (Σ over paths passing through that point of share/length). Used by tests and tuning only.
 */
export function densityAlong(paths: readonly FlowPath[], shares: readonly number[], probe: number, s: number): number {
  const at = paths[probe]!;
  const j = Math.round(s / (at.length / Math.max(1, at.nodes.length - 1)));
  const x = at.positions[3 * j]!;
  const y = at.positions[3 * j + 1]!;
  const z = at.positions[3 * j + 2]!;
  let density = 0;
  paths.forEach((p, i) => {
    // does p pass through this point? (same sample within half a step)
    const step = p.length / Math.max(1, p.nodes.length - 1);
    const k = Math.round(s / step);
    if (k >= p.nodes.length) return;
    const d = Math.hypot(p.positions[3 * k]! - x, p.positions[3 * k + 1]! - y, p.positions[3 * k + 2]! - z);
    if (d < step * 0.5) density += shares[i]! / Math.max(1e-6, p.length);
  });
  return density;
}
