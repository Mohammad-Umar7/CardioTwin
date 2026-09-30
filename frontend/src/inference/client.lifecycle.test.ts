/**
 * Adversarial worker lifecycle: crashes mid-batch, undeliverable messages, uncloneable inputs, aborts
 * racing a crash, stale responses and a model that fails to load once. Every request must settle exactly
 * once, with the right answer or a clear error, and nothing may stay pending.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InferenceClient } from './client';
import { createInferenceHandler } from './handler';
import { EdgeModel } from './model';
import type { InferenceRequest, InferenceResponse } from './protocol';
import { getSharedInferenceClient, resetSharedInferenceClient } from './shared';
import { loadCohort, loadModelSpec } from './testing/artifacts';
import type { EdgeFeatureInput, PortableModelSpec } from './types';

let spec: PortableModelSpec;
let reference: EdgeModel;
const clients: InferenceClient[] = [];

beforeAll(() => {
  spec = loadModelSpec();
  reference = new EdgeModel(loadModelSpec());
});

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  resetSharedInferenceClient();
  vi.unstubAllGlobals();
});

type Fault = 'crash' | 'messageerror' | null;

/**
 * A module-Worker stand-in with scripted faults: `fault(request, index)` decides, per incoming request,
 * whether the worker crashes (error event, no answer) or answers with an undeliverable message
 * (messageerror). Messages are structured-cloned both ways, like the real boundary.
 */
class ScriptedWorker {
  onmessage: ((event: MessageEvent<InferenceResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  terminated = false;
  received: InferenceRequest[] = [];
  private readonly handler = createInferenceHandler();

  constructor(private readonly fault: (request: InferenceRequest, index: number) => Fault = () => null) {}

  postMessage(message: InferenceRequest) {
    const request = structuredClone(message); // throws DataCloneError like the real postMessage
    const index = this.received.push(request) - 1;
    queueMicrotask(() => {
      if (this.terminated) return;
      const fault = this.fault(request, index);
      if (fault === 'crash') {
        this.onerror?.(new Event('error'));
        return;
      }
      void this.handler.handle(request).then((response) => {
        if (!response || this.terminated) return;
        if (fault === 'messageerror') this.onmessageerror?.(new Event('messageerror'));
        else this.onmessage?.({ data: structuredClone(response) } as MessageEvent<InferenceResponse>);
      });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

function workerClient(worker: ScriptedWorker): InferenceClient {
  const client = new InferenceClient({ source: { spec }, runtime: 'worker', createWorker: () => worker as unknown as Worker });
  clients.push(client);
  return client;
}

const pendingCount = (client: InferenceClient) => (client as unknown as { pending: Map<number, unknown> }).pending.size;
const rows = (n: number) => loadCohort().patients.slice(0, n).map((p) => p.features);

describe('InferenceClient under worker faults', () => {
  it('rejects an uncloneable input at once and does not leave it pending (or replay it after a crash)', async () => {
    let crashNext = false;
    const worker = new ScriptedWorker(() => (crashNext ? 'crash' : null));
    const client = workerClient(worker);
    await client.ready();
    const bad = { Age: (() => 61) as unknown as number } as EdgeFeatureInput;
    await expect(client.predict(bad)).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(pendingCount(client)).toBe(0);
    crashNext = true;
    await expect(client.predict({ Age: 61 })).resolves.toEqual(reference.predict({ Age: 61 }));
    expect(client.runtime).toBe('main-thread');
    expect(pendingCount(client)).toBe(0);
  });

  it('replays a batch in-process when the worker dies on it', async () => {
    const worker = new ScriptedWorker((r) => (r.type === 'predictBatch' ? 'crash' : null));
    const client = workerClient(worker);
    const input = rows(12);
    await expect(client.predictBatch(input, { explain: true })).resolves.toEqual(input.map((r) => reference.predict(r)));
    expect(worker.terminated).toBe(true);
  });

  it('recovers from an undeliverable response (messageerror)', async () => {
    const worker = new ScriptedWorker((r) => (r.type === 'predict' ? 'messageerror' : null));
    const client = workerClient(worker);
    await expect(client.predict({ DM: 1 })).resolves.toEqual(reference.predict({ DM: 1 }));
    expect(client.runtime).toBe('main-thread');
  });

  it('answers 20 concurrent requests correctly and in order across a crash', async () => {
    const worker = new ScriptedWorker((_r, i) => (i === 6 ? 'crash' : null));
    const client = workerClient(worker);
    await client.ready();
    const inputs = Array.from({ length: 20 }, (_, i) => ({ Age: 30 + 2 * i, HTN: i % 2 }));
    const order: number[] = [];
    const results = await Promise.all(inputs.map((x, i) => client.predict(x).then((r) => (order.push(i), r))));
    results.forEach((r, i) => expect(r).toEqual(reference.predict(inputs[i]!)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(pendingCount(client)).toBe(0);
  });

  it('keeps an aborted request aborted when a crash replays the others', async () => {
    const worker = new ScriptedWorker((r) => (r.type === 'predict' ? 'crash' : null));
    const client = workerClient(worker);
    await client.ready();
    const controller = new AbortController();
    const aborted = client.predict({ Age: 40 }, { signal: controller.signal });
    const kept = client.predict({ Age: 41 });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await expect(kept).resolves.toEqual(reference.predict({ Age: 41 }));
    expect(pendingCount(client)).toBe(0);
  });

  it('ignores responses nobody is waiting for', async () => {
    const worker = new ScriptedWorker();
    const client = workerClient(worker);
    await client.ready();
    worker.onmessage?.({ data: { id: 9999, ok: true, result: [], computeMs: 0 } } as MessageEvent<InferenceResponse>);
    await expect(client.predict({ Age: 50 })).resolves.toEqual(reference.predict({ Age: 50 }));
  });

  it('aborts at once while model.json is still loading (a stalled download must not swallow the abort)', async () => {
    let release: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const client = new InferenceClient({ source: { url: 'http://x/model/model.json' }, runtime: 'main-thread' });
    clients.push(client);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const controller = new AbortController();
    const batch = client.predictBatch(rows(3), { signal: controller.signal });
    const single = client.predict({ Age: 70 }, { signal: controller.signal });
    controller.abort();
    // Rejected before the model arrives.
    await expect(batch).rejects.toMatchObject({ name: 'AbortError' });
    await expect(single).rejects.toMatchObject({ name: 'AbortError' });
    release!(new Response(JSON.stringify(spec), { status: 200 }));
    await expect(client.predict({})).resolves.toEqual(reference.predict({}));
    expect(pendingCount(client)).toBe(0);
  });
});

describe('shared client', () => {
  it('starts over after the model failed to load once (transient outage)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })));
    const first = getSharedInferenceClient();
    await expect(first.ready()).rejects.toThrow(/HTTP 503/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(spec), { status: 200 })));
    const second = getSharedInferenceClient();
    expect(second).not.toBe(first);
    await expect(second.predict({ Age: 66 })).resolves.toEqual(reference.predict({ Age: 66 }));
    expect(getSharedInferenceClient()).toBe(second);
  });
});
