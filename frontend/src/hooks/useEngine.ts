import { useEffect } from 'react';
import { resolveEngine, type EngineResolution, type PredictionEngine } from '@/services/engine';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';

let resolving: Promise<EngineResolution> | null = null;

/** Resolve the engine once per session and publish it to the stores. Safe to call repeatedly. */
export function ensureEngine(): Promise<EngineResolution> {
  if (!resolving) {
    usePatientStore.getState().setEngine('resolving', null, 'Checking the prediction server…');
    resolving = resolveEngine().then((resolution) => {
      const { engine, health, reason } = resolution;
      useEngineStore.getState().setEngine(engine, health, reason);
      const status = engine.kind === 'server' ? 'server' : engine.available ? 'edge' : 'unavailable';
      usePatientStore.getState().setEngine(status, engine.kind, engine.description);
      return resolution;
    });
  }
  return resolving;
}

/** Test/HMR helper: forget the resolved engine. */
export function resetEngineResolution(): void {
  resolving = null;
}

/** The active prediction engine (null while the health check runs). `enabled: false` skips resolution. */
export function useEngine(options: { enabled?: boolean } = {}): PredictionEngine | null {
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (enabled) void ensureEngine();
  }, [enabled]);
  return useEngineStore((s) => s.engine);
}
