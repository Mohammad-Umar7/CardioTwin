import { describe, expect, it } from 'vitest';
import { sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import { THIN_SPACE as T } from '@/lib/format';
import type { Explanation, PredictResponse } from '@/types/contracts';
import {
  bandRangeText,
  buildReport,
  contributionsInPoints,
  decisionTexts,
  driverPanel,
  driverSentence,
  featureText,
  fnv1a,
  formatPoints,
  formatReportDate,
  inputGroups,
  isoDay,
  phraseForInput,
  reportIdFor,
  targetResult,
  type CalibratedExplanation,
  type ReportInput,
} from './reportModel';

const logit = (p: number) => Math.log(p / (1 - p));

/** Adds the CONTRACTS §7.3 calibrated fields with Platt slope `a` (intercept solved from p and logit). */
function withCalibration(pred: PredictResponse, a = 1.25): PredictResponse {
  const explanations: Record<string, Explanation> = {};
  for (const [t, e] of Object.entries(pred.explanations)) {
    const p = pred.predictions[t]!.probability;
    const b = logit(p) - a * e.output_value;
    explanations[t] = {
      ...e,
      calibrated_base_value: a * e.base_value + b,
      calibrated_output_value: a * e.output_value + b,
      contributions: e.contributions.map((c) => ({ ...c, shap_calibrated: a * c.shap })),
    } as Explanation;
  }
  return { ...pred, explanations };
}

const patient = sampleCohort.patients[0]!;
const calibrated = withCalibration(samplePrediction);

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    schema: sampleSchema,
    features: { ...patient.features },
    recorded: { ...patient.features },
    prediction: calibrated,
    status: 'ready',
    engineStatus: 'server',
    patient: { id: patient.id, split: patient.split, summary: patient.summary },
    mode: 'cohort',
    generatedAt: new Date(2026, 8, 30, 10, 42),
    ...overrides,
  };
}

describe('decisionTexts', () => {
  it('uses integer percentages when they cannot contradict the decision', () => {
    expect(decisionTexts(0.87, 0.46)).toEqual({ pctText: `87${T}%`, thresholdText: `46${T}%` });
    expect(decisionTexts(0.31, 0.55)).toEqual({ pctText: `31${T}%`, thresholdText: `55${T}%` });
  });

  it('switches to one decimal when rounding would make p and the threshold look equal or inverted', () => {
    // 0.745 rounds to 75 % and 0.7474 to 75 %, yet p is below the threshold.
    expect(decisionTexts(0.745, 0.7474)).toEqual({ pctText: `74.5${T}%`, thresholdText: `74.7${T}%` });
    // 0.7476 ≥ 0.7474: flagged, both would read 75 %.
    expect(decisionTexts(0.7476, 0.7474)).toEqual({ pctText: `74.8${T}%`, thresholdText: `74.7${T}%` });
  });

  it('keeps the ≤5 % / ≥95 % display bounds', () => {
    expect(decisionTexts(0.004, 0.3).pctText).toBe(`≤5${T}%`);
    expect(decisionTexts(0.995, 0.75).pctText).toBe(`≥95${T}%`);
  });
});

describe('bandRangeText', () => {
  it('names each band range from the schema edges', () => {
    expect(bandRangeText('low')).toBe(`<${T}25${T}%`);
    expect(bandRangeText('moderate')).toBe(`25–50${T}%`);
    expect(bandRangeText('high')).toBe(`50–75${T}%`);
    expect(bandRangeText('critical')).toBe(`≥${T}75${T}%`);
  });
});

