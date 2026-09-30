import { MINUS } from '@/lib/format';
import { toPoints, type ModalityRow, type PointsScale } from './attribution';
import type { ContributionUnit } from './explainPrefs';

/** A column's value exactly as printed under it: whole points, or log-odds to 2 decimals. */
export function shownValue(sum: number, unit: ContributionUnit, scale: PointsScale | null): number {
  const pts = unit === 'points' ? toPoints(sum, scale) : null;
  return pts === null ? Number(sum.toFixed(2)) : Math.round(pts);
}

const signed = (v: number, unit: ContributionUnit, scale: PointsScale | null) => {
  const digits = unit === 'points' && scale ? 0 : 2;
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(digits)}`;
};

/**
 * The lead modality in the columns' own printed numbers, so a reader can check it by adding them up:
 * "Symptoms: +12 of the +27 pts raising LAD" (the +27 is the sum of the positive columns).
 */
export function leadSentence(rows: readonly ModalityRow[], target: string, unit: ContributionUnit, scale: PointsScale | null): string | null {
  const shown = rows.map((r) => ({ r, v: shownValue(r.sum, unit, scale) }));
  const lead = [...shown].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  if (!lead || lead.v === 0) return null;
  const up = lead.v > 0;
  const total = shown.filter((x) => (up ? x.v > 0 : x.v < 0)).reduce((acc, x) => acc + x.v, 0);
  const unitText = unit === 'points' && scale ? 'pts' : 'log-odds';
  const name = lead.r.label.replace(/^Resting ECG$/, 'ECG');
  return `${name}: ${signed(lead.v, unit, scale)} of the ${signed(total, unit, scale)} ${unitText} ${up ? 'raising' : 'lowering'} ${target}`;
}

