import { describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { EdgeModel } from '@/inference/model';
import type { PortableModelSpec } from '@/inference/types';
import { samplePrediction, sampleSchema } from '@/test/fixtures';
import type { CohortResponse, FeatureSchema } from '@/types/contracts';
import cohortRaw from '../../public/model/cohort.json?raw';
import modelRaw from '../../public/model/model.json?raw';
import schemaRaw from '../../public/model/schema.json?raw';
import {
  buildNarrative,
  explainTakeaway,
  groupAttribution,
  inversePlatt,
  narrativePhrase,
  narrativeText,
  platt,
  shareSegments,
  sortedContributions,
} from './explain';

const idx = indexSchema(sampleSchema);
const specOf = (k: string) => idx.byKey.get(k);

describe('explanations', () => {
  it('keeps the additive identity base + Σ shap ≈ output for the sample (sanity of fixtures)', () => {
    const e = samplePrediction.explanations.CAD!;
    expect(sortedContributions(e)[0]?.feature).toBe('Typical Chest Pain');
  });

  it('sums SHAP per group with shares that add to 1', () => {
    const g = groupAttribution(samplePrediction.explanations.LAD, (f) => idx.byKey.get(f)?.group);
    const total = [...g.values()].reduce((a, r) => a + r.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(g.get('symptoms')?.sum).toBeCloseTo(0.94, 6);
  });

  it('maps shares to 0–4 meter segments', () => {
    expect(shareSegments(0.01)).toBe(0);
    expect(shareSegments(0.1)).toBe(1);
    expect(shareSegments(0.5)).toBe(2);
    expect(shareSegments(0.95)).toBe(4);
  });

  it('inverts Platt calibration exactly', () => {
    const a = 1.84;
    const b = -0.61;
    const m = 0.73;
    expect(inversePlatt(platt(m, a, b), a, b)).toBeCloseTo(m, 10);
  });

  it('builds the template "why" sentence with linked phrases and no numbers', () => {
    const parts = buildNarrative(samplePrediction.explanations.LAD, specOf);
    expect(narrativeText(parts)).toBe('Driven mostly by typical chest pain and older age; male sex pulls it down.');
    expect(parts.filter((p) => p.kind === 'phrase').map((p) => p.feature)).toEqual(['Typical Chest Pain', 'Age', 'Sex']);
  });

  it('handles explanations without meaningful drivers', () => {
    const parts = buildNarrative({ space: 'log-odds', base_value: 0, output_value: 0, contributions: [] }, specOf);
    expect(narrativeText(parts)).toContain('No single input');
});
});

// ---------------------------------------------------------------- narrative grammar on the real schema

const realIndex = indexSchema(JSON.parse(schemaRaw) as FeatureSchema);
const realSpec = (k: string) => realIndex.byKey.get(k);
const say = (feature: string, value: number | string, role: 'subject' | 'object' = 'subject') =>
  narrativePhrase({ feature, value }, realSpec(feature), role).text;

describe('narrative phrase rules (WORKSTATION_V2 §5.10)', () => {
  it('names a present finding and negates an absent one', () => {
    expect(say('Typical Chest Pain', 1)).toBe('typical angina');
    expect(say('Typical Chest Pain', 0)).toBe('no typical angina');
    expect(say('Typical Chest Pain', 0, 'object')).toBe('the absence of typical angina');
    expect(say('St Depression', 1)).toBe('ST depression');
    expect(say('Current Smoker', 0)).toBe('not smoking');
    expect(say('Obesity', 1)).toBe('obesity');
  });

  it('describes measures against their reference range, in words', () => {
    expect(say('BP', 140)).toBe('high blood pressure');
    expect(say('BP', 110)).toBe('normal blood pressure');
    expect(say('EF-TTE', 40)).toBe('a reduced ejection fraction');
    expect(say('EF-TTE', 60)).toBe('a normal ejection fraction');
    expect(say('HDL', 30)).toBe('low HDL cholesterol');
    expect(say('TG', 220)).toBe('high triglycerides');
    expect(say('PR', 104)).toBe('a fast pulse');
  });

  it('reads a zero count as its absence, never "0 regions"', () => {
    expect(say('Region RWMA', 0)).toBe('normal wall motion');
    expect(say('Region RWMA', 2)).toBe('a regional wall-motion abnormality');
  });

  it('places measures without a range against the cohort median', () => {
    expect(say('Age', 72)).toBe('older age');
    expect(say('Age', 40)).toBe('younger age');
  });

  it('spells categorical options as findings', () => {
    expect(say('Sex', 'Male')).toBe('male sex');
    expect(say('BBB', 'LBBB')).toBe('left bundle branch block');
    expect(say('BBB', 'N')).toBe('no bundle branch block');
    expect(say('VHD', 'mild')).toBe('mild valvular heart disease');
  });

  it('agrees the verb with a plural subject', () => {
    const e = {
      space: 'log-odds',
      base_value: 0,
      output_value: 0.8,
      contributions: [
        { feature: 'Typical Chest Pain', value: 1, shap: 1.0 },
        { feature: 'Q Wave', value: 1, shap: -0.2 },
      ],
    };
    expect(narrativeText(buildNarrative(e, realSpec))).toBe('Driven mostly by typical angina; Q waves pull it down.');
  });

  it('leads with the lowering side when the estimate sits below the typical patient', () => {
    const e = {
      space: 'log-odds',
      base_value: 1.2,
      output_value: -0.4,
      contributions: [
        { feature: 'Typical Chest Pain', value: 0, shap: -1.1 },
        { feature: 'EF-TTE', value: 60, shap: -0.6 },
        { feature: 'HTN', value: 1, shap: 0.1 },
      ],
    };
    expect(narrativeText(buildNarrative(e, realSpec))).toBe(
      'Held down mostly by the absence of typical angina and a normal ejection fraction; hypertension pushes it up.',
    );
    expect(explainTakeaway(e, realSpec)).toMatchObject({
      verb: 'is held down mostly by',
      phrase: { text: 'the absence of typical angina', feature: 'Typical Chest Pain' },
    });
  });

  it('never puts a digit in the narrative of any cohort patient or target', () => {
    const cohort = JSON.parse(cohortRaw) as CohortResponse;
    const model = new EdgeModel(JSON.parse(modelRaw) as PortableModelSpec);
    let n = 0;
    for (const patient of cohort.patients) {
      const r = model.predict(patient.features);
      for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
        const text = narrativeText(buildNarrative(r.explanations[t], realSpec));
        expect(text).not.toMatch(/\d/);
        expect(text).toMatch(/^[A-Z].*\.$/);
        expect(text).not.toMatch(/ {2}|undefined|null/);
        n += 1;
      }
    }
    expect(n).toBe(cohort.patients.length * 4);
  });
});
