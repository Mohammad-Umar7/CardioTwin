import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, sampleHealth, samplePrediction } from '@/test/fixtures';
import { ApiError, NetworkError, TimeoutError, createApiClient, describeApiError, normaliseBaseUrl } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api client', () => {
  it('builds same-origin /api URLs by default and honours VITE_API_URL-style bases', () => {
    expect(createApiClient('').url('/health')).toBe('/api/health');
    expect(createApiClient('https://ct.example.org/').url('predict')).toBe('https://ct.example.org/api/predict');
    expect(normaliseBaseUrl('  http://x:8000///  ')).toBe('http://x:8000');
  });

  it('POSTs raw features to /api/predict and returns the typed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(samplePrediction));
    vi.stubGlobal('fetch', fetchMock);
    const client = createApiClient('');
    const out = await client.predict({ Age: 62, 'Typical Chest Pain': 1 });
    expect(out.predictions.CAD?.probability).toBe(0.87);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/predict');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ features: { Age: 62, 'Typical Chest Pain': 1 } });
  });

  it('maps contract error bodies to ApiError with code, status and request id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'validation_error',
            message: 'Invalid features',
            detail: [{ type: 'value_error', loc: ['features', 'Age'], msg: 'Age must be between 30 and 86' }],
            request_id: 'req-1',
          },
          { status: 422 },
        ),
      ),
    );
    const client = createApiClient('');
    const error = await client.predict({ Age: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).code).toBe('validation_error');
    expect((error as ApiError).requestId).toBe('req-1');
    expect(describeApiError(error)).toContain('Age must be between 30 and 86');
  });

  it('wraps connection failures as NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(createApiClient('').health()).rejects.toBeInstanceOf(NetworkError);
  });

  it('times out slow requests with TimeoutError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    await expect(createApiClient('').health({ timeoutMs: 20 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates caller aborts as AbortError, not as a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const controller = new AbortController();
    const pending = createApiClient('').health({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reads the health payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(sampleHealth)));
    await expect(createApiClient('').health()).resolves.toMatchObject({ status: 'ok', engine: 'server' });
  });
});