describe('targetResult', () => {
  const specs = new Map(sampleSchema.targets.map((t) => [t.id, t]));

  it('words the CAD verdict against its threshold and shows critical as "Very high"', () => {
    const r = targetResult('CAD', calibrated, specs.get('CAD'), sampleSchema.risk_bands, null)!;
    expect(r.flagged).toBe(true);
    expect(r.verdict).toBe('Flagged');
    expect(r.verdictLine).toBe(`Flagged — above the 46${T}% threshold`);
    expect(r.bandLabel).toBe('Very high');
    expect(r.truth).toBeNull();
  });

  it('uses the model label as the decision for every target (verdict === label)', () => {
    for (const id of ['CAD', 'LAD', 'LCX', 'RCA']) {
      const r = targetResult(id, calibrated, specs.get(id), sampleSchema.risk_bands, null)!;
      expect(r.flagged).toBe(calibrated.predictions[id]!.label === 1);
    }
  });

  it('reconciles band and decision in one sentence for a vessel', () => {
    const lcx = targetResult('LCX', calibrated, specs.get('LCX'), sampleSchema.risk_bands, null)!;
    expect(lcx.verdictLine).toBe(`Not flagged — below LCX’s 45${T}% threshold`);
    expect(lcx.reconcile).toBe(`Moderate probability (25–50${T}%). Not flagged because LCX’s decision threshold is 45${T}%.`);
  });

  it('compares the decision with the revealed cath result', () => {
    const truth = { LAD: 1, LCX: 1, RCA: 0 } as const;
    const lad = targetResult('LAD', calibrated, specs.get('LAD'), sampleSchema.risk_bands, truth)!;
    const lcx = targetResult('LCX', calibrated, specs.get('LCX'), sampleSchema.risk_bands, truth)!;
    const rca = targetResult('RCA', calibrated, specs.get('RCA'), sampleSchema.risk_bands, truth)!;
    expect(lad.truth).toEqual({ stenotic: true, agrees: true });
    expect(lcx.truth).toEqual({ stenotic: true, agrees: false });
    expect(rca.truth).toEqual({ stenotic: false, agrees: false });
  });
});

describe('contributionsInPoints', () => {
  it('maps log-odds SHAP to percentage points that add up exactly from the baseline to the estimate', () => {
    for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
      const p = calibrated.predictions[t]!.probability;
      const res = contributionsInPoints(calibrated.explanations[t], p)!;
      const sum = [...res.points.values()].reduce((s, v) => s + v, 0);
      expect(res.baseline + sum).toBeCloseTo(p, 12);
    }
  });

  it('preserves the sign and the ranking of every contribution', () => {
    const e = calibrated.explanations.CAD!;
    const res = contributionsInPoints(e, calibrated.predictions.CAD!.probability)!;
    for (const c of e.contributions) {
      const pp = res.points.get(c.feature)!;
      if (c.shap === 0) expect(pp).toBe(0);
      else expect(Math.sign(pp)).toBe(Math.sign(c.shap));
    }
    const byShap = [...e.contributions].sort((x, y) => Math.abs(y.shap) - Math.abs(x.shap)).map((c) => c.feature);
    const byPts = [...res.points.entries()].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([f]) => f);
    expect(byPts).toEqual(byShap);
  });

  it('derives the calibrated values from the Platt slope when shap_calibrated is missing', () => {
    const e = calibrated.explanations.LAD! as CalibratedExplanation;
    const stripped: Explanation = { ...e, contributions: e.contributions.map((c) => ({ feature: c.feature, value: c.value, shap: c.shap })) };
    const p = calibrated.predictions.LAD!.probability;
    const a = contributionsInPoints(e, p)!;
    const b = contributionsInPoints(stripped, p)!;
    for (const [f, v] of a.points) expect(b.points.get(f)).toBeCloseTo(v, 12);
  });

  it('returns null without a calibrated baseline (older engines) so the caller can fall back to log-odds', () => {
    expect(contributionsInPoints(samplePrediction.explanations.CAD, 0.87)).toBeNull();
    expect(contributionsInPoints(null, 0.5)).toBeNull();
  });

  it('uses the local slope when the contributions cancel out', () => {
    const e: CalibratedExplanation = {
      space: 'log-odds',
      base_value: 0,
      output_value: 0,
      calibrated_base_value: 0,
      calibrated_output_value: 0,
      contributions: [
        { feature: 'A', value: 1, shap: 0.4, shap_calibrated: 0.4 },
        { feature: 'B', value: 0, shap: -0.4, shap_calibrated: -0.4 },
      ],
    };
    const res = contributionsInPoints(e, 0.5)!;
    expect(res.baseline).toBeCloseTo(0.5, 12);
    expect(res.points.get('A')).toBeCloseTo(0.1, 12);
    expect(res.points.get('B')).toBeCloseTo(-0.1, 12);
  });
});

