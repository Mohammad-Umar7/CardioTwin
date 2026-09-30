import { describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { EdgeModel } from '@/inference/model';
import type { PortableModelSpec } from '@/inference/types';
import type { CohortResponse, FeatureSchema, FeatureVector } from '@/types/contracts';
import cohortRaw from '../../../public/model/cohort.json?raw';
import modelRaw from '../../../public/model/model.json?raw';
import schemaRaw from '../../../public/model/schema.json?raw';
import { IMMUTABLE_INPUTS, counterfactualValue, leverCandidates, leverRows, mergeCandidates, rankLevers } from './levers';

const index = indexSchema(JSON.parse(schemaRaw) as FeatureSchema);
const specOf = (k: string) => index.byKey.get(k);
const model = new EdgeModel(JSON.parse(modelRaw) as PortableModelSpec);
const cohort = JSON.parse(cohortRaw) as CohortResponse;

describe('counterfactual values', () => {
  it('flips findings, moves measures to the edge of normal and clears abnormal categories', () => {
    expect(counterfactualValue(specOf('Typical Chest Pain')!, 1)).toEqual({ from: 1, to: 0, kind: 'flip' });
    expect(counterfactualValue(specOf('DM')!, 0)).toEqual({ from: 0, to: 1, kind: 'flip' });
    expect(counterfactualValue(specOf('BP')!, 150)).toEqual({ from: 150, to: 120, kind: 'normalise' });
    expect(counterfactualValue(specOf('EF-TTE')!, 35)).toEqual({ from: 35, to: 52, kind: 'normalise' });
    expect(counterfactualValue(specOf('Region RWMA')!, 3)).toEqual({ from: 3, to: 0, kind: 'normalise' });
    expect(counterfactualValue(specOf('BBB')!, 'LBBB')).toEqual({ from: 'LBBB', to: 'N', kind: 'clear' });
  });

  it('offers nothing for normal measures, absent categories or unknown values', () => {
    expect(counterfactualValue(specOf('BP')!, 110)).toBeNull();
    expect(counterfactualValue(specOf('BBB')!, 'N')).toBeNull();
    expect(counterfactualValue(specOf('Weight')!, 90)).toBeNull();
    expect(counterfactualValue(specOf('DM')!, undefined)).toBeNull();
  });
});

describe('lever candidates on real patients', () => {
  it.each(cohort.patients.slice(0, 30).map((p) => [p.id, p.features] as const))(
    '%s: never offers age, sex or height, and every candidate changes exactly one input',
    (_id, features) => {
      const r = model.predict(features);
      for (const t of ['CAD', 'LAD', 'LCX', 'RCA']) {
        const list = leverCandidates(features, r.explanations[t], specOf, 8);
        expect(list.length).toBeLessThanOrEqual(8);
        for (const c of list) {
          expect(IMMUTABLE_INPUTS.has(c.feature)).toBe(false);
          expect(c.to).not.toEqual(c.from);
        }
        const rows = leverRows(features, list);
        expect(rows[0]).toBe(features);
        rows.slice(1).forEach((row, i) => {
          const changed = Object.keys(row).filter((k) => row[k] !== features[k]);
          expect(changed).toEqual([list[i]!.feature]);
        });
      }
    },
  );

  it('ranks levers by the size of the change they cause, with the reference row as "now"', () => {
    const features = cohort.patients.find((p) => p.id === 'P-011')!.features as FeatureVector;
    const r = model.predict(features);
    const perTarget = ['CAD', 'LAD'].map((t) => leverCandidates(features, r.explanations[t], specOf, 8));
    const merged = mergeCandidates(perTarget);
    expect(new Set(merged.map((c) => c.feature)).size).toBe(merged.length);
    const probabilities = leverRows(features, merged).map((row) => {
      const s = model.score(row);
      return Object.fromEntries(Object.entries(s.predictions).map(([t, p]) => [t, p.probability]));
    });
    const levers = rankLevers('CAD', merged, probabilities, new Set(perTarget[0]!.map((c) => c.feature)));
    expect(levers.length).toBeGreaterThan(0);
    expect(levers[0]!.now).toBeCloseTo(r.predictions.CAD!.probability, 12);
    for (let i = 1; i < levers.length; i += 1) expect(Math.abs(levers[i - 1]!.delta)).toBeGreaterThanOrEqual(Math.abs(levers[i]!.delta));
    // Typical angina is P-011's largest CAD driver: removing it must lower the estimate.
    const angina = levers.find((l) => l.feature === 'Typical Chest Pain')!;
    expect(angina.to).toBe(0);
    expect(angina.delta).toBeLessThan(0);
  });
});
