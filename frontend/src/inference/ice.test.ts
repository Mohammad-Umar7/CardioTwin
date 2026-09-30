import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InferenceClient } from './client';
import { computeIce, iceRows, linspace } from './ice';
import { EdgeModel } from './model';
import { loadCohort, loadModelSpec } from './testing/artifacts';

let model: EdgeModel;
const clients: InferenceClient[] = [];

beforeAll(() => {
  model = new EdgeModel(loadModelSpec());
});

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
});

describe('linspace', () => {
  it('spans the range inclusively and snaps to the step without binary noise', () => {
    expect(linspace(30, 86, 5, 1)).toEqual([30, 44, 58, 72, 86]);
    expect(linspace(0, 0.3, 4, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(linspace(0, 1, 5, 1)).toEqual([0, 1]); // de-duplicated after snapping
    expect(linspace(5, 5, 1)).toEqual([5]);
  });
});

describe('computeIce', () => {
  it('matches row-by-row scores and reshapes per feature and target', async () => {
    const client = new InferenceClient({ source: { spec: loadModelSpec() } });
    clients.push(client);
    const base = { ...loadCohort().patients[0]!.features, LAD: 1 } as Record<string, number | string>; // leakage key is stripped
    const request = [
      { key: 'Age', values: linspace(30, 86, 8, 1) },
      { key: 'DM', values: [0, 1] },
      { key: 'VHD', values: ['N', 'mild', 'Moderate', 'Severe'] },
    ];
    const strips = await computeIce(client, base, request);
    expect(strips.map((s) => s.feature)).toEqual(['Age', 'DM', 'VHD']);
    const { LAD: _leak, ...clean } = base;
    for (const strip of strips) {
      const expected = iceRows(clean, strip.feature, strip.values).map((row) => model.score(row));
      for (const target of model.targets) {
        expect(strip.probabilities[target]).toEqual(expected.map((e) => e.predictions[target]!.probability));
      }
    }
  });

  it('is cancellable', async () => {
    const client = new InferenceClient({ source: { spec: loadModelSpec() } });
    clients.push(client);
    const controller = new AbortController();
    const pending = computeIce(client, {}, [{ key: 'Age', values: linspace(30, 86, 57, 1) }], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
