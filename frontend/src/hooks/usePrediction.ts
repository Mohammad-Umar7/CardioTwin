import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { describeApiError, isAbortError } from '@/services/api';
import { EngineUnavailableError, type PredictionEngine } from '@/services/engine';
import { usePatientStore } from '@/state/patientStore';
import { useEngine } from './useEngine';

export const PREDICTION_DEBOUNCE_MS = 150;

/**
 * Keeps `patientStore.prediction` in sync with `patientStore.features`.
 *   - debounced (~150 ms) so dragging a slider does not flood the server;
 *   - every new input aborts the in-flight request (no stale response can land after a newer one);
 *   - the last good result is kept while the next one loads (status 'loading' → UI shows "updating").
 * Mount it ONCE (features/shell/PredictionController); components read the store.
 */
export function usePredictionSync(options: { debounceMs?: number; engine?: PredictionEngine | null } = {}): void {
  const resolved = useEngine({ enabled: options.engine === undefined });
  const engine = options.engine === undefined ? resolved : options.engine;
  const debounceMs = options.debounceMs ?? PREDICTION_DEBOUNCE_MS;
  const features = usePatientStore((s) => s.features);

  useEffect(() => {
    if (!engine || Object.keys(features).length === 0) return;
    const store = usePatientStore.getState();
    const controller = new AbortController();
    store.predictionStarted();
    const timer = setTimeout(() => {
      const t0 = performance.now();
      engine.predict(features, { signal: controller.signal }).then(
        (prediction) => {
          if (!controller.signal.aborted) usePatientStore.getState().predictionSucceeded(prediction, performance.now() - t0);
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          const message =
            error instanceof EngineUnavailableError ? error.message : describeApiError(error);
          usePatientStore.getState().predictionFailed(message);
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [engine, features, debounceMs]);
}

/** Read-only view of the current prediction for components. */
export function usePrediction() {
  return usePatientStore(
    useShallow((s) => ({
      prediction: s.prediction,
      previous: s.previous,
      baseline: s.baseline,
      status: s.status,
      error: s.error,
      latencyMs: s.latencyMs,
      seq: s.predictionSeq,
    })),
  );
}
