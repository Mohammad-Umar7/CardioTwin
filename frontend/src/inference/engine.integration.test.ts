/**
 * `services/engine.ts` with the real edge engine: EdgeEngine over an InferenceClient, the URL override,
 * resolveEngine's fallbacks and the ServerEngine's runtime failover to the edge.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, TimeoutError } from '@/services/api';
import {
  EdgeEngine,
  EngineUnavailableError,
  ServerEngine,
  isServerDownError,
  readEngineOverride,
  resolveEngine,
} from '@/services/engine';
import { sampleHealth } from '@/test/fixtures';
import type { FixturesFile, PredictResponse } from '@/types/contracts';
import { InferenceClient } from './client';
import { compareResponses } from './parity';
import { loadFixtures, loadModelSpec } from './testing/artifacts';

let fixtures: FixturesFile;
const clients: InferenceClient[] = [];

beforeAll(() => {
  fixtures = loadFixtures();
});

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
});

function realEdge(): EdgeEngine {
  const client = new InferenceClient({ source: { spec: loadModelSpec() } });
  clients.push(client);
  return new EdgeEngine({ client });
}

function brokenEdge(): EdgeEngine {
  const client = new InferenceClient({ source: { spec: { format: 'nope' } as never } });
  clients.push(client);
  return new EdgeEngine({ client });
}

describe('EdgeEngine', () => {
  it('becomes available once the model is loaded and reproduces the fixtures', async () => {
    const edge = realEdge();
    expect(edge.status).toBe('loading');
    expect(edge.available).toBe(false);
    await expect(edge.ready()).resolves.toBe(true);
    expect(edge.available).toBe(true);
    expect(edge.description).toMatch(/In-browser engine · model 1\.1\.0 · main thread/);
    expect(edge.modelInfo?.modelVersion).toBe(fixtures.model_version);
    expect(edge.inference).not.toBeNull();
    for (const fixture of fixtures.cases) {
      const response = await edge.predict(fixture.features);
      expect(response.engine).toBe('edge');
      expect(compareResponses(response, fixture.expected).mismatches).toEqual([]);
    }
  });

  it('drops leakage keys like the server engine does', async () => {
    const edge = realEdge();
    const clean = await edge.predict({ Age: 61 });
    await expect(edge.predict({ Age: 61, LAD: 1, Cath: 'Cad' } as never)).resolves.toEqual(clean);
  });

  it('reports invalid inputs as a 422, worded like the server', async () => {
    const edge = realEdge();
    const error = await edge.predict({ Age: 'old' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toMatch(/Age: expected a number/);
  });

  it('is honestly unavailable when the model cannot be loaded', async () => {
    const edge = brokenEdge();
    await expect(edge.ready()).resolves.toBe(false);
    expect(edge.status).toBe('failed');
    expect(edge.description).toMatch(/unavailable/);
    await expect(edge.predict({})).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(edge.inference).toBeNull();
  });

  it('without a client it has no model at all', async () => {
    const edge = new EdgeEngine();
    expect(edge.status).toBe('absent');
    await expect(edge.ready()).resolves.toBe(false);
    await expect(edge.predict({})).rejects.toThrow(/in-browser engine has no portable model/);
  });
});

describe('readEngineOverride', () => {
  it.each([
    [{ search: '?engine=edge', hash: '' }, 'edge'],
    [{ search: '', hash: '#/workstation?engine=edge' }, 'edge'],
    [{ search: '', hash: '#/workstation/P-017?tab=why&engine=SERVER' }, 'server'],
    [{ search: '?engine=server', hash: '#/?engine=edge' }, 'edge'], // the hash route wins
    [{ search: '?engine=gpu', hash: '' }, null],
    [{ search: '', hash: '#/workstation' }, null],
  ] as const)('%j → %s', (location, expected) => {
    expect(readEngineOverride(location)).toBe(expected);
  });
});

describe('resolveEngine', () => {
  const up = () => ({ health: vi.fn().mockResolvedValue(sampleHealth), predict: vi.fn() });
  const down = () => ({ health: vi.fn().mockRejectedValue(new NetworkError('down')), predict: vi.fn() });

  it('server up → ServerEngine that can fail over to the edge', async () => {
    const res = await resolveEngine({ client: up(), createEdge: realEdge, override: null });
    expect(res.engine).toBeInstanceOf(ServerEngine);
    expect(res.override).toBeNull();
  });

  it('server down → a ready edge engine', async () => {
    const res = await resolveEngine({ client: down(), createEdge: realEdge, override: null, timeoutMs: 10 });
    expect(res.engine.kind).toBe('edge');
    expect(res.engine.available).toBe(true);
    expect(res.reason).toMatch(/unreachable/);
  });

  it('server down and model missing → edge reported unavailable (never invented numbers)', async () => {
    const res = await resolveEngine({ client: down(), createEdge: brokenEdge, override: null, timeoutMs: 10 });
    expect(res.engine.kind).toBe('edge');
    expect(res.engine.available).toBe(false);
  });

  it('?engine=edge forces the edge but still probes the server for cross-checks', async () => {
    const client = up();
    const res = await resolveEngine({ client, createEdge: realEdge, override: 'edge' });
    expect(res.engine.kind).toBe('edge');
    expect(res.engine.available).toBe(true);
    expect(res.health).toEqual(sampleHealth);
    expect(res.override).toBe('edge');
    expect(res.reason).toMatch(/forced by \?engine=edge; the server is used for cross-checks/);
  });

  it('?engine=server forces the server even when it is down (no silent fallback)', async () => {
    const createEdge = vi.fn(realEdge);
    const res = await resolveEngine({ client: down(), createEdge, override: 'server', timeoutMs: 10 });
    expect(res.engine.kind).toBe('server');
    expect(res.health).toBeNull();
    expect(res.reason).toMatch(/unreachable/);
    expect(createEdge).not.toHaveBeenCalled();
  });

  it('reads the override from the URL by default', async () => {
    window.history.replaceState(null, '', '/#/workstation?engine=edge');
    try {
      const res = await resolveEngine({ client: up(), createEdge: realEdge });
      expect(res.override).toBe('edge');
      expect(res.engine.kind).toBe('edge');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});

describe('ServerEngine failover', () => {
  const serverResponse = (): PredictResponse => ({ ...fixtures.cases[0]!.expected, engine: 'server' });

  it('classifies outages vs bad requests', () => {
    expect(isServerDownError(new NetworkError('x'))).toBe(true);
    expect(isServerDownError(new TimeoutError(10))).toBe(true);
    expect(isServerDownError(new ApiError(503, 'model_not_loaded', 'x'))).toBe(true);
    expect(isServerDownError(new ApiError(422, 'validation_error', 'x'))).toBe(false);
    expect(isServerDownError(new ApiError(502, 'invalid_response', 'x'))).toBe(false);
    expect(isServerDownError(new Error('x'))).toBe(false);
  });

  it('answers from the edge while the server is down, then returns to the server', async () => {
    const predict = vi.fn().mockRejectedValue(new NetworkError('ECONNREFUSED'));
    const engine = new ServerEngine({ predict }, sampleHealth, { fallback: realEdge, retryAfterMs: 50 });
    const features = fixtures.cases[0]!.features;

    const first = await engine.predict(features);
    expect(first.engine).toBe('edge');
    expect(engine.failedOver).toBe(true);
    expect(compareResponses(first, fixtures.cases[0]!.expected).agree).toBe(true);

    // Within the retry window the server is not hammered.
    await engine.predict(features);
    expect(predict).toHaveBeenCalledTimes(1);

    // After the window the server is tried again and wins once it is back.
    await new Promise((r) => setTimeout(r, 60));
    predict.mockResolvedValue(serverResponse());
    const back = await engine.predict(features);
    expect(back.engine).toBe('server');
    expect(engine.failedOver).toBe(false);
  });

  it('does not fail over on validation errors or aborts', async () => {
    const invalid = new ApiError(422, 'validation_error', 'Age out of range');
    const engine = new ServerEngine({ predict: vi.fn().mockRejectedValue(invalid) }, sampleHealth, { fallback: realEdge });
    await expect(engine.predict({ Age: 200 })).rejects.toBe(invalid);

    const controller = new AbortController();
    controller.abort();
    const aborting = new ServerEngine({ predict: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) }, sampleHealth, {
      fallback: realEdge,
    });
    await expect(aborting.predict({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces the server error when the edge cannot help either', async () => {
    const outage = new NetworkError('down');
    const engine = new ServerEngine({ predict: vi.fn().mockRejectedValue(outage) }, sampleHealth, { fallback: brokenEdge });
    await expect(engine.predict({})).rejects.toBe(outage);
  });
});
