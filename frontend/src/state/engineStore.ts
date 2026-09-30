/**
 * The active PredictionEngine instance (not serialisable, so it lives outside patientStore, which only
 * mirrors its status for the UI). Set once per session by hooks/useEngine.
 */
import { create } from 'zustand';
import type { PredictionEngine } from '@/services/engine';
import type { HealthResponse } from '@/types/contracts';

export interface EngineState {
  engine: PredictionEngine | null;
  health: HealthResponse | null;
  reason: string;
  setEngine(engine: PredictionEngine, health: HealthResponse | null, reason: string): void;
}

export const useEngineStore = create<EngineState>()((set) => ({
  engine: null,
  health: null,
  reason: '',
  setEngine: (engine, health, reason) => set({ engine, health, reason }),
}));
