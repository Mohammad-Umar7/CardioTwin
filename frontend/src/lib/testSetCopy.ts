/**
 * One phrasing for the history of the held-out test split, used on every page that mentions it (landing
 * protocol line and Validate pillar, Methodology, Model performance, the disclaimer and the guided demo).
 *
 * The truth, from `metrics.json › protocol.test_set_history`: the split was locked before development and
 * scored once for release 1.0.0, then re-scored once for 1.1.0 after an independent review found a
 * calibration defect; no feature, model family, search space or selection rule changed in response. So
 * "scored once" is never claimed for the test split (it stays literally true only for the Monte-Carlo
 * re-splits, each scored once).
 */

/** Re-scores of the locked test split, as disclosed in metrics.json (history length − 1). */
export const TEST_SET_RESCORES = 1;

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Protocol checklist item (Model performance), from the history length when the report has it. */
export function testSetRescoreItem(rescores: number = TEST_SET_RESCORES): string {
  return `Test set re-scored ${times(rescores)} after an independent review found a calibration defect; disclosed, no model choice changed`;
}

/** The disclosure itself, as one sentence for prose. */
const RESCORE =
  'It was re-scored once after an independent review found a calibration defect; the re-score is disclosed and changed no model choice.';

export const TEST_SET = {
  /** Check-mark item on the landing protocol line. */
  check: 'Locked test, 1 disclosed re-score',
  /** Its tooltip. */
  hint: `The held-out split was locked before development and scored only after every modelling decision was frozen. ${RESCORE}`,
  /** Stat sub-line (Methodology). */
  stat: 'locked · 1 disclosed re-score',
  /** Validate pillar sentence (landing). */
  pillar: 'Tested on locked, unseen patients.',
  /** Segmented-control tooltip (Model performance). */
  split: 'Patients never seen during development; locked, one disclosed re-score',
  /** The re-score disclosure, for prose that has already said the split was locked and scored when frozen. */
  rescore: RESCORE,
} as const;
