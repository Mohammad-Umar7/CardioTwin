/**
 * Message protocol between `InferenceClient` (main thread) and the inference worker
 * (`workers/inference.worker.ts`). Plain structured-cloneable objects; every request carries an `id`
 * echoed by exactly one response (a `cancel` has no response of its own).
 */
import type { EdgeFeatureInput, EdgePredictResponse, EdgeScore, PortableModelSpec } from './types';

/** Where the worker gets `model.json` from. */
export type ModelSourceMessage = { kind: 'url'; url: string } | { kind: 'spec'; spec: PortableModelSpec };

export interface ModelInfo {
  modelVersion: string;
  targets: string[];
  /** Raw feature keys accepted by the model, in encoding order. */
  features: string[];
  nColumns: number;
  nTrees: number;
  /** Fetch + parse + compile time inside the runtime, ms. */
  loadMs: number;
}

export type InferenceRequest =
  | { id: number; type: 'init'; source: ModelSourceMessage }
  | { id: number; type: 'predict'; features: EdgeFeatureInput }
  | { id: number; type: 'predictBatch'; rows: EdgeFeatureInput[]; explain: boolean }
  | { id: number; type: 'cancel'; target: number };

export interface SerializedError {
  name: string;
  message: string;
  /** `FeatureInputError.features`. */
  features?: string[];
  /** `predictBatch`: index of the row that failed. */
  row?: number;
}

export type InferenceResult = ModelInfo | EdgePredictResponse | EdgePredictResponse[] | EdgeScore[];

export type InferenceResponse =
  | { id: number; ok: true; result: InferenceResult; computeMs: number }
  | { id: number; ok: false; error: SerializedError };
