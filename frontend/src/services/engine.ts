/**
 * Prediction engines. The UI talks to `PredictionEngine` only, so the source of truth can be the
 * FastAPI server or the in-browser portable model without any component knowing which.
 *
 *   ServerEngine — POST /api/predict. Optionally fails over to the edge engine while the server is
 *                  unreachable (network error, timeout, 5xx), so a backend outage never blanks the UI;
 *                  such responses carry `engine: "edge"`, keeping provenance honest.
 *   EdgeEngine   — evaluates `model.json` in the browser (Web Worker, `@/inference`): the same §3.2
 *                  response with exact SHAP, reproducing the server to ~1e-15 (fixtures + cohort parity
 *                  tests). A static deployment with no backend is fully functional.
 *
 * resolveEngine() health-checks the API with a short timeout: server if it answers, else edge.
 * `?engine=edge|server` (in the query string or the hash route, e.g. `#/workstation?engine=edge`)
 * forces one engine for demos and verification.
 */
import { FeatureInputError } from '@/inference/errors';
import type { InferenceClient } from '@/inference/client';
import { getSharedInferenceClient } from '@/inference/shared';
import type { ModelInfo } from '@/inference/protocol';
import {
  LEAKAGE_KEYS,
  type EngineKind,
  type FeatureVector,
  type HealthResponse,
  type PredictResponse,
} from '@/types/contracts';
import { ApiError, NetworkError, api, isAbortError, type ApiClient } from './api';

export interface PredictOptions {
  signal?: AbortSignal;
}

export interface PredictionEngine {
  readonly kind: EngineKind;
  /** Human-readable source for tooltips, e.g. "FastAPI server · model 1.0.0". */
  readonly description: string;
  /** False when the engine cannot produce predictions (e.g. the portable model failed to load). */
  readonly available: boolean;
  predict(features: FeatureVector, options?: PredictOptions): Promise<PredictResponse>;
  /** Resolves once `available` is final (true = usable). Engines without warm-up may omit it. */
  ready?(): Promise<boolean>;
}

export class EngineUnavailableError extends Error {
  readonly kind: EngineKind;
  constructor(kind: EngineKind, message: string) {
    super(message);
    this.name = 'EngineUnavailableError';
    this.kind = kind;
  }
}

