import { describe, expect, it } from 'vitest';
import { EdgeModel } from '@/inference/model';
import type { PortableModelSpec } from '@/inference/types';
import type { CohortResponse, FixturesFile, PredictResponse, TargetPrediction } from '@/types/contracts';
import cohortRaw from '../../../public/model/cohort.json?raw';
import fixturesRaw from '../../../public/model/fixtures.json?raw';
import modelRaw from '../../../public/model/model.json?raw';
import {
  bandSentence,
  cadReconciliation,
  cadVerdictDisplay,
  cadVerdictShort,
  cadVerdictLine,
  cathComparison,
  flaggedCount,
  isFlagged,
  reconcilingSentence,
  verdictFor,
  vesselDecisionSentence,
} from './verdict';

const TARGETS = ['CAD', 'LAD', 'LCX', 'RCA'] as const;
const VESSELS = ['LAD', 'LCX', 'RCA'] as const;

const fixtures = JSON.parse(fixturesRaw) as FixturesFile;
const cohort = JSON.parse(cohortRaw) as CohortResponse;
const model = new EdgeModel(JSON.parse(modelRaw) as PortableModelSpec);

/** Every real model output we can reach offline: the parity fixtures + the whole demo cohort. */
const responses: [string, PredictResponse][] = [
  ...fixtures.cases.map((c, i): [string, PredictResponse] => [`fixture ${c.id ?? i}`, c.expected]),
  ...cohort.patients.map((p): [string, PredictResponse] => [p.id, model.predict(p.features) as PredictResponse]),
];

const tp = (probability: number, threshold: number, label?: 0 | 1): TargetPrediction & { label: 0 | 1 } => ({
  probability,
  threshold,
  label: label ?? (probability >= threshold ? 1 : 0),
  risk_band: probability < 0.25 ? 'low' : probability < 0.5 ? 'moderate' : probability < 0.75 ? 'high' : 'critical',
  logit: 0,
});

describe('verdict == label (WORKSTATION_V2 §9.3 C, P0)', () => {
  it('has real outputs to check', () => {
    expect(responses.length).toBeGreaterThanOrEqual(100);
  });

  it.each(responses)('%s: the verdict of every target equals the contract label', (_id, response) => {
    for (const t of TARGETS) {
      const p = response.predictions[t]!;
      expect(verdictFor(p).flagged).toBe(p.label === 1);
      // …and the label itself is the documented decision rule.
      expect(p.label === 1).toBe(p.probability >= p.threshold);
    }
  });

  it.each(responses)('%s: "k of 3 flagged" counts the vessel labels', (_id, response) => {
    const count = flaggedCount(response, VESSELS)!;
    expect(count.k).toBe(VESSELS.filter((v) => response.predictions[v]!.label === 1).length);
    expect(count.text).toBe(`${count.k} of 3 flagged`);
  });

  it('covers both verdicts for every vessel in the real outputs', () => {
    for (const t of TARGETS) {
      const words = new Set(responses.map(([, r]) => verdictFor(r.predictions[t]!).word));
      expect(words).toEqual(new Set(['Flagged', 'Not flagged']));
    }
  });
});

describe('vocabulary (§3.2)', () => {
  it('writes the CAD verdict line with the threshold', () => {
    expect(cadVerdictLine(tp(0.98, 0.7474))).toBe('Flagged — above the 75 % threshold');
    expect(cadVerdictLine(tp(0.4, 0.7474))).toBe('Not flagged — below the 75 % threshold');
  });

  it('says "just" when p and the threshold round to the same percent', () => {
    // LCX of P-003: 32.64 % against a 32.65 % threshold — both read "33 %".
    expect(vesselDecisionSentence('LCX', tp(0.3264, 0.3265))).toBe("Not flagged: just below LCX's 33 % threshold.");
    expect(verdictFor(tp(0.3264, 0.3265)).marginal).toBe(true);
  });

  it('reconciles a Moderate band with a Flagged verdict in one sentence', () => {
    expect(reconcilingSentence('RCA', tp(0.47, 0.318))).toBe(
      "Moderate probability band (25–50 %). Flagged: above RCA's 32 % threshold.",
    );
    expect(bandSentence('critical')).toBe('Very high probability band (75 % or more).');
  });

  it('prefers the contract label over a recomputed comparison', () => {
    expect(isFlagged(tp(0.5, 0.5, 0))).toBe(false);
    expect(isFlagged({ probability: 0.5, threshold: 0.5 })).toBe(true);
  });

  it('never uses banned decision words', () => {
    const copy = [
      cadVerdictLine(tp(0.9, 0.75)),
      cadVerdictLine(tp(0.1, 0.75)),
      reconcilingSentence('LAD', tp(0.9, 0.55)),
      reconcilingSentence('LAD', tp(0.1, 0.55)),
    ].join(' ');
    expect(copy).not.toMatch(/likely|positive|negative|diseased|healthy|diagnos|critical|severe/i);
  });

  it('compares with the cath result in the §3.2 words', () => {
    expect(cathComparison('LAD', 1, tp(0.9, 0.55))).toMatchObject({ truthText: 'Stenotic at cath', agreementText: 'agrees ✓' });
    expect(cathComparison('RCA', 0, tp(0.9, 0.32))).toMatchObject({ truthText: 'Not stenotic at cath', agrees: false });
    expect(cathComparison('CAD', 1, tp(0.9, 0.75))?.truthText).toBe('CAD at cath');
    expect(cathComparison('CAD', undefined, tp(0.9, 0.75))).toBeNull();
  });
});

