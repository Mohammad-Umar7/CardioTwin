import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, sampleHealth, samplePrediction } from '@/test/fixtures';
import { ApiError, NetworkError, createApiClient } from './api';
import {
  EdgeEngine,
  EngineUnavailableError,
  ServerEngine,
  assertPredictResponse,
  resolveEngine,
  sanitizeFeatures,
} from './engine';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerEngine', () => {
  it('predicts through POST /api/predict with mocked fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(samplePrediction));
    vi.stubGlobal('fetch', fetchMock);
    const engine = new ServerEngine(createApiClient(''), sampleHealth);
    expect(engine.kind).toBe('server');
    expect(engine.description).toContain('model 1.0.0');
    const result = await engine.predict({ Age: 62, LAD: 1, Cath: 'Cad' } as never);
    expect(result.predictions.LAD?.probability).toBe(0.72);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as { features: object };
    // leakage keys never leave the browser
    expect(body.features).toEqual({ Age: 62 });
  });

  it('rejects malformed responses instead of rendering them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ predictions: { CAD: { probability: 7 } } })));
    const engine = new ServerEngine(createApiClient(''));
    await expect(engine.predict({})).rejects.toBeInstanceOf(ApiError);
  });

  it('forwards the abort signal', async () => {
    const predict = vi.fn().mockResolvedValue(samplePrediction);
    const controller = new AbortController();
    await new ServerEngine({ predict }).predict({ Age: 50 }, { signal: controller.signal });
    expect(predict).toHaveBeenCalledWith({ Age: 50 }, { signal: controller.signal });
  });
});

describe('EdgeEngine without a portable model', () => {
  it('is honest about being unavailable', async () => {
    const edge = new EdgeEngine();
    expect(edge.kind).toBe('edge');
    expect(edge.available).toBe(false);
    await expect(edge.predict({})).rejects.toBeInstanceOf(EngineUnavailableError);
  });
});

describe('resolveEngine', () => {
  it('picks the server when /api/health answers ok', async () => {
    const client = { health: vi.fn().mockResolvedValue(sampleHealth), predict: vi.fn() };
    const res = await resolveEngine({ client, override: null });
    expect(res.engine.kind).toBe('server');
    expect(res.health?.model_version).toBe('1.0.0');
    expect(client.health).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: expect.any(Number) }));
  });

  it('falls back to the edge engine when the server is unreachable', async () => {
    const client = { health: vi.fn().mockRejectedValue(new NetworkError('down')), predict: vi.fn() };
    const res = await resolveEngine({ client, timeoutMs: 10, createEdge: () => new EdgeEngine(), override: null });
    expect(res.engine.kind).toBe('edge');
    expect(res.health).toBeNull();
  });

  it('uses a custom edge factory (phase-2 plug-in point)', async () => {
    const client = { health: vi.fn().mockRejectedValue(new NetworkError('down')), predict: vi.fn() };
    const custom = { kind: 'edge' as const, available: true, description: 'custom', predict: vi.fn() };
    const res = await resolveEngine({ client, createEdge: () => custom });
    expect(res.engine).toBe(custom);
  });
});

describe('helpers', () => {
  it('sanitizeFeatures drops leakage keys and non-finite values', () => {
    expect(sanitizeFeatures({ Age: 60, RCA: 1, LCX: 0, BP: Number.NaN, Sex: 'Male' })).toEqual({ Age: 60, Sex: 'Male' });
  });

  it('assertPredictResponse accepts the contract example', () => {
    expect(() => assertPredictResponse(samplePrediction)).not.toThrow();
    expect(() => assertPredictResponse(null)).toThrow(ApiError);
  });
});