/** Drop target-leakage keys and empty values before anything leaves the browser. */
export function sanitizeFeatures(features: FeatureVector): FeatureVector {
  const out: FeatureVector = {};
  for (const [key, value] of Object.entries(features)) {
    if (LEAKAGE_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Minimal runtime guard: a malformed response must never be rendered as a real estimate. */
export function assertPredictResponse(x: unknown): asserts x is PredictResponse {
  const r = x as Partial<PredictResponse> | null;
  const ok =
    !!r &&
    typeof r === 'object' &&
    typeof r.predictions === 'object' &&
    r.predictions !== null &&
    Object.values(r.predictions).every(
      (p) => !!p && typeof p.probability === 'number' && p.probability >= 0 && p.probability <= 1,
    ) &&
    typeof r.explanations === 'object' &&
    r.explanations !== null;
  if (!ok) throw new ApiError(502, 'invalid_response', 'The prediction service returned an unexpected response.');
}

/** Wait until an engine's availability is known (engines without `ready()` are ready now). */
export async function whenEngineReady(engine: PredictionEngine): Promise<boolean> {
  if (!engine.ready) return engine.available;
  try {
    return await engine.ready();
  } catch {
    return false;
  }
}

/** True for failures that mean "the server is not there" (as opposed to "the request was bad"). */
export function isServerDownError(error: unknown): boolean {
  if (error instanceof NetworkError) return true; // includes TimeoutError
  return error instanceof ApiError && error.status >= 500 && error.code !== 'invalid_response';
}

export interface ServerEngineOptions {
  /** Engine used while the server is unreachable; created on first need (again if it failed to load). */
  fallback?: () => PredictionEngine;
  /** After a failover, keep using the fallback this long before trying the server again (ms). */
  retryAfterMs?: number;
  /**
   * Give up on a server that does not answer a prediction within this time (ms). Defaults to
   * `FAILOVER_TIMEOUT_MS` when there is a fallback (a hung server should not freeze the UI for the API
   * client's 15 s), else to the API client's default.
   */
  timeoutMs?: number;
}

/** Prediction timeout of a server engine that can fail over (a prediction normally takes < 100 ms). */
export const FAILOVER_TIMEOUT_MS = 6_000;

export class ServerEngine implements PredictionEngine {
  readonly kind = 'server' as const;
  readonly available = true;
  readonly description: string;
  private readonly client: Pick<ApiClient, 'predict'>;
  private readonly createFallback: (() => PredictionEngine) | null;
  private readonly retryAfterMs: number;
  private readonly timeoutMs: number | undefined;
  private fallback: PredictionEngine | null = null;
  private fallbackUntil = 0;

  constructor(client: Pick<ApiClient, 'predict'> = api, health?: HealthResponse | null, options: ServerEngineOptions = {}) {
    this.client = client;
    this.description = health
      ? `FastAPI server · model ${health.model_version}${health.predictor === 'fake' ? ' · synthetic dev predictor' : ''}`
      : 'FastAPI server';
    this.createFallback = options.fallback ?? null;
    this.retryAfterMs = options.retryAfterMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? (this.createFallback ? FAILOVER_TIMEOUT_MS : undefined);
  }

  /** True while predictions are being served by the fallback engine. */
  get failedOver(): boolean {
    return Date.now() < this.fallbackUntil;
  }

  async predict(features: FeatureVector, options: PredictOptions = {}): Promise<PredictResponse> {
    if (this.failedOver && this.fallback?.available) return this.fallback.predict(features, options);
    try {
      const response = await this.client.predict(sanitizeFeatures(features), { signal: options.signal, timeoutMs: this.timeoutMs });
      assertPredictResponse(response);
      this.fallbackUntil = 0;
      return response;
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error) || !this.createFallback || !isServerDownError(error)) throw error;
      const fallback = this.fallback ?? this.createFallback();
      if (!(await whenEngineReady(fallback))) {
        // Forget a fallback that could not load, so the next outage builds a fresh one instead of
        // failing forever on a transient model.json error.
        this.fallback = null;
        throw error;
      }
      this.fallback = fallback;
      this.fallbackUntil = Date.now() + this.retryAfterMs;
      return fallback.predict(features, options);
    }
  }
}

export interface EdgeEngineOptions {
  /**
   * Inference client that evaluates the portable model (worker or in-process). Without one the engine
   * has no model and is honestly unavailable. `createEdgeEngine()` wires the app-wide shared client.
   */
  client?: InferenceClient | null;
}

/** absent = constructed without a model · loading · ready · failed = the model could not be loaded. */
export type EdgeEngineStatus = 'absent' | 'loading' | 'ready' | 'failed';

/**
 * The in-browser engine: the portable model (encoders + LR + float32 XGBoost + Platt + exact TreeSHAP)
 * evaluated by `@/inference`, answering exactly like `POST /api/predict` with `engine: "edge"`.
 */
export class EdgeEngine implements PredictionEngine {
  readonly kind = 'edge' as const;
  private readonly client: InferenceClient | null;
  private state: EdgeEngineStatus;
  private info: ModelInfo | null = null;
  private failure: string | null = null;
  private readonly readyPromise: Promise<boolean>;

  constructor(options: EdgeEngineOptions = {}) {
    this.client = options.client ?? null;
    if (!this.client) {
      this.state = 'absent';
      this.readyPromise = Promise.resolve(false);
      return;
    }
    this.state = 'loading';
    this.readyPromise = this.client.ready().then(
      (info) => {
        this.info = info;
        this.state = 'ready';
        return true;
      },
      (error: unknown) => {
        this.failure = error instanceof Error ? error.message : String(error);
        this.state = 'failed';
        return false;
      },
    );
  }

  get available(): boolean {
    return this.state === 'ready';
  }

  get status(): EdgeEngineStatus {
    return this.state;
  }

  get description(): string {
    switch (this.state) {
      case 'ready': {
        const where = this.client?.runtime === 'worker' ? 'Web Worker' : 'main thread';
        return `In-browser engine · model ${this.info?.modelVersion ?? '?'} · ${where}`;
      }
      case 'loading':
        return 'In-browser engine · loading the portable model…';
      case 'failed':
        return `In-browser engine unavailable · ${this.failure ?? 'the portable model could not be loaded'}`;
      default:
        return 'In-browser engine (no portable model in this build)';
    }
  }

  /** Metadata of the loaded model (version, features, trees, load time), once ready. */
  get modelInfo(): ModelInfo | null {
    return this.info;
  }

  /** The underlying client (for batch work such as ICE strips); null when there is no model. */
  get inference(): InferenceClient | null {
    return this.available ? this.client : null;
  }

  ready(): Promise<boolean> {
    return this.readyPromise;
  }

  async predict(features: FeatureVector, options: PredictOptions = {}): Promise<PredictResponse> {
    if (!this.client) {
      throw new EngineUnavailableError(
        'edge',
        'The prediction server is offline and the in-browser engine has no portable model in this build.',
      );
    }
    if (!(await this.readyPromise)) {
      throw new EngineUnavailableError('edge', `The in-browser engine could not load the portable model (${this.failure ?? 'unknown error'}).`);
    }
    try {
      const response = await this.client.predict(sanitizeFeatures(features), { signal: options.signal });
      assertPredictResponse(response);
      return response;
    } catch (error) {
      // Same shape as a server-side validation failure, so the UI words it identically.
      if (error instanceof FeatureInputError) throw new ApiError(422, 'invalid_features', error.message);
      throw error;
    }
  }
}

let sharedEdge: EdgeEngine | null = null;

/**
 * The app-wide edge engine over the shared inference worker. Re-created if its model failed to load,
 * so a later resolution can recover.
 */
export function createEdgeEngine(): EdgeEngine {
  if (!sharedEdge || sharedEdge.status === 'failed') {
    sharedEdge = new EdgeEngine({ client: getSharedInferenceClient() });
  }
  return sharedEdge;
}

// ------------------------------------------------------------------------------ resolution

export type EngineOverride = 'edge' | 'server';

/**
 * `?engine=edge|server` from the query string or from the hash route's own query
 * (`#/workstation?engine=edge`); case-insensitive; anything else → null.
 */
export function readEngineOverride(location: Pick<Location, 'search' | 'hash'> | null = typeof window === 'undefined' ? null : window.location): EngineOverride | null {
  if (!location) return null;
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
  for (const query of [hashQuery, location.search]) {
    const value = new URLSearchParams(query).get('engine')?.trim().toLowerCase();
    if (value === 'edge' || value === 'server') return value;
  }
  return null;
}

export interface EngineResolution {
  engine: PredictionEngine;
  /** Health payload when the server answered, else null. */
  health: HealthResponse | null;
  /** Why this engine was chosen, for the engine pill tooltip. */
  reason: string;
  /** Engine forced through `?engine=`, if any. */
  override?: EngineOverride | null;
}

export interface ResolveEngineOptions {
  client?: Pick<ApiClient, 'health' | 'predict'>;
  timeoutMs?: number;
  createEdge?: () => PredictionEngine;
  signal?: AbortSignal;
  /** Force an engine; default: read `?engine=` from the URL. `null` disables the override. */
  override?: EngineOverride | null;
}

export const DEFAULT_HEALTH_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_API_HEALTH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1500;
})();