describe('formatPoints', () => {
  it('prints signed percentage points with one decimal and a true minus', () => {
    expect(formatPoints(0.1234)).toBe(`+12.3${T}pts`);
    expect(formatPoints(-0.008)).toBe(`−0.8${T}pts`);
    expect(formatPoints(0.0001)).toBe(`0.0${T}pts`);
  });
});

describe('driverPanel', () => {
  const byKey = new Map(sampleSchema.features.map((f) => [f.key, f]));
  const cad = sampleSchema.targets[0];

  it('lists the top drivers in points and closes the sum with an "others" line', () => {
    const d = driverPanel('CAD', calibrated, cad, byKey, 3)!;
    expect(d.unit).toBe('points');
    expect(d.rows.map((r) => r.feature)).toEqual(['Typical Chest Pain', 'Age', 'Region RWMA']);
    expect(d.rows[0]!.direction).toBe('raises');
    expect(d.rows[0]!.valueText).toBe('Yes');
    expect(d.others.count).toBe(5);
    const total = d.baseline + d.rows.reduce((s, r) => s + r.pp, 0) + d.others.value;
    expect(total).toBeCloseTo(0.87, 12);
    expect(d.maxAbs).toBeCloseTo(Math.abs(d.rows[0]!.pp), 12);
    expect(d.baselineText).toBe(`49${T}%`);
  });

  it('falls back to log-odds when the engine sent no calibrated fields', () => {
    const d = driverPanel('CAD', samplePrediction, cad, byKey, 2)!;
    expect(d.unit).toBe('log-odds');
    expect(d.rows.map((r) => r.ppText)).toEqual(['+0.94', '+0.41']);
    expect(d.baselineText).toBe('+0.38');
  });

  it('writes a number-free sentence naming the main drivers', () => {
    const d = driverPanel('CAD', calibrated, cad, byKey, 5)!;
    expect(d.sentence).toBe(`Raised mostly by typical chest pain and age 62${T}y; lowered most by male sex.`);
    expect(driverSentence([], () => '')).toBe('No single input moves it much from the typical cohort patient.');
  });
});

describe('featureText', () => {
  it('reads ordinal classes as "Class n" and defers to lib/format otherwise', () => {
    const fc = { key: 'Function Class', label: 'Functional class', group: 'symptoms', type: 'numeric' as const, unit: 'class' };
    expect(featureText(fc, 2)).toBe('Class 2');
    expect(featureText(sampleSchema.features.find((f) => f.key === 'BP')!, 140)).toBe(`140${T}mmHg`);
  });
});

describe('phraseForInput', () => {
  const byKey = new Map(sampleSchema.features.map((f) => [f.key, f]));
  it('describes binary, numeric and categorical inputs in words', () => {
    expect(phraseForInput(byKey.get('BP'), 'BP', 140)).toBe('high blood pressure');
    expect(phraseForInput(byKey.get('BP'), 'BP', 110)).toBe('normal blood pressure');
    expect(phraseForInput(byKey.get('EF-TTE'), 'EF-TTE', 40)).toBe('low ejection fraction');
    expect(phraseForInput(byKey.get('Age'), 'Age', 62)).toBe(`age 62${T}y`);
    const rwma = { ...byKey.get('Region RWMA')!, normal: { low: 0, high: 0 } };
    expect(phraseForInput(rwma, 'Region RWMA', 0)).toBe('no regional wall motion abnormality');
    expect(phraseForInput(rwma, 'Region RWMA', 2)).toBe('regional wall motion abnormality (2)');
    expect(phraseForInput(byKey.get('BBB'), 'BBB', 'LBBB')).toBe('LBBB');
    expect(phraseForInput(byKey.get('BBB'), 'BBB', 'N')).toBe('no bundle branch block');
    expect(phraseForInput(undefined, 'Mystery', 1)).toBe('Mystery');
  });
});

