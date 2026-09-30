/**
 * Prediction engines. The UI talks to `PredictionEngine` only, so the source of truth can be the
 * FastAPI server or the in-browser portable model without any component knowing which.
 *
 *   ServerEngine — POST /api/predict (implemented here).
 *   EdgeEngine   — evaluates model.json in the browser. ⚠ STUB in this phase: it reports itself as
 *                  unavailable and every predict() rejects with EngineUnavailableError. Phase 2 replaces
 *                  the class body (see frontend/ARCHITECTURE.md "Edge engine") while keeping this interface.
 *
 * resolveEngine() health-checks the API with a short timeout: server if it answers, else edge.
 */
import {
  LEAKAGE_KEYS,
  type EngineKind,
  type FeatureVector,
  type HealthResponse,
  type PredictResponse,
} from '@/types/contracts';
import { ApiError, api, type ApiClient } from './api';

export interface PredictOptions {
  signal?: AbortSignal;
}

export interface PredictionEngine {
  readonly kind: EngineKind;
  /** Human-readable source for tooltips, e.g. "FastAPI server · model 1.0.0". */
  readonly description: string;
  /** False when the engine cannot produce predictions (e.g. the edge stub before phase 2). */
  readonly available: boolean;
  predict(features: FeatureVector, options?: PredictOptions): Promise<PredictResponse>;
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

export class ServerEngine implements PredictionEngine {
  readonly kind = 'server' as const;
  readonly available = true;
  readonly description: string;
  private readonly client: Pick<ApiClient, 'predict'>;

  constructor(client: Pick<ApiClient, 'predict'> = api, health?: HealthResponse | null) {
    this.client = client;
    this.description = health
      ? `FastAPI server · model ${health.model_version}${health.predictor === 'fake' ? ' · synthetic dev predictor' : ''}`
      : 'FastAPI server';
  }

  async predict(features: FeatureVector, options: PredictOptions = {}): Promise<PredictResponse> {
    const response = await this.client.predict(sanitizeFeatures(features), { signal: options.signal });
    assertPredictResponse(response);
    return response;
  }
}

/**
 * ⚠ STUB — the in-browser engine. Phase 2 replaces this class with the portable-model evaluator
 * (encoders + LR + XGBoost trees + Platt + TreeSHAP from model.json) that must reproduce fixtures.json
 * to |Δp| < 1e-6. Until then it is honest about being unavailable instead of inventing numbers.
 */
export class EdgeEngine implements PredictionEngine {
  readonly kind = 'edge' as const;
  readonly available: boolean = false;
  readonly description = 'In-browser engine (not available in this build)';
  /** Marks the placeholder so the UI can explain why no estimate is shown. */
  readonly isStub: boolean = true;

  async predict(_features: FeatureVector, _options?: PredictOptions): Promise<PredictResponse> {
    throw new EngineUnavailableError(
      'edge',
      'The prediction server is offline and the in-browser engine is not available in this build.',
    );
  }
}

export interface EngineResolution {
  engine: PredictionEngine;
  /** Health payload when the server answered, else null. */
  health: HealthResponse | null;
  /** Why this engine was chosen, for the engine pill tooltip. */
  reason: string;
}

export interface ResolveEngineOptions {
  client?: Pick<ApiClient, 'health' | 'predict'>;
  timeoutMs?: number;
  createEdge?: () => PredictionEngine;
  signal?: AbortSignal;
}

export const DEFAULT_HEALTH_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_API_HEALTH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1500;
})();

export async function resolveEngine(options: ResolveEngineOptions = {}): Promise<EngineResolution> {
  const client = options.client ?? api;
  const createEdge = options.createEdge ?? (() => new EdgeEngine());
  try {
    const health = await client.health({ timeoutMs: options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS, signal: options.signal });
    if (health && health.status === 'ok') {
      return { engine: new ServerEngine(client, health), health, reason: 'Server answered the health check' };
    }
    return { engine: createEdge(), health: null, reason: 'Server reported an unhealthy status' };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { engine: createEdge(), health: null, reason: 'Server unreachable; using the in-browser engine' };
  }
}