export async function resolveEngine(options: ResolveEngineOptions = {}): Promise<EngineResolution> {
  const client = options.client ?? api;
  const createEdge = options.createEdge ?? createEdgeEngine;
  const override = options.override === undefined ? readEngineOverride() : options.override;
  const probe = async (): Promise<{ health: HealthResponse | null; unhealthy: boolean }> => {
    try {
      const health = await client.health({ timeoutMs: options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS, signal: options.signal });
      return health && health.status === 'ok' ? { health, unhealthy: false } : { health: null, unhealthy: true };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return { health: null, unhealthy: false };
    }
  };

  if (override === 'edge') {
    // The server (if any) is still probed so the pill can cross-check the edge against it.
    const edge = createEdge();
    const [{ health }, ready] = await Promise.all([probe(), whenEngineReady(edge)]);
    const reason = ready
      ? `In-browser engine forced by ?engine=edge${health ? '; the server is used for cross-checks' : ''}`
      : '?engine=edge was requested but the portable model could not be loaded';
    return { engine: edge, health, reason, override };
  }

  const { health, unhealthy } = await probe();
  if (override === 'server') {
    const reason = health ? 'Server forced by ?engine=server' : '?engine=server was requested but the server is unreachable';
    return { engine: new ServerEngine(client, health), health, reason, override };
  }
  if (health) {
    return {
      engine: new ServerEngine(client, health, { fallback: createEdge }),
      health,
      reason: 'Server answered the health check',
      override: null,
    };
  }
  const edge = createEdge();
  await whenEngineReady(edge);
  const reason = unhealthy ? 'Server reported an unhealthy status' : 'Server unreachable; using the in-browser engine';
  return { engine: edge, health: null, reason, override: null };
}
