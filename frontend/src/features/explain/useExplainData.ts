import { useMemo } from 'react';
import { usePortableModel, useSchemaIndex, type SchemaIndex } from '@/hooks/useData';
import { formatShap, MINUS } from '@/lib/format';
import { useRiskView } from '@/features/risk/useRiskView';
import type { TargetId, TargetPrediction } from '@/types/contracts';
import { pointsScale, toPoints, type ExplanationV11, type PointsScale } from './attribution';
import { useExplainPrefs, type ContributionUnit } from './explainPrefs';

export interface ExplainData {
  target: TargetId;
  index: SchemaIndex | null;
  p: TargetPrediction | undefined;
  explanation: ExplanationV11 | undefined;
  scale: PointsScale | null;
  /** The unit actually shown: points fall back to log-odds when the typical probability is unknown. */
  unit: ContributionUnit;
  stale: boolean;
}

/** One read of everything a drawer tab needs for `target` (the displayed prediction: compare-aware). */
export function useExplainData(target: TargetId): ExplainData {
  const index = useSchemaIndex();
  const view = useRiskView();
  const model = usePortableModel();
  const prefs = useExplainPrefs();
  const p = view.prediction?.predictions[target];
  const explanation = view.prediction?.explanations[target] as ExplanationV11 | undefined;
  const calibration = model.data?.models[target]?.calibration;
  const scale = useMemo(() => pointsScale(explanation, p?.probability, calibration), [explanation, p, calibration]);
  return {
    target,
    index,
    p,
    explanation,
    scale,
    unit: prefs.unit === 'points' && scale ? 'points' : 'logodds',
    stale: view.stale,
  };
}

export interface FormattedContribution {
  /** "+10", "−4", "<1" (points) or "+1.26" / "−0.52" (log-odds). */
  text: string;
  /** Screen-reader words: "plus 10 points", "minus 0.52 log-odds". */
  spoken: string;
}

/** A contribution in the chosen unit. Points are integers (no false precision); below half a point, "<1". */
export function formatContribution(shap: number, unit: ContributionUnit, scale: PointsScale | null): FormattedContribution {
  const pts = unit === 'points' ? toPoints(shap, scale) : null;
  if (pts === null) {
    return { text: formatShap(shap), spoken: `${shap >= 0 ? 'plus' : 'minus'} ${Math.abs(shap).toFixed(2)} log-odds` };
  }
  const r = Math.round(pts);
  if (r === 0) return { text: pts === 0 ? '0' : '<1', spoken: 'less than 1 point' };
  return { text: `${r > 0 ? '+' : MINUS}${Math.abs(r)}`, spoken: `${r > 0 ? 'plus' : 'minus'} ${Math.abs(r)} ${Math.abs(r) === 1 ? 'point' : 'points'}` };
}

export const unitLabel = (unit: ContributionUnit): string => (unit === 'points' ? 'pts' : 'log-odds');
