/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the REST API. Empty = same origin (`/api/*`). */
  readonly VITE_API_URL?: string;
  /** Dev server only: target of the `/api` proxy. */
  readonly VITE_API_PROXY?: string;
  /** Health-check timeout before falling back to the edge engine (ms). */
  readonly VITE_API_HEALTH_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
