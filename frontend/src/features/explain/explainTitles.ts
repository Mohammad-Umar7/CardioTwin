/**
 * Takeaway titles of the Explain drawer tabs (WORKSTATION_V2 §5.10): each title states the finding.
 * Only the Why title carries a probability (it is P(target)'s fallback home while the drawer covers the
 * Risk card); the others speak in counts and points.
 */
import { formatProbability, formatShownDeltaPts, rangeStatus } from '@/lib/format';
import type { FeatureSpec, FeatureVector, PredictResponse, TargetId } from '@/types/contracts';

/**
 * Drawer title on the What-if tab (§5.10): "2 changes lowered CAD by 7 points". No probability. The points
 * are the difference between the two DISPLAYED values (the same formatter as the Risk card's "was" line and
 * the What-if table), so when an end is capped (≥95 %, ≤5 %) the title says "by ≥4 points" like they do.
 */
export function whatIfTitle(target: TargetId, edits: number, recorded: PredictResponse | null, current: PredictResponse | null): string {
  if (edits === 0) return 'No changes yet: pull a lever below';
  const a = recorded?.predictions[target]?.probability;
  const b = current?.predictions[target]?.probability;
  const changes = `${edits} ${edits === 1 ? 'change' : 'changes'}`;
  if (typeof a !== 'number' || typeof b !== 'number') return `${changes} to the recorded inputs`;
  const d = formatShownDeltaPts(a, b);
  if (d.direction === 'none') {
    const ca = formatProbability(a);
    const cb = formatProbability(b);
    // Both ends beyond the same display cap: the estimate moved, but not within what the card can show.
    if (ca.capped && cb.capped) return `${changes} left ${target} ${b >= 0.5 ? 'at the top' : 'at the bottom'} of the shown range`;
    return `${changes} left ${target} unchanged`;
  }
  const n = Number(d.text.replace(/[^\d]/g, ''));
  const bound = d.text.startsWith('≥') ? '≥' : '';
  return `${changes} ${d.direction === 'down' ? 'lowered' : 'raised'} ${target} by ${bound}${n} ${n === 1 ? 'point' : 'points'}`;
}

/** Numeric inputs outside their reference range (the Physiology tab's count). */
export function outsideRange(features: FeatureVector, specs: readonly FeatureSpec[]): FeatureSpec[] {
  return specs.filter((s) => {
    if (s.type !== 'numeric') return false;
    const status = rangeStatus(features[s.key] as number, s.normal);
    return status === 'above' || status === 'below';
  });
}

/** "5 values outside the normal range" / "1 value …" / "All values within the normal range". */
export function physiologyTitle(n: number): string {
  if (n === 0) return 'All measured values within the normal range';
  return `${n} ${n === 1 ? 'value' : 'values'} outside the normal range`;
}
