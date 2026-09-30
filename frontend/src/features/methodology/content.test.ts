import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest, FeatureSchema, MetricsReport } from '@/types/contracts';
import {
  anatomySteps,
  boundAbove,
  cite,
  datasetCard,
  keyFacts,
  leakagePolicy,
  modalityCounts,
  modelRows,
  pipelinePhases,
  positives,
  powerOfTen,
  REFERENCES,
  rejectedIdeas,
} from './content';

const pub = (p: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../public', p), 'utf8')) as unknown;
const report = pub('model/metrics.json') as MetricsReport;
const schema = pub('model/schema.json') as FeatureSchema;
const manifest = pub('anatomy/manifest.json') as AnatomyManifest;

describe('key facts', () => {
  it('reads the dataset, protocol and parity facts from the shipped artifacts', () => {
    const k = keyFacts(report, schema);
    expect(k).toMatchObject({
      n: 303,
      nDev: 242,
      nTest: 61,
      nInputs: schema.features.length,
      nModalities: 7,
      nTargets: 4,
    });
    expect(k.cvSplits! * k.cvRepeats!).toBe(50);
    expect(k.additivity).toBeGreaterThan(0);
    expect(k.additivity).toBeLessThan(1e-6);
  });

  it('degrades to nulls, never throws, without artifacts', () => {
    expect(keyFacts(undefined, undefined)).toMatchObject({
      n: null,
      nInputs: null,
      nTargets: 4,
      additivity: null,
    });
    expect(pipelinePhases(keyFacts(null, null)).flatMap((p) => p.steps)).toHaveLength(11);
    expect(datasetCard(null, null).length).toBeGreaterThan(0);
    expect(modelRows(null)).toEqual([]);
  });

  it('writes powers of ten with true superscripts', () => {
    expect(powerOfTen(-6)).toBe('10⁻⁶');
    expect(boundAbove(1.78e-15)).toBe('10⁻¹⁴');
    expect(boundAbove(3.87e-7)).toBe('10⁻⁶');
  });
});

describe('pipeline', () => {
  it('numbers the eleven steps from data to 3D in order, each linked to a section', () => {
    const phases = pipelinePhases(keyFacts(report, schema));
    const steps = phases.flatMap((p) => p.steps);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(steps.map((s) => s.title)).toEqual([
      'Clinical record',
      'Leakage guard',
      'Locked split',
      'Nested repeated CV',
      'Ensemble',
      'Platt calibration',
      'Decision threshold',
      'Exact SHAP',
      'Portable model',
      'Server + edge engines',
      '3D mapping',
    ]);
    expect(steps[0]!.detail).toBe(`303 patients · ${schema.features.length} inputs · 7 modalities`);
    expect(steps[2]!.detail).toBe('242 development · 61 test, stratified');
    for (const s of steps) expect(s.anchor).toMatch(/^[a-z-]+$/);
  });
});

describe('dataset card', () => {
  const card = datasetCard(report, schema);
  const text = card.map((r) => `${r.label} ${r.value}`).join('\n');

  it('names dropped constants in words and links the DOI', () => {
    expect(text).toContain('congestive heart failure and exertional chest pain dropped');
    expect(text).not.toMatch(/\bCHF\b|Exertional CP/);
    expect(card.find((r) => r.label === 'DOI')?.href).toBe('https://doi.org/10.24432/C5461K');
  });

  it('counts positives from the label co-occurrence table', () => {
    expect(positives(report)).toEqual({ CAD: 216, LAD: 177, LCX: 119, RCA: 114 });
    expect(text).toContain('CAD in 216 (71');
  });

  it('orders modalities from bedside to instrumental with human examples', () => {
    const m = modalityCounts(schema);
    expect(m.map((x) => x.id)).toEqual([
      'demographics',
      'risk_factors',
      'symptoms',
      'exam',
      'ecg',
      'labs',
      'echo',
    ]);
    expect(m.reduce((a, x) => a + x.count, 0)).toBe(schema.features.length);
    expect(m.find((x) => x.id === 'echo')!.examples).toContain('Ejection fraction');
    expect(m.filter((x) => x.bedside).map((x) => x.id)).toEqual([
      'demographics',
      'risk_factors',
      'symptoms',
      'exam',
    ]);
  });
});

describe('policy, models and anatomy', () => {
  it('states six leakage rules with data-driven specifics', () => {
    const p = leakagePolicy(report);
    expect(p).toHaveLength(6);
    expect(p[1]!.body).toContain('61 patients were set aside (seed 42)');
    expect(p[5]!.body).toContain('scored 2 times in total');
  });

  it('names every deployed model in words, never by id', () => {
    const rows = modelRows(report);
    expect(rows.map((r) => r.target)).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
    expect(rows[0]).toMatchObject({
      model: 'Elastic-net logistic + boosted trees',
      threshold: '0.75',
      testAuc: '0.86',
      testCi: '0.74–0.95',
    });
    for (const r of rows) expect(`${r.model} ${r.modelFull}`).not.toMatch(/lr_|xgboost|_/);
  });

  it('lists rejected ideas against the adoption bar', () => {
    const r = rejectedIdeas(report);
    expect(r.bar).toBe(0.005);
    expect(r.items.map((i) => i.delta)).toEqual(['+0.0015', '−0.0065', '+0.0015']);
    expect(r.items.every((i) => !i.name.includes('_'))).toBe(true);
  });

  it('describes the anatomy build from the manifest', () => {
    const steps = anatomySteps(manifest);
    expect(steps.map((s) => s.title)).toEqual([
      'BodyParts3D',
      'Blender',
      'Territories',
      'Centrelines',
      'SCCT segments',
      'glTF',
    ]);
    expect(steps[2]!.detail).toContain('σ = 7 mm');
    expect(anatomySteps(null)).toHaveLength(6);
  });
});

describe('references', () => {
  it('has unique ids, https links and resolvable citations', () => {
    const ids = REFERENCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REFERENCES) if (r.href) expect(r.href).toMatch(/^https:\/\//);
    expect(cite('dataset')).toBe(1);
    expect(cite('nope')).toBe(0);
  });
});
