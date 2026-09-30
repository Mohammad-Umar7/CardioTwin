/**
 * Takeaway titles of the Explain drawer tabs (WORKSTATION_V2 §5.10): each title states the finding.
 * Only the Why title carries a probability (it is P(target)'s fallback home while the drawer covers the
 * Risk card); the others speak in counts and points.
 */
import { rangeStatus } from '@/lib/format';
import type { FeatureSpec, FeatureVector, PredictResponse, TargetId } from '@/types/contracts';

/** Drawer title on the What-if tab (§5.10): "2 changes lowered CAD by 7 points". No probability. */
export function whatIfTitle(target: TargetId, edits: number, recorded: PredictResponse | null, current: PredictResponse | null): string {
  if (edits === 0) return 'No changes yet: pull a lever below';
  const a = recorded?.predictions[target]?.probability;
  const b = current?.predictions[target]?.probability;
  const changes = `${edits} ${edits === 1 ? 'change' : 'changes'}`;
  if (typeof a !== 'number' || typeof b !== 'number') return `${changes} to the recorded inputs`;
  const pts = Math.round((b - a) * 100);
  if (pts === 0) return `${changes} left ${target} unchanged`;
  return `${changes} ${pts < 0 ? 'lowered' : 'raised'} ${target} by ${Math.abs(pts)} ${Math.abs(pts) === 1 ? 'point' : 'points'}`;
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
