/**
 * `InferenceClient`: promise API over the inference worker (plain postMessage, no library).
 *
 *   const client = new InferenceClient({ source: { url: assetUrl('model/model.json') } });
 *   await client.ready();                                   // ModelInfo (version, features, load time)
 *   const r = await client.predict(features);               // EdgePredictResponse (§3.2, engine "edge")
 *   const s = await client.predictBatch(rows);              // EdgeScore[] (no SHAP, fast)
 *   const e = await client.predictBatch(rows, { explain: true });   // EdgePredictResponse[]
 *
 * Runtime: a module Web Worker when available; otherwise (tests, CSP without worker-src, file://,
 * a worker that fails to start) the same handler runs in-process, transparently. Requests are
 * answered in order; aborting a request rejects it at once with an `AbortError` and cancels a
 * running batch between time slices.
 */
import { FeatureInputError, ModelFormatError } from './errors';
import { createInferenceHandler } from './handler';
import type { InferenceRequest, InferenceResponse, InferenceResult, ModelInfo, ModelSourceMessage, SerializedError } from './protocol';
import type { EdgeFeatureInput, EdgePredictResponse, EdgeScore, PortableModelSpec } from './types';

/** Where to load the model from: a URL (fetched by the worker) or an already parsed spec. */
export type ModelSource = { url: string } | { spec: PortableModelSpec };

export type InferenceRuntime = 'worker' | 'main-thread';

export interface InferenceClientOptions {
  source: ModelSource;
  /** `auto` (default) prefers a Web Worker. */
  runtime?: 'auto' | InferenceRuntime;
  /** Worker factory override (tests, custom bundling). */
  createWorker?: () => Worker;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface BatchOptions extends RequestOptions {
  /** Include SHAP explanations (full `EdgePredictResponse`s). Default false: scores only. */
  explain?: boolean;
}

/** Error thrown for a failed batch row: carries the row index. */
export class BatchRowError extends FeatureInputError {
  readonly row: number;
  constructor(message: string, row: number, features: string[] = []) {
    super(`row ${row}: ${message}`, features);
    this.name = 'BatchRowError';
    this.row = row;
  }
}

function abortError(): DOMException {
  return new DOMException('The inference request was aborted.', 'AbortError');
}

function deserializeError(error: SerializedError): Error {
  if (error.name === 'AbortError') return abortError();
  if (error.row !== undefined) return new BatchRowError(error.message, error.row, error.features);
  if (error.name === 'FeatureInputError') return new FeatureInputError(error.message, error.features);
  if (error.name === 'ModelFormatError') return new ModelFormatError(error.message);
  const out = new Error(error.message);
  out.name = error.name;
  return out;
}

interface Transport {
  readonly runtime: InferenceRuntime;
  post(request: InferenceRequest): void;
  terminate(): void;
}

interface Pending {
  request: InferenceRequest;
  resolve(result: InferenceResult, computeMs: number): void;
  reject(error: Error): void;
}

/** The default worker, bundled by Vite from `src/workers/inference.worker.ts`. */
export function createInferenceWorker(): Worker {
  return new Worker(new URL('../workers/inference.worker.ts', import.meta.url), {
    type: 'module',
    name: 'cardiotwin-inference',
  });
}

export class InferenceClient {
  private transport: Transport;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly readyPromise: Promise<ModelInfo>;
  private disposed = false;
  private info: ModelInfo | null = null;
  private lastMs: number | null = null;
  private readonly source: ModelSourceMessage;

  constructor(options: InferenceClientOptions) {
    const runtime = options.runtime ?? 'auto';
    this.source = 'url' in options.source ? { kind: 'url', url: options.source.url } : { kind: 'spec', spec: options.source.spec };
    this.transport =
      runtime === 'main-thread' || (runtime === 'auto' && typeof Worker === 'undefined')
        ? this.inProcess()
        : this.tryWorker(options.createWorker ?? createInferenceWorker);
    this.readyPromise = this.request<ModelInfo>({ id: this.allocateId(), type: 'init', source: this.source }).then((info) => {
      this.info = info;
      return info;
    });
    // Callers observe failures through ready()/predict(); never leave an unhandled rejection behind.
    this.readyPromise.catch(() => undefined);
  }

