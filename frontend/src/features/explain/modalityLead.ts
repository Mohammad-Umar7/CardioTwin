import { MINUS } from '@/lib/format';
import type { ModalityRow } from './attribution';
import type { ContributionUnit } from './explainPrefs';

const signed = (v: number, unit: ContributionUnit) => {
  const digits = unit === 'points' ? 0 : 2;
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(digits)}`;
};

/**
 * The lead modality in the columns' own printed numbers (`values`, parallel to `rows`: whole points or
 * log-odds to 2 decimals), so a reader can check it by adding the columns up. These are NET sums per
 * modality (each column nets its raising and lowering inputs), which the wording says, so it never reads
 * as the gross input-level totals under the lists:
 *   several columns on the lead's side  "Symptoms: +12 of the +27 net pts raising LAD"
 *   the lead is alone on its side       "Echocardiography carries the whole net rise: +53 pts on LAD"
 */
export function leadSentence(rows: readonly ModalityRow[], values: readonly number[], target: string, unit: ContributionUnit): string | null {
  const shown = rows.map((r, i) => ({ r, v: values[i] ?? 0 }));
  const lead = [...shown].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  if (!lead || lead.v === 0) return null;
  const up = lead.v > 0;
  const side = shown.filter((x) => (up ? x.v > 0 : x.v < 0));
  const total = side.reduce((acc, x) => acc + x.v, 0);
  const unitText = unit === 'points' ? 'pts' : 'log-odds';
  const name = lead.r.label.replace(/^Resting ECG$/, 'ECG');
  if (side.length === 1) {
    return `${name} carries the whole net ${up ? 'rise' : 'fall'}: ${signed(lead.v, unit)} ${unitText} on ${target}`;
  }
  return `${name}: ${signed(lead.v, unit)} of the ${signed(total, unit)} net ${unitText} ${up ? 'raising' : 'lowering'} ${target}`;
}
