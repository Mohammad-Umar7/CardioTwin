/**
 * Typed REST client for the CardioTwin API (docs/CONTRACTS.md §3).
 *
 * Base URL: `VITE_API_URL` (default '' → same origin, so requests go to `/api/*`; the Vite dev server
 * proxies that to http://localhost:8000 and the Docker image serves both from one process).
 * Every call accepts an AbortSignal and a timeout; failures surface as `ApiError` (HTTP error with the
 * backend's error body) or `NetworkError` / `TimeoutError` (no usable response).
 */
import type {
  ApiErrorBody,
  CohortResponse,
  FeatureSchema,
  FeatureVector,
  HealthResponse,
  MetricsReport,
  PredictResponse,
} from '@/types/contracts';

export const DEFAULT_TIMEOUT_MS = 15_000;

export function normaliseBaseUrl(raw: string | undefined | null): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

export const API_BASE = normaliseBaseUrl(import.meta.env.VITE_API_URL);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, body?: ApiErrorBody, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.requestId = requestId ?? body?.request_id ?? undefined;
  }
}

/** The request never produced an HTTP response (offline, DNS, CORS, connection refused). */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends NetworkError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Links the caller's signal with a timeout; `cleanup` must run once the request settles. */
function linkSignals(outer: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const isErrorBody = (x: unknown): x is ApiErrorBody =>
  typeof x === 'object' && x !== null && 'error' in x && 'message' in x;

export interface ApiClient {
  readonly baseUrl: string;
  url(path: string): string;
  health(options?: RequestOptions): Promise<HealthResponse>;
  predict(features: FeatureVector, options?: RequestOptions): Promise<PredictResponse>;
  schema(options?: RequestOptions): Promise<FeatureSchema>;
  cohort(options?: RequestOptions): Promise<CohortResponse>;
  metrics(options?: RequestOptions): Promise<MetricsReport>;
  modelCard(options?: RequestOptions): Promise<string>;
}

export function createApiClient(baseUrl: string = API_BASE, fetchImpl?: FetchLike): ApiClient {
  const base = normaliseBaseUrl(baseUrl);
  // Resolve fetch lazily so tests can stub the global after the client is created.
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const url = (path: string) => `${base}/api${path.startsWith('/') ? path : `/${path}`}`;

  async function request<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const link = linkSignals(options.signal, timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url(path), {
        ...init,
        signal: link.signal,
        headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      });
    } catch (error) {
      link.cleanup();
      if (link.timedOut()) throw new TimeoutError(timeoutMs);
      if (options.signal?.aborted || isAbortError(error)) throw error;
      throw new NetworkError(`Could not reach the CardioTwin API at ${url(path)}`, { cause: error });
    }
    try {
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      const body = contentType.includes('json') || text.startsWith('{') || text.startsWith('[') ? parseJson(text) : text;
      const requestId = response.headers.get('x-request-id') ?? undefined;
      if (!response.ok) {
        if (isErrorBody(body)) throw new ApiError(response.status, body.error, body.message, body, requestId);
        throw new ApiError(response.status, 'http_error', `HTTP ${response.status} from ${path}`, undefined, requestId);
      }
      if (body === undefined) {
        throw new ApiError(response.status, 'invalid_json', `The API returned malformed JSON for ${path}`);
      }
      return body as T;
    } catch (error) {
      if (link.timedOut()) throw new TimeoutError(timeoutMs);
      throw error;
    } finally {
      link.cleanup();
    }
  }

  async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const body = await request<unknown>(path, { method: 'GET', headers: { Accept: 'text/markdown, application/json' } }, options);
    return typeof body === 'string' ? body : JSON.stringify(body);
  }

  return {
    baseUrl: base,
    url,
    health: (options) => request<HealthResponse>('/health', { method: 'GET' }, options),
    predict: (features, options) =>
      request<PredictResponse>(
        '/predict',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features }) },
        options,
      ),
    schema: (options) => request<FeatureSchema>('/schema', { method: 'GET' }, options),
    cohort: (options) => request<CohortResponse>('/cohort', { method: 'GET' }, options),
    metrics: (options) => request<MetricsReport>('/metrics', { method: 'GET' }, options),
    modelCard: (options) => requestText('/model-card', options),
  };
}

/** Shared client for the configured base URL. */
export const api: ApiClient = createApiClient();

/** One-line, user-facing description of any error thrown by this module. */
export function describeApiError(error: unknown): string {
  if (error instanceof TimeoutError) return 'The prediction service took too long to answer.';
  if (error instanceof NetworkError) return 'The prediction service is unreachable.';
  if (error instanceof ApiError) {
    if (error.status === 422) return `Some inputs were rejected: ${error.body?.detail?.[0]?.msg ?? error.message}`;
    if (error.status >= 500) return 'The prediction service had an internal error.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
