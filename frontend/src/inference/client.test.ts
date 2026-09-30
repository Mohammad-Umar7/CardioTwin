import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BatchRowError, InferenceClient } from './client';
import { FeatureInputError, ModelFormatError } from './errors';
import { createInferenceHandler } from './handler';
import { EdgeModel } from './model';
import type { InferenceRequest, InferenceResponse } from './protocol';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import type { PortableModelSpec } from './types';

let spec: PortableModelSpec;
let reference: EdgeModel;
const clients: InferenceClient[] = [];

beforeAll(() => {
  spec = loadModelSpec();
  reference = new EdgeModel(loadModelSpec());
});

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  vi.unstubAllGlobals();
});

function track(client: InferenceClient): InferenceClient {
  clients.push(client);
  return client;
}

/**
 * Minimal stand-in for a module Worker: structured-clones every message both ways (like the real
 * boundary) and runs the production handler. `crashAfter` simulates a worker dying after N answers.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<InferenceResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  terminated = false;
  answered = 0;
  private readonly handler = createInferenceHandler();
  constructor(private readonly crashAfter = Number.POSITIVE_INFINITY) {}

  postMessage(message: InferenceRequest) {
    const request = structuredClone(message);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (request.type !== 'cancel' && this.answered >= this.crashAfter) {
        this.onerror?.(new Event('error'));
        return;
      }
      void this.handler.handle(request).then((response) => {
        if (!response || this.terminated) return;
        this.answered += 1;
        this.onmessage?.({ data: structuredClone(response) } as MessageEvent<InferenceResponse>);
      });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

const patients = () => loadCohort().patients;

describe('InferenceClient (in-process runtime, as in jsdom)', () => {
  it('loads the model and reports its metadata', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    expect(client.runtime).toBe('main-thread');
    const info = await client.ready();
    expect(info.modelVersion).toBe(spec.model_version);
    expect(info.targets).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
    expect(info.features).toHaveLength(spec.features.length);
    expect(info.nColumns).toBe(spec.columns.length);
    expect(info.nTrees).toBeGreaterThan(500);
    expect(client.modelInfo).toEqual(info);
  });

  it('predict() equals the synchronous model', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    const patient = patients()[0]!;
    await expect(client.predict(patient.features)).resolves.toEqual(reference.predict(patient.features));
    expect(client.lastComputeMs).toBeGreaterThanOrEqual(0);
  });

  it('predictBatch() returns scores (default) or full explanations in row order', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    const rows = patients()
      .slice(0, 12)
      .map((p) => p.features);
    const scores = await client.predictBatch(rows);
    expect(scores).toEqual(rows.map((r) => reference.score(r)));
    const full = await client.predictBatch(rows, { explain: true });
    expect(full).toEqual(rows.map((r) => reference.predict(r)));
    await expect(client.predictBatch([])).resolves.toEqual([]);
  });

  it('names the failing row of a batch', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    const rows = [{ Age: 50 }, { Age: 60 }, { Age: 'old' }];
    const error = await client.predictBatch(rows).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchRowError);
    expect(error).toBeInstanceOf(FeatureInputError);
    expect((error as BatchRowError).row).toBe(2);
    expect((error as BatchRowError).features).toEqual(['Age']);
  });

  it('rejects bad input with FeatureInputError and keeps serving', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    await expect(client.predict({ Nope: 1 })).rejects.toBeInstanceOf(FeatureInputError);
    await expect(client.predict({ Age: 70 })).resolves.toMatchObject({ engine: 'edge' });
  });

  it('aborts: before sending, and in the middle of a long batch', async () => {
    const client = track(new InferenceClient({ source: { spec } }));
    await client.ready();
    const early = new AbortController();
    early.abort();
    await expect(client.predict({}, { signal: early.signal })).rejects.toMatchObject({ name: 'AbortError' });

    const controller = new AbortController();
    const rows = Array.from({ length: 5000 }, (_, i) => ({ Age: 30 + (i % 50) }));
    const pending = client.predictBatch(rows, { explain: true, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // The client keeps working after a cancellation.
    await expect(client.predict({ Age: 44 })).resolves.toEqual(reference.predict({ Age: 44 }));
  });

  it('loads from a URL and treats an HTML fallback page as a missing model', async () => {
    const json = JSON.stringify(spec);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(json, { status: 200 })));
    const ok = track(new InferenceClient({ source: { url: 'http://x/model/model.json' } }));
    await expect(ok.ready()).resolves.toMatchObject({ modelVersion: spec.model_version });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', { status: 200 })));
    const html = track(new InferenceClient({ source: { url: 'http://x/model/model.json' } }));
    await expect(html.ready()).rejects.toBeInstanceOf(ModelFormatError);
    await expect(html.predict({})).rejects.toBeInstanceOf(ModelFormatError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    const missing = track(new InferenceClient({ source: { url: 'http://x/model/model.json' } }));
    await expect(missing.ready()).rejects.toThrow(/HTTP 404/);
  });

  it('rejects an invalid model', async () => {
    const bad = { ...spec, format: 'something-else' };
    const client = track(new InferenceClient({ source: { spec: bad } }));
    await expect(client.ready()).rejects.toThrow(/unexpected format/);
  });

  it('dispose() rejects pending work and later calls', async () => {
    const client = new InferenceClient({ source: { spec } });
    const pending = client.predict({ Age: 50 });
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    await expect(client.predict({})).rejects.toThrow(/disposed/);
  });
});

describe('InferenceClient (worker runtime)', () => {
  it('round-trips through a worker boundary (structured clone) with identical results', async () => {
    const client = track(new InferenceClient({ source: { spec }, runtime: 'worker', createWorker: () => new FakeWorker() as unknown as Worker }));
    expect(client.runtime).toBe('worker');
    const rows = patients()
      .slice(0, 5)
      .map((p) => p.features);
    await expect(client.predict(rows[0]!)).resolves.toEqual(reference.predict(rows[0]!));
    await expect(client.predictBatch(rows)).resolves.toEqual(rows.map((r) => reference.score(r)));
  });

  it('falls back to the main thread when the worker cannot be created', async () => {
    const client = track(
      new InferenceClient({
        source: { spec },
        runtime: 'worker',
        createWorker: () => {
          throw new Error('CSP: worker-src none');
        },
      }),
    );
    expect(client.runtime).toBe('main-thread');
    await expect(client.predict({ Age: 61 })).resolves.toEqual(reference.predict({ Age: 61 }));
  });

  it('re-initialises in-process and replays pending requests when the worker crashes', async () => {
    const worker = new FakeWorker(1); // answers init, then dies
    const client = track(new InferenceClient({ source: { spec }, runtime: 'worker', createWorker: () => worker as unknown as Worker }));
    await client.ready();
    const result = await client.predict({ Age: 72, DM: 1 });
    expect(result).toEqual(reference.predict({ Age: 72, DM: 1 }));
    expect(worker.terminated).toBe(true);
    expect(client.runtime).toBe('main-thread');
  });

  it('replays the init itself when the worker fails to start', async () => {
    const worker = new FakeWorker(0);
    const client = track(new InferenceClient({ source: { spec }, runtime: 'worker', createWorker: () => worker as unknown as Worker }));
    await expect(client.ready()).resolves.toMatchObject({ modelVersion: spec.model_version });
    expect(client.runtime).toBe('main-thread');
  });
});