describe('inputGroups', () => {
  it('groups inputs by modality in schema order and flags values outside the reference range', () => {
    const groups = inputGroups(sampleSchema, patient.features, patient.features);
    expect(groups.map((g) => g.id)).toEqual(['demographics', 'symptoms', 'exam', 'ecg', 'echo']);
    const exam = groups.find((g) => g.id === 'exam')!;
    const bp = exam.rows.find((r) => r.key === 'BP')!;
    expect(bp).toMatchObject({ valueText: `140${T}mmHg`, refText: '90–120', status: 'above', flagText: 'above normal' });
    expect(exam.abnormalCount).toBe(1);
    const ef = groups.find((g) => g.id === 'echo')!.rows.find((r) => r.key === 'EF-TTE')!;
    expect(ef).toMatchObject({ status: 'below', flagText: 'below normal' });
  });

  it('collapses binary inputs into present / absent lines and treats non-"none" categoricals as findings', () => {
    const features = { ...patient.features, BBB: 'LBBB' };
    const groups = inputGroups(sampleSchema, features, features);
    const symptoms = groups.find((g) => g.id === 'symptoms')!;
    expect(symptoms.rows).toHaveLength(0);
    expect(symptoms.present.map((r) => r.key)).toEqual(['Typical Chest Pain']);
    const bbb = groups.find((g) => g.id === 'ecg')!.rows[0]!;
    expect(bbb).toMatchObject({ valueText: 'LBBB', finding: true });
    const sex = groups.find((g) => g.id === 'demographics')!.rows.find((r) => r.key === 'Sex')!;
    expect(sex.finding).toBe(false);
  });

  it('marks what-if edits with the recorded value and imputed inputs', () => {
    const features = { ...patient.features, 'Typical Chest Pain': 0, Age: 70 };
    const groups = inputGroups(sampleSchema, features, patient.features, ['PR']);
    const age = groups[0]!.rows.find((r) => r.key === 'Age')!;
    expect(age).toMatchObject({ edited: true, wasText: `62${T}y`, valueText: `70${T}y` });
    const pain = groups.find((g) => g.id === 'symptoms')!.rows[0]!;
    expect(pain).toMatchObject({ key: 'Typical Chest Pain', edited: true, wasText: 'Yes', valueText: 'No' });
    const pr = groups.find((g) => g.id === 'exam')!.rows.find((r) => r.key === 'PR')!;
    expect(pr.imputed).toBe(true);
  });
});

