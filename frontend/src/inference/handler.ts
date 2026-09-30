/**
 * Runtime-agnostic request handler: the body of the inference worker. `InferenceClient` runs the very
 * same handler in-process when Web Workers are unavailable (tests, CSP, file://), so both paths share
 * one implementation.
 *
 * Batches are evaluated in time slices (default 8 ms) with a macrotask yield in between, so a `cancel`
 * for a superseded ICE sweep takes effect mid-batch instead of after it.
 */
import { FeatureInputError, ModelFormatError } from './errors';
import { compileModel, type EdgeModel } from './model';
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceResult,
  ModelInfo,
  ModelSourceMessage,
  SerializedError,
} from './protocol';
import type { EdgePredictResponse, EdgeScore } from './types';

type WorkRequest = Exclude<InferenceRequest, { type: 'cancel' }>;

export interface InferenceHandler {
  /** Resolves with the response for `request` (`null` for `cancel`, which has none). */
  handle(request: InferenceRequest): Promise<InferenceResponse | null>;
}

export interface HandlerOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Compute budget between yields during a batch, ms. */
  sliceMs?: number;
}

/** Wraps the error of one batch row so the response can name the row. */
class RowError extends Error {
  readonly row: number;
  readonly original: unknown;
  constructor(row: number, original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.row = row;
    this.original = original;
  }
}

class CancelledError extends Error {
  constructor() {
    super('The request was cancelled.');
    this.name = 'AbortError';
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof RowError) return { ...serializeError(error.original), row: error.row };
  if (error instanceof FeatureInputError) return { name: error.name, message: error.message, features: error.features };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

/** Yield to the event loop (MessageChannel beats setTimeout's 4 ms clamp in nested loops). */
function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

async function loadSpec(source: ModelSourceMessage, fetchImpl: typeof fetch | undefined): Promise<unknown> {
  if (source.kind === 'spec') return source.spec;
  if (!fetchImpl) throw new ModelFormatError('fetch is not available in this runtime');
  const response = await fetchImpl(source.url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ModelFormatError(`model.json is not available (HTTP ${response.status})`);
  const text = await response.text();
  // SPA hosts answer unknown paths with index.html and status 200.
  if (!text.trimStart().startsWith('{')) throw new ModelFormatError('model.json is not available (the server returned a web page)');
  return JSON.parse(text) as unknown;
}

function describe(model: EdgeModel, loadMs: number): ModelInfo {
  let nTrees = 0;
  for (const t of model.targets) {
    for (const comp of model.spec.models[t]!.components) if (comp.type === 'xgboost') nTrees += comp.trees.length;
  }
  return {
    modelVersion: model.modelVersion,
    targets: [...model.targets],
    features: model.spec.features.map((f) => f.key),
    nColumns: model.spec.columns.length,
    nTrees,
    loadMs,
  };
}

export function createInferenceHandler(options: HandlerOptions = {}): InferenceHandler {
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const now = options.now ?? (() => performance.now());
  const sliceMs = options.sliceMs ?? 8;
  let loading: Promise<{ model: EdgeModel; info: ModelInfo }> | null = null;
  const inFlight = new Set<number>();
  const cancelled = new Set<number>();

  const requireModel = async (): Promise<EdgeModel> => {
    if (!loading) throw new ModelFormatError('The inference runtime has not been initialised with a model.');
    return (await loading).model;
  };

  async function execute(request: WorkRequest): Promise<{ result: InferenceResult; computeMs: number }> {
    switch (request.type) {
      case 'init': {
        const t0 = now();
        const attempt = loadSpec(request.source, fetchImpl).then((spec) => {
          const model = compileModel(spec);
          return { model, info: describe(model, now() - t0) };
        });
        loading = attempt;
        // A failed init can be retried by sending init again.
        attempt.catch(() => {
          if (loading === attempt) loading = null;
        });
        const { info } = await attempt;
        return { result: info, computeMs: info.loadMs };
      }
      case 'predict': {
        const model = await requireModel();
        const t0 = now();
        const result = model.predict(request.features);
        return { result, computeMs: now() - t0 };
      }
      case 'predictBatch': {
        const model = await requireModel();
        const out: (EdgePredictResponse | EdgeScore)[] = new Array(request.rows.length);
        let computeMs = 0;
        let sliceStart = now();
        for (let i = 0; i < request.rows.length; i++) {
          if (cancelled.has(request.id)) throw new CancelledError();
          try {
            out[i] = request.explain ? model.predict(request.rows[i]) : model.score(request.rows[i]);
          } catch (error) {
            throw new RowError(i, error);
          }
          const elapsed = now() - sliceStart;
          if (elapsed >= sliceMs && i < request.rows.length - 1) {
            computeMs += elapsed;
            await yieldToEventLoop();
            sliceStart = now();
          }
        }
        if (cancelled.has(request.id)) throw new CancelledError();
        computeMs += now() - sliceStart;
        return { result: out as EdgePredictResponse[] | EdgeScore[], computeMs };
      }
    }
  }

  return {
    async handle(request) {
      if (request.type === 'cancel') {
        if (inFlight.has(request.target)) cancelled.add(request.target);
        return null;
      }
      inFlight.add(request.id);
      try {
        const { result, computeMs } = await execute(request);
        return { id: request.id, ok: true, result, computeMs };
      } catch (error) {
        return { id: request.id, ok: false, error: serializeError(error) };
      } finally {
        inFlight.delete(request.id);
        cancelled.delete(request.id);
      }
    },
  };
}
