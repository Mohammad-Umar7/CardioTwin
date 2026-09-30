import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, sampleSchema } from '@/test/fixtures';
import { MissingAssetError, assetUrl, fetchStaticJson, memoize, schemaResource } from './staticData';

afterEach(() => {
  vi.unstubAllGlobals();
  schemaResource.reset();
});

describe('static artifacts', () => {
  it('resolves asset URLs relative to the document base (sub-path safe)', () => {
    expect(assetUrl('/model/schema.json')).toMatch(/\/model\/schema\.json$/);
  });

  it('treats the SPA index.html fallback as a missing asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } })),
    );
    await expect(fetchStaticJson('model/metrics.json')).rejects.toBeInstanceOf(MissingAssetError);
  });

  it('treats 404 as a missing asset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(fetchStaticJson('model/cohort.json')).rejects.toBeInstanceOf(MissingAssetError);
  });

  it('falls back to GET /api/schema when the static copy is absent', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('/api/schema') ? jsonResponse(sampleSchema) : new Response('', { status: 404 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const schema = await schemaResource.get();
    expect(schema.features.length).toBe(sampleSchema.features.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('memoize joins concurrent loads and forgets failures so a retry can succeed', async () => {
    let calls = 0;
    const memo = memoize(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first try fails');
      return 42;
    });
    await expect(memo.get()).rejects.toThrow('first try fails');
    const [a, b] = await Promise.all([memo.get(), memo.get()]);
    expect([a, b]).toEqual([42, 42]);
    expect(calls).toBe(2);
    expect(memo.peek()).toBe(42);
  });
});