describe('reportIdFor', () => {
  it('is deterministic, independent of key order and sensitive to any input, model or engine change', () => {
    const a = reportIdFor({ Age: 62, Sex: 'Male' }, '1.1.0', 'server');
    expect(a).toMatch(/^CT-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(reportIdFor({ Sex: 'Male', Age: 62 }, '1.1.0', 'server')).toBe(a);
    expect(reportIdFor({ Age: 63, Sex: 'Male' }, '1.1.0', 'server')).not.toBe(a);
    expect(reportIdFor({ Age: 62, Sex: 'Male' }, '1.2.0', 'server')).not.toBe(a);
    expect(reportIdFor({ Age: 62, Sex: 'Male' }, '1.1.0', 'edge')).not.toBe(a);
    expect(fnv1a('')).toBe(0x811c9dc5);
  });
});

describe('dates', () => {
  it('formats the generation time without locale dependence', () => {
    const d = new Date(2026, 8, 3, 7, 5);
    expect(formatReportDate(d)).toBe('3 Sep 2026, 07:05');
    expect(isoDay(d)).toBe('2026-09-03');
  });
});

describe('buildReport', () => {
  it('shapes a ready report: header, CAD, vessels, drivers, inputs and totals', () => {
    const r = buildReport(input());
    expect(r.state).toBe('ready');
    expect(r.header).toMatchObject({
      patientLabel: 'P-017',
      splitTag: 'TEST',
      splitText: 'Held-out test patient, unseen in training',
      demographics: `Male · 62${T}y`,
      generatedText: '30 Sep 2026, 10:42',
      engineLabel: 'Server',
      modelVersion: '1.0.0',
    });
    expect(r.cad?.pctText).toBe(`87${T}%`);
    expect(r.vessels.map((v) => v.id)).toEqual(['LAD', 'LCX', 'RCA']);
    expect(r.flaggedText).toBe('2 of 3 flagged');
    expect(r.drivers.map((d) => d.target)).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
    expect(r.cadSentence).toMatch(/^Raised mostly by typical chest pain/);
    expect(r.totals).toMatchObject({ total: 8, abnormal: 2, edited: 0, imputed: 0 });
    expect(r.truthShown).toBe(false);
  });

  it('never shows a stale estimate while the next one is computing', () => {
    const r = buildReport(input({ status: 'loading' }));
    expect(r.state).toBe('updating');
    expect(r.cad).toBeNull();
    expect(r.vessels).toEqual([]);
    expect(r.drivers).toEqual([]);
    expect(r.inputs.length).toBeGreaterThan(0);
  });

  it('shows no numbers when no engine can answer', () => {
    const r = buildReport(input({ status: 'error', error: 'Estimate unavailable', engineStatus: 'unavailable' }));
    expect(r.state).toBe('unavailable');
    expect(r.stateMessage).toBe('Estimate unavailable');
    expect(r.cad).toBeNull();
    expect(buildReport(input({ features: {}, recorded: {} })).state).toBe('empty');
  });

  it('labels custom patients and counts what-if edits', () => {
    const r = buildReport(
      input({ patient: { id: null, split: null }, mode: 'custom', features: { ...patient.features, BP: 118 } }),
    );
    expect(r.header).toMatchObject({ patientLabel: 'Custom patient', splitTag: null, splitText: 'Custom inputs, not a cohort patient' });
    expect(r.editedCount).toBe(1);
  });

  it('adds "was" values from the recorded estimate only while what-if edits exist', () => {
    const recordedPrediction = {
      ...calibrated,
      predictions: { ...calibrated.predictions, CAD: { ...calibrated.predictions.CAD!, probability: 0.94 } },
    };
    const edited = buildReport(input({ features: { ...patient.features, BP: 118 }, recordedPrediction }));
    expect(edited.cad?.recorded).toMatchObject({ p: 0.94, pctText: `94${T}%` });
    expect(edited.cad?.recorded?.delta).toMatchObject({ direction: 'down', text: `−7${T}pts` });
    expect(edited.vessels[0]?.recorded?.delta.direction).toBe('none');
    const unedited = buildReport(input({ recordedPrediction }));
    expect(unedited.cad?.recorded).toBeNull();
  });

  it('shows the cath comparison only when the truth is passed (after Reveal)', () => {
    const r = buildReport(input({ truth: patient.labels }));
    expect(r.truthShown).toBe(true);
    expect(r.cad?.truth).toEqual({ stenotic: true, agrees: true });
    expect(r.truthWithheld).toBe(false);
    // A what-if patient is hypothetical: its estimate is never scored against the recorded cath result.
    const whatIf = buildReport(input({ truth: patient.labels, features: { ...patient.features, BP: 118 } }));
    expect(whatIf.truthShown).toBe(false);
    expect(whatIf.truthWithheld).toBe(true);
    expect(whatIf.vessels.every((v) => v.truth === null)).toBe(true);
  });
});

describe('CAD verdict next to flagged arteries', () => {
  it('reads neutral, never a hollow "Not flagged", when CAD is below its threshold but an artery is flagged', () => {
    const preds = { ...calibrated.predictions };
    preds.CAD = { ...preds.CAD!, probability: 0.4, threshold: 0.75, label: 0, risk_band: 'moderate' };
    preds.LCX = { ...preds.LCX!, probability: 0.39, label: 1 };
    const model = buildReport(input({ prediction: { ...calibrated, predictions: preds } }));
    expect(model.cad?.neutral).toBe(true);
    expect(model.cad?.verdictLine).toMatch(/^Below CAD’s 75\s%\sdecision threshold · [1-3] of 3 vessels flagged$/);
  });
});
