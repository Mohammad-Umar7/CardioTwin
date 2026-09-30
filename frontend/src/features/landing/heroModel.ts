/**
 * Live micro-visual data for the landing (WORKSTATION_V2 §6.1): everything is derived from the hero
 * patient's current prediction, so the pillars always describe the heart on screen. No numbers are
 * invented: missing predictions yield empty lists and the UI shows skeletons.
 */
import { sortedContributions } from '@/lib/explain';
import type { FeatureSpec, PredictResponse, TargetId } from '@/types/contracts';

export interface DriverMark {
  key: string;
  /** Human label from the schema (never the raw dataset key). */
  label: string;
  direction: 'up' | 'down';
  /** |shap| as a share of the largest shown |shap|, 0–1. */
  share: number;
  /** Mini-bar length in 3 steps by share (V2 §5.5 direction mark). */
  steps: 1 | 2 | 3;
}

/** 3-step length from a share of the largest contribution. */
export const stepsForShare = (share: number): 1 | 2 | 3 => (share >= 0.66 ? 3 : share >= 0.33 ? 2 : 1);

/**
 * The `n` largest contributions for `target`, as direction marks. Ties keep the engine's order.
 * Negligible contributions (|shap| < 0.02) are dropped: they carry no direction worth drawing.
 */
export function topDrivers(
  prediction: PredictResponse | null | undefined,
  byKey: ReadonlyMap<string, FeatureSpec> | null | undefined,
  target: TargetId = 'CAD',
  n = 3,
): DriverMark[] {
  const contributions = sortedContributions(prediction?.explanations[target]).filter((c) => Math.abs(c.shap) >= 0.02);
  const top = contributions.slice(0, n);
  const max = Math.max(...top.map((c) => Math.abs(c.shap)), 1e-9);
  return top.map((c) => {
    const share = Math.abs(c.shap) / max;
    return {
      key: c.feature,
      label: byKey?.get(c.feature)?.label ?? c.feature,
      direction: c.shap >= 0 ? 'up' : 'down',
      share,
      steps: stepsForShare(share),
    };
  });
}

export interface VesselMark {
  id: TargetId;
  p: number | null;
  flagged: boolean | null;
}

/** One mark per vessel target in the given order. */
export function vesselMarks(prediction: PredictResponse | null | undefined, vessels: readonly TargetId[]): VesselMark[] {
  return vessels.map((id) => {
    const t = prediction?.predictions[id];
    return { id, p: t ? t.probability : null, flagged: t ? t.label === 1 : null };
  });
}

/** Vessel with the highest probability (for the Map pillar deep link), or null. */
export function highestRiskVessel(prediction: PredictResponse | null | undefined, vessels: readonly TargetId[]): TargetId | null {
  let best: TargetId | null = null;
  let bestP = -1;
  for (const id of vessels) {
    const p = prediction?.predictions[id]?.probability;
    if (typeof p === 'number' && p > bestP) {
      best = id;
      bestP = p;
    }
  }
  return best ?? prediction?.summary.highest_risk_vessel ?? null;
}

/** "k of 3 flagged", counting the contract `label` fields (V2 §3.2). */
export function flaggedCount(prediction: PredictResponse | null | undefined, vessels: readonly TargetId[]): number | null {
  if (!prediction) return null;
  return vessels.reduce((k, id) => k + (prediction.predictions[id]?.label === 1 ? 1 : 0), 0);
}
