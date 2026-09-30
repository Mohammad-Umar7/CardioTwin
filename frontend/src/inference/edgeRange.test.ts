/**
 * The edge engine answers out-of-range inputs the way the server does by default (422 instead of an
 * unvalidated extrapolation). Before this, `BMI = 18.1` — which the workstation's input can produce by
 * snapping 18.12 to the 0.1 grid below the 18.1154 minimum — got a 422 from the server and a silent
 * prediction from the edge.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/services/api';
import { EdgeEngine, outOfRangeIssues } from '@/services/engine';
import type { FeatureSchema } from '@/types/contracts';
import schemaRaw from '../../public/model/schema.json?raw';
import { InferenceClient } from './client';
import { EdgeModel } from './model';
import { loadModelSpec } from './testing/artifacts';

const schema = (): FeatureSchema => JSON.parse(schemaRaw) as FeatureSchema;
const clients: InferenceClient[] = [];

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
});

function engine(loadSchema?: () => Promise<FeatureSchema>): EdgeEngine {
  const client = new InferenceClient({ source: { spec: loadModelSpec() } });
  clients.push(client);
  return new EdgeEngine({ client, schema: loadSchema });
}

describe('outOfRangeIssues', () => {
  it('words issues like the server, in request order, and only for numeric features', () => {
    const issues = outOfRangeIssues(schema(), { Age: 200.5, BMI: '17', HTN: 7, Sex: 'Male', WBC: 100000 });
    expect(issues).toEqual([
      'features.Age: Age=200.5 is outside the allowed range 30–86 years (the range of the training cohort; predictions are not validated beyond it)',
      'features.BMI: BMI=17 is outside the allowed range 18.1154–40.9007 kg/m² (the range of the training cohort; predictions are not validated beyond it)',
      'features.WBC: WBC=100000 is outside the allowed range 3700–18000 cells/µL (the range of the training cohort; predictions are not validated beyond it)',
    ]);
  });

  it('accepts both bounds exactly and every value between', () => {
    const s = schema();
    for (const f of s.features) {
      if (f.type !== 'numeric') continue;
      expect(outOfRangeIssues(s, { [f.key]: f.min! })).toEqual([]);
      expect(outOfRangeIssues(s, { [f.key]: f.max! })).toEqual([]);
      expect(outOfRangeIssues(s, { [f.key]: (f.min! + f.max!) / 2 })).toEqual([]);
    }
  });
});

describe('EdgeEngine range policy', () => {
  it('rejects BMI 18.1 with the server’s 422 message, and predicts at the minimum', async () => {
    const edge = engine(async () => schema());
    const error = await edge.predict({ BMI: 18.1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'validation_error' });
    expect((error as ApiError).message).toBe(
      'features.BMI: BMI=18.1 is outside the allowed range 18.1154–40.9007 kg/m² (the range of the training cohort; predictions are not validated beyond it)',
    );
    await expect(edge.predict({ BMI: 18.1154 })).resolves.toEqual(new EdgeModel(loadModelSpec()).predict({ BMI: 18.1154 }));
  });

  it('summarises several issues as "(+N more)"', async () => {
    const edge = engine(async () => schema());
    await expect(edge.predict({ BMI: 17, Age: 20, TG: 5000 })).rejects.toThrow(/^features\.BMI: .* \(\+2 more\)$/);
  });

  it('still predicts when the schema cannot be loaded (no range check rather than no estimate)', async () => {
    const edge = engine(async () => {
      throw new Error('schema.json missing');
    });
    await expect(edge.predict({ BMI: 18.1 })).resolves.toMatchObject({ engine: 'edge' });
  });

  it('does not range-check without a schema (library use)', async () => {
    await expect(engine().predict({ Age: 120 })).resolves.toMatchObject({ engine: 'edge' });
  });
});