  /** Resolves once the model is loaded and compiled; rejects if it cannot be (missing/invalid file). */
  ready(): Promise<ModelInfo> {
    return this.readyPromise;
  }

  /** Model metadata once ready, else null. */
  get modelInfo(): ModelInfo | null {
    return this.info;
  }

  /** Where predictions run right now (may switch to `main-thread` if the worker dies). */
  get runtime(): InferenceRuntime {
    return this.transport.runtime;
  }

  /** Compute time of the last answered request inside the runtime, ms (excludes messaging). */
  get lastComputeMs(): number | null {
    return this.lastMs;
  }

  /** One full prediction with exact SHAP explanations (CONTRACTS §3.2, `engine = "edge"`). */
  async predict(features: EdgeFeatureInput, options: RequestOptions = {}): Promise<EdgePredictResponse> {
    await this.readyPromise;
    return this.request<EdgePredictResponse>({ id: this.allocateId(), type: 'predict', features }, options.signal);
  }

  /**
   * Many predictions in one message, answered in row order. Without `explain` each row is an
   * `EdgeScore` (probabilities, labels, bands, summary; ≈ 5–10× cheaper); with `explain: true` each row
   * is a full `EdgePredictResponse`. A bad row rejects the whole batch with `BatchRowError`.
   */
  predictBatch(rows: readonly EdgeFeatureInput[], options?: BatchOptions & { explain?: false }): Promise<EdgeScore[]>;
  predictBatch(rows: readonly EdgeFeatureInput[], options: BatchOptions & { explain: true }): Promise<EdgePredictResponse[]>;
  async predictBatch(rows: readonly EdgeFeatureInput[], options: BatchOptions = {}): Promise<EdgeScore[] | EdgePredictResponse[]> {
    await this.readyPromise;
    if (rows.length === 0) return [];
    return this.request<EdgeScore[] | EdgePredictResponse[]>(
      { id: this.allocateId(), type: 'predictBatch', rows: [...rows], explain: options.explain === true },
      options.signal,
    );
  }

  /** Stop the worker and reject everything still pending. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport.terminate();
    const error = new Error('The inference client was disposed.');
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  // ---------------------------------------------------------------------------------- internals

  private allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  private request<T extends InferenceResult>(request: InferenceRequest, signal?: AbortSignal): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('The inference client was disposed.'));
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.delete(request.id)) return;
        this.transport.post({ id: this.allocateId(), type: 'cancel', target: request.id });
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(request.id, {
        request,
        resolve: (result, computeMs) => {
          signal?.removeEventListener('abort', onAbort);
          this.lastMs = computeMs;
          resolve(result as T);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      this.transport.post(request);
    });
  }

  private deliver = (response: InferenceResponse) => {
    const pending = this.pending.get(response.id);
    if (!pending) return; // aborted or disposed meanwhile
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result, response.computeMs);
    else pending.reject(deserializeError(response.error));
  };

  private inProcess(): Transport {
    const handler = createInferenceHandler();
    let alive = true;
    return {
      runtime: 'main-thread',
      post: (request) => {
        // Asynchronous like a worker, so callers never observe re-entrancy.
        queueMicrotask(() => {
          void handler.handle(request).then((response) => {
            if (alive && response) this.deliver(response);
          });
        });
      },
      terminate: () => {
        alive = false;
      },
    };
  }

  private tryWorker(factory: () => Worker): Transport {
    let worker: Worker;
    try {
      worker = factory();
    } catch {
      return this.inProcess();
    }
    const transport: Transport = {
      runtime: 'worker',
      post: (request) => worker.postMessage(request),
      terminate: () => worker.terminate(),
    };
    worker.onmessage = (event: MessageEvent<InferenceResponse>) => this.deliver(event.data);
    const fail = (event: Event) => {
      event.preventDefault?.();
      if (this.disposed || this.transport !== transport) return;
      // The worker could not start or crashed: continue in-process. Re-initialise first when the
      // model had been loaded inside the dead worker, then replay what was still pending, in order.
      worker.terminate();
      this.transport = this.inProcess();
      const replay = [...this.pending.values()].map((p) => p.request).sort((a, b) => a.id - b.id);
      if (!replay.some((r) => r.type === 'init')) {
        this.transport.post({ id: this.allocateId(), type: 'init', source: this.source });
      }
      for (const request of replay) this.transport.post(request);
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    return transport;
  }
}
