import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeEngine, type PredictionEngine } from '@/services/engine';
import { usePatientStore } from '@/state/patientStore';
import { samplePrediction } from '@/test/fixtures';
import type { PredictResponse } from '@/types/contracts';
import { usePredictionSync } from './usePrediction';

const withCad = (p: number): PredictResponse => ({
  ...samplePrediction,
  predictions: { ...samplePrediction.predictions, CAD: { ...samplePrediction.predictions.CAD!, probability: p } },
});

function fakeEngine(impl: PredictionEngine['predict']): PredictionEngine {
  return { kind: 'server', available: true, description: 'fake', predict: vi.fn(impl) };
}

beforeEach(() => {
  vi.useFakeTimers();
  usePatientStore.setState({
    features: {},
    recorded: {},
    prediction: null,
    previous: null,
    status: 'idle',
    error: null,
    predictionSeq: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePredictionSync', () => {
  it('debounces input changes and commits the result', async () => {
    const engine = fakeEngine(async () => withCad(0.8));
    renderHook(() => usePredictionSync({ engine, debounceMs: 150 }));
    act(() => usePatientStore.getState().setFeatures({ Age: 60 }));
    act(() => usePatientStore.getState().setFeature('Age', 61));
    act(() => usePatientStore.getState().setFeature('Age', 62));
    expect(usePatientStore.getState().status).toBe('loading');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(engine.predict).toHaveBeenCalledTimes(1);
    expect(engine.predict).toHaveBeenCalledWith({ Age: 62 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(usePatientStore.getState().prediction?.predictions.CAD?.probability).toBe(0.8);
    expect(usePatientStore.getState().status).toBe('ready');
  });

  it('aborts a stale request so an older response can never overwrite a newer one', async () => {
    const resolvers: ((v: PredictResponse) => void)[] = [];
    const signals: AbortSignal[] = [];
    const engine = fakeEngine(
      (_f, opts) =>
        new Promise<PredictResponse>((resolve) => {
          resolvers.push(resolve);
          if (opts?.signal) signals.push(opts.signal);
        }),
    );
    renderHook(() => usePredictionSync({ engine, debounceMs: 10 }));
    act(() => usePatientStore.getState().setFeatures({ Age: 50 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    act(() => usePatientStore.getState().setFeature('Age', 70));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      resolvers[1]?.(withCad(0.9));
      resolvers[0]?.(withCad(0.1)); // stale answer arrives last
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(usePatientStore.getState().prediction?.predictions.CAD?.probability).toBe(0.9);
  });

  it('keeps the last good prediction when a request fails', async () => {
    let call = 0;
    const engine = fakeEngine(async () => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return withCad(0.55);
    });
    renderHook(() => usePredictionSync({ engine, debounceMs: 5 }));
    act(() => usePatientStore.getState().setFeatures({ Age: 50 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => usePatientStore.getState().setFeature('Age', 51));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const state = usePatientStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('boom');
    expect(state.prediction?.predictions.CAD?.probability).toBe(0.55);
  });

  it('reports the edge stub as unavailable instead of inventing numbers', async () => {
    renderHook(() => usePredictionSync({ engine: new EdgeEngine(), debounceMs: 1 }));
    act(() => usePatientStore.getState().setFeatures({ Age: 50 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(usePatientStore.getState().status).toBe('error');
    expect(usePatientStore.getState().prediction).toBeNull();
    expect(usePatientStore.getState().error).toMatch(/in-browser engine/);
  });
});
