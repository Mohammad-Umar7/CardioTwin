/**
 * The app-wide inference client: one worker, one compiled model, shared by the edge engine, the
 * engine verifier and the dashboard (ICE strips, counterfactuals). Created lazily on first use.
 */
import { MODEL_DIR, assetUrl } from '@/services/staticData';
import { InferenceClient } from './client';

let shared: InferenceClient | null = null;
let failed = false;

/** URL of the deployed portable model (relative to the app base, so any sub-path works). */
export function portableModelUrl(): string {
  return assetUrl(`${MODEL_DIR}/model.json`);
}

/**
 * The shared client. If its model failed to load, the next call starts a fresh client, so a transient
 * failure (offline for a moment, a deploy in progress) does not disable the edge engine for the session.
 */
export function getSharedInferenceClient(): InferenceClient {
  if (!shared || failed) {
    shared?.dispose();
    failed = false;
    const client = new InferenceClient({ source: { url: portableModelUrl() } });
    client.ready().catch(() => {
      if (shared === client) failed = true;
    });
    shared = client;
  }
  return shared;
}

/** Tests / hot reload: stop the shared worker. */
export function resetSharedInferenceClient(): void {
  shared?.dispose();
  shared = null;
  failed = false;
}