describe('cadReconciliation', () => {
  const vessels = (lad: number, lcx: number, rca: number) => [
    { id: 'LAD' as const, p: tp(lad, 0.55) },
    { id: 'LCX' as const, p: tp(lcx, 0.33) },
    { id: 'RCA' as const, p: tp(rca, 0.32) },
  ];

  it('explains a flagged vessel under an unflagged CAD (P-035 with EF 55: CAD 66 % High, LAD 60 % flagged)', () => {
    expect(cadReconciliation(tp(0.66, 0.75), vessels(0.6, 0.17, 0.23))).toBe(
      'LAD is flagged at its own, lower threshold; each target is judged separately.',
    );
    expect(cadReconciliation(tp(0.4, 0.75), vessels(0.6, 0.4, 0.23))).toBe(
      'LAD and LCX are flagged at their own, lower thresholds; each target is judged separately.',
    );
  });

  it('explains a High band that is not flagged, and a flagged CAD with no flagged artery', () => {
    expect(cadReconciliation(tp(0.62, 0.75), vessels(0.3, 0.2, 0.2))).toBe(
      'High probability band, yet under CAD’s threshold, so not flagged.',
    );
    expect(cadReconciliation(tp(0.8, 0.75), vessels(0.3, 0.2, 0.2))).toMatch(/^No single artery reaches its own threshold/);
  });

  it('stays silent when the answers agree, and never repeats a number', () => {
    expect(cadReconciliation(tp(0.98, 0.75), vessels(0.65, 0.56, 0.47))).toBeNull();
    expect(cadReconciliation(tp(0.2, 0.75), vessels(0.1, 0.1, 0.1))).toBeNull();
    const all = [
      cadReconciliation(tp(0.66, 0.75), vessels(0.6, 0.17, 0.23)),
      cadReconciliation(tp(0.62, 0.75), vessels(0.3, 0.2, 0.2)),
      cadReconciliation(tp(0.8, 0.75), vessels(0.3, 0.2, 0.2)),
    ].join(' ');
    expect(all).not.toMatch(/\d/);
  });
});

describe('cadVerdictDisplay', () => {
  const vessels = (lad: number, lcx: number, rca: number) => [
    { p: tp(lad, 0.55) },
    { p: tp(lcx, 0.33) },
    { p: tp(rca, 0.32) },
  ];
  it('keeps the hollow "Not flagged" only when the band is Low or Moderate and no artery is flagged', () => {
    const low = cadVerdictDisplay(tp(0.3, 0.75), vessels(0.1, 0.1, 0.1));
    expect(low.glyph).toBe('○');
    expect(low.text).toMatch(/^Not flagged — below the 75\s%\sthreshold$/);
    expect(cadVerdictDisplay(tp(0.98, 0.75), vessels(0.9, 0.9, 0.9)).glyph).toBe('●');
  });
  it('reads neutral at a High band or beside a flagged artery (P-015: CAD 65 %, LCX and RCA flagged)', () => {
    const p015 = cadVerdictDisplay(tp(0.65, 0.75), vessels(0.3, 0.39, 0.37));
    expect(p015.glyph).toBeNull();
    expect(p015.text).toMatch(/^Below CAD’s 75\s%\sdecision threshold$/);
    expect(cadVerdictDisplay(tp(0.62, 0.75), vessels(0.1, 0.1, 0.1)).glyph).toBeNull();
    expect(cadVerdictDisplay(tp(0.4, 0.75), vessels(0.6, 0.1, 0.1)).glyph).toBeNull();
  });
});

describe('cadVerdictShort (landing Predict tile)', () => {
  const vessels = (lad: number) => [{ p: tp(lad, 0.55) }, { p: tp(0.1, 0.33) }, { p: tp(0.1, 0.32) }];
  it('never shows a hollow "Not flagged" beside a High band', () => {
    const high = cadVerdictShort(tp(0.62, 0.75), vessels(0.1));
    expect(high.glyph).toBeNull();
    expect(high.text).toMatch(/^Below CAD’s 75\s%\sthreshold$/);
    expect(cadVerdictShort(tp(0.3, 0.75), vessels(0.1))).toEqual({ glyph: '○', text: 'Not flagged' });
    expect(cadVerdictShort(tp(0.9, 0.75), vessels(0.9))).toEqual({ glyph: '●', text: 'Flagged' });
  });
});
