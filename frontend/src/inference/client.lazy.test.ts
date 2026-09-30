/**
 * The main-thread fallback imports the evaluator lazily (it is bundled into the worker already). If that
 * chunk cannot be loaded, every request must fail with a clear error instead of hanging.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./handler');
  vi.resetModules();
});

describe('InferenceClient lazy in-process runtime', () => {
  it('rejects ready() and every request when the evaluator chunk fails to load', async () => {
    vi.resetModules();
    vi.doMock('./handler', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { InferenceClient } = await import('./client');
    const client = new InferenceClient({ source: { url: 'http://x/model/model.json' }, runtime: 'main-thread' });
    try {
      const error = await client.ready().catch((e: unknown) => e);
      // (after resetModules the error classes are fresh instances, so match by name)
      expect(error).toMatchObject({ name: 'ModelFormatError' });
      expect((error as Error).message).toMatch(/^The in-browser engine could not be loaded: ./); // (vitest wraps the factory error)
      await expect(client.predict({ Age: 50 })).rejects.toThrow(/could not be loaded/);
      await expect(client.predictBatch([{ Age: 50 }])).rejects.toThrow(/could not be loaded/);
    } finally {
      client.dispose();
    }
  });
});
