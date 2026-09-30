/**
 * Patient state: which patient is loaded, the current (possibly edited) features, and the latest
 * prediction. Schema-agnostic: features are keyed by raw dataset column names (CONTRACTS §0).
 *
 * `prediction` always holds the last GOOD response; while a new request runs, `status` is 'loading'
 * and the UI shows the previous numbers as stale ("updating") — never a stale value as current.
 */
import { create } from 'zustand';
import type {
  CohortPatient,
  EngineKind,
  FeatureValue,
  FeatureVector,
  PredictResponse,
} from '@/types/contracts';

export type PatientMode = 'cohort' | 'custom';
export type PredictionStatus = 'idle' | 'loading' | 'ready' | 'error';
/**
 * resolving   — health check in flight
 * server      — FastAPI answering (Server ✓)
 * edge        — in-browser engine active (server offline)
 * unavailable — no engine can produce estimates (server offline and edge engine stubbed)
 */
export type EngineStatus = 'resolving' | 'server' | 'edge' | 'unavailable';

export interface PatientState {
  selectedPatientId: string | null;
  split: string | null;
  mode: PatientMode;
  /** Features as recorded for the cohort patient (or the schema defaults in Custom mode). */
  recorded: FeatureVector;
  /** Current inputs = recorded + what-if edits. */
  features: FeatureVector;
  /** Last good prediction for `features` (or for an earlier input while status is 'loading'). */
  prediction: PredictResponse | null;
  /** The good prediction before `prediction`, for delta chips ("▲ +12 pts"). */
  previous: PredictResponse | null;
  /** Pinned A/B baseline: deltas persist as "was → now" while set. */
  baseline: PredictResponse | null;
  status: PredictionStatus;
  error: string | null;
  /** Increments on every committed prediction; lets effects react to "a new result arrived". */
  predictionSeq: number;
  engineKind: EngineKind | null;
  engineStatus: EngineStatus;
  engineDescription: string;
  latencyMs: number | null;
  /** Ground truth revealed (TEST patients only). */
  revealed: boolean;

  loadPatient(patient: CohortPatient): void;
  startCustom(defaults: FeatureVector): void;
  setFeature(key: string, value: FeatureValue): void;
  resetFeature(key: string): void;
  resetAll(): void;
  setFeatures(features: FeatureVector): void;
  predictionStarted(): void;
  predictionSucceeded(prediction: PredictResponse, latencyMs: number): void;
  predictionFailed(message: string): void;
  setEngine(status: EngineStatus, kind: EngineKind | null, description: string): void;
  pinBaseline(): void;
  clearBaseline(): void;
  setRevealed(revealed: boolean): void;
}

const sameValue = (a: FeatureValue | undefined, b: FeatureValue | undefined) =>
  a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** Keys whose current value differs from the recorded value. */
export function editedKeys(features: FeatureVector, recorded: FeatureVector): string[] {
  const keys = new Set([...Object.keys(features), ...Object.keys(recorded)]);
  return [...keys].filter((k) => !sameValue(features[k], recorded[k]));
}

export const usePatientStore = create<PatientState>()((set, get) => ({
  selectedPatientId: null,
  split: null,
  mode: 'cohort',
  recorded: {},
  features: {},
  prediction: null,
  previous: null,
  baseline: null,
  status: 'idle',
  error: null,
  predictionSeq: 0,
  engineKind: null,
  engineStatus: 'resolving',
  engineDescription: 'Checking the prediction server…',
  latencyMs: null,
  revealed: false,

  loadPatient(patient) {
    set({
      selectedPatientId: patient.id,
      split: patient.split,
      mode: 'cohort',
      recorded: { ...patient.features },
      features: { ...patient.features },
      baseline: null,
      revealed: false,
      error: null,
    });
  },

  startCustom(defaults) {
    const { features } = get();
    const start = Object.keys(features).length > 0 ? features : defaults;
    set({
      selectedPatientId: null,
      split: null,
      mode: 'custom',
      recorded: { ...defaults },
      features: { ...start },
      baseline: null,
      revealed: false,
    });
  },

  setFeature(key, value) {
    set((s) => ({ features: { ...s.features, [key]: value } }));
  },

  resetFeature(key) {
    set((s) => {
      const next = { ...s.features };
      if (key in s.recorded) next[key] = s.recorded[key] as FeatureValue;
      else delete next[key];
      return { features: next };
    });
  },

  resetAll() {
    set((s) => ({ features: { ...s.recorded } }));
  },

  setFeatures(features) {
    set({ features: { ...features } });
  },

  predictionStarted() {
    set({ status: 'loading' });
  },

  predictionSucceeded(prediction, latencyMs) {
    set((s) => ({
      previous: s.prediction,
      prediction,
      status: 'ready',
      error: null,
      latencyMs,
      predictionSeq: s.predictionSeq + 1,
      engineKind: prediction.engine,
    }));
  },

  predictionFailed(message) {
    set({ status: 'error', error: message });
  },

  setEngine(engineStatus, engineKind, engineDescription) {
    set({ engineStatus, engineKind, engineDescription });
  },

  pinBaseline() {
    const { prediction } = get();
    if (prediction) set({ baseline: prediction });
  },

  clearBaseline() {
    set({ baseline: null });
  },

  setRevealed(revealed) {
    set({ revealed });
  },
}));
