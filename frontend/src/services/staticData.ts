/**
 * Static artifacts shipped with the app (docs/CONTRACTS.md §1, §6):
 *   model/{schema,cohort,metrics,model,fixtures}.json   ← written by ml/
 *   anatomy/{manifest.json,vessels.json,cardiotwin_anatomy.glb} ← written by anatomy/
 *
 * URLs are resolved relative to Vite's BASE_URL ('./'), so the app works from any sub-path.
 * Loaders are memoised (one request per session) and forget failures so a retry can succeed.
 * schema / cohort / metrics fall back to the REST API when the static copy is absent.
 * A missing file raises `MissingAssetError`, which the UI renders as a friendly empty state.
 */
import type {
  AnatomyManifest,
  CohortResponse,
  FeatureSchema,
  FixturesFile,
  MetricsReport,
  PortableModel,
  VesselsFile,
} from '@/types/contracts';
import { api, type RequestOptions } from './api';

export class MissingAssetError extends Error {
  readonly path: string;
  constructor(path: string, detail?: string) {
    super(`${path} is not available${detail ? ` (${detail})` : ''}`);
    this.name = 'MissingAssetError';
    this.path = path;
  }
}

/** Absolute URL of a file under `public/`, honouring the deployment base path. */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  const clean = path.replace(/^\/+/, '');
  const joined = `${base.endsWith('/') ? base : `${base}/`}${clean}`;
  if (typeof document === 'undefined') return joined;
  return new URL(joined, document.baseURI).toString();
}

/**
 * Fetch a JSON file from `public/`. SPA hosts (and the Vite dev server) answer unknown paths with
 * index.html and status 200, so a non-JSON body is treated as "missing" too.
 */
export async function fetchStaticJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(assetUrl(path), { signal: options.signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new MissingAssetError(path, 'network error');
  }
  if (response.status === 404) throw new MissingAssetError(path, 'not found');
  if (!response.ok) throw new MissingAssetError(path, `HTTP ${response.status}`);
  const text = await response.text();
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) throw new MissingAssetError(path, 'not JSON');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MissingAssetError(path, 'malformed JSON');
  }
}

export interface Memo<T> {
  /** Start (or join) the load. */
  get(): Promise<T>;
  /** The resolved value, if already loaded. */
  peek(): T | undefined;
  /** Forget the cached value (tests, hot reload). */
  reset(): void;
}

export function memoize<T>(load: () => Promise<T>): Memo<T> {
  let promise: Promise<T> | null = null;
  let value: T | undefined;
  return {
    get() {
      if (!promise) {
        promise = load().then(
          (v) => {
            value = v;
            return v;
          },
          (error: unknown) => {
            promise = null;
            throw error;
          },
        );
      }
      return promise;
    },
    peek: () => value,
    reset() {
      promise = null;
      value = undefined;
    },
  };
}

async function staticThenApi<T>(path: string, fromApi: () => Promise<T>): Promise<T> {
  try {
    return await fetchStaticJson<T>(path);
  } catch (staticError) {
    if (!(staticError instanceof MissingAssetError)) throw staticError;
    try {
      return await fromApi();
    } catch {
      throw staticError;
    }
  }
}

export const MODEL_DIR = 'model';
export const ANATOMY_DIR = 'anatomy';
export const DEFAULT_GLB = 'cardiotwin_anatomy.glb';

export const schemaResource = memoize<FeatureSchema>(() =>
  staticThenApi(`${MODEL_DIR}/schema.json`, () => api.schema({ timeoutMs: 4000 })),
);
export const cohortResource = memoize<CohortResponse>(() =>
  staticThenApi(`${MODEL_DIR}/cohort.json`, () => api.cohort({ timeoutMs: 4000 })),
);
export const metricsResource = memoize<MetricsReport>(() =>
  staticThenApi(`${MODEL_DIR}/metrics.json`, () => api.metrics({ timeoutMs: 4000 })),
);
/** Portable model for the edge engine (static only — the API never serves it). */
export const portableModelResource = memoize<PortableModel>(() => fetchStaticJson(`${MODEL_DIR}/model.json`));
export const fixturesResource = memoize<FixturesFile>(() => fetchStaticJson(`${MODEL_DIR}/fixtures.json`));
export const manifestResource = memoize<AnatomyManifest>(() => fetchStaticJson(`${ANATOMY_DIR}/manifest.json`));
export const vesselsResource = memoize<VesselsFile>(() => fetchStaticJson(`${ANATOMY_DIR}/vessels.json`));

/**
 * URL of the anatomy GLB if it is actually deployed (HEAD probe; SPA fallbacks answering text/html are
 * rejected), else null so the 3D view can show its procedural placeholder.
 */
export const anatomyGlbResource = memoize<string | null>(async () => {
  let name = DEFAULT_GLB;
  try {
    name = (await manifestResource.get()).glb || DEFAULT_GLB;
  } catch {
    // No manifest yet: probe the default file name.
  }
  const url = assetUrl(`${ANATOMY_DIR}/${name}`);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html') ? url : null;
  } catch {
    return null;
  }
});
