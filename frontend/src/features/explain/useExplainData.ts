import { useMemo } from 'react';
import { usePortableModel, useSchemaIndex, type SchemaIndex } from '@/hooks/useData';
import { formatShap, MINUS } from '@/lib/format';
import { useRiskView } from '@/features/risk/useRiskView';
import type { TargetId, TargetPrediction } from '@/types/contracts';
import { pointsScale, roundContributions, toPoints, type ExplanationV11, type PointsScale, type RoundedContributions } from './attribution';
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
  /** Every contribution as printed (largest-remainder rounded, so printed totals equal their printed parts). */
  rounded: RoundedContributions;
  /** One input's contribution as printed in `unit` (default: the shown unit). */
  fmt(feature: string, shap: number, unit?: ContributionUnit): FormattedContribution;
  /** The printed total of some inputs (the sum of their printed values), with its display quanta. */
  total(features: readonly { feature: string; shap: number }[], unit?: ContributionUnit): FormattedContribution & { q: number };
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
  const rounded = useMemo(() => roundContributions(explanation, scale), [explanation, scale]);
  const unit: ContributionUnit = prefs.unit === 'points' && scale ? 'points' : 'logodds';
  return {
    target,
    index,
    p,
    explanation,
    scale,
    unit,
    stale: view.stale,
    rounded,
    fmt: (feature, shap, u = unit) => {
      const q = quantaOf(rounded, u, feature);
      return q === null ? formatContribution(shap, u, scale) : formatQuanta(q, shap, u);
    },
    total: (list, u = unit) => {
      const raw = list.reduce((a, c) => a + c.shap, 0);
      const qs = list.map((c) => quantaOf(rounded, u, c.feature));
      if (qs.some((q) => q === null)) {
        const f = formatContribution(raw, u, scale);
        return { ...f, q: shownQuanta(raw, u, scale) };
      }
      const q = qs.reduce<number>((a, v) => a + (v ?? 0), 0);
      return { ...formatQuanta(q, raw, u), q };
    },
  };
}

/** Printed quanta of one input in `unit` (null when it is not in the rounded set, e.g. no points scale). */
function quantaOf(r: RoundedContributions, unit: ContributionUnit, feature: string): number | null {
  const map = unit === 'points' ? r.points : r.logodds;
  return map?.get(feature) ?? null;
}

/** Quanta of a raw value rounded on its own: whole points, or hundredths of log-odds. */
function shownQuanta(shap: number, unit: ContributionUnit, scale: PointsScale | null): number {
  const pts = unit === 'points' ? toPoints(shap, scale) : null;
  return pts === null ? Math.round(shap * 100) : Math.round(pts);
}

/**
 * A printed contribution from its display quanta: whole points ("+10", "−4", "<1" for a nonzero input that
 * rounds to 0) or hundredths of log-odds ("+1.26").
 */
export function formatQuanta(q: number, raw: number, unit: ContributionUnit): FormattedContribution {
  if (unit === 'logodds') {
    const v = q / 100;
    return { text: formatShap(v), spoken: `${v >= 0 ? 'plus' : 'minus'} ${Math.abs(v).toFixed(2)} log-odds` };
  }
  if (q === 0) return { text: raw === 0 ? '0' : '<1', spoken: 'less than 1 point' };
  const n = Math.abs(q);
  return { text: `${q > 0 ? '+' : MINUS}${n}`, spoken: `${q > 0 ? 'plus' : 'minus'} ${n} ${n === 1 ? 'point' : 'points'}` };
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
