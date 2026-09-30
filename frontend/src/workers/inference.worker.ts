/**
 * Inference worker: evaluates the portable model (`model.json`) off the main thread.
 * A thin postMessage shell around `inference/handler.ts`; talk to it through `InferenceClient`
 * (`@/inference`), never directly. Protocol: `inference/protocol.ts`.
 */
import { createInferenceHandler } from '@/inference/handler';
import type { InferenceRequest, InferenceResponse } from '@/inference/protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<InferenceRequest>) => void) | null;
  postMessage(message: InferenceResponse): void;
}

const scope = self as unknown as WorkerScope;
const handler = createInferenceHandler();

scope.onmessage = (event) => {
  void handler.handle(event.data).then((response) => {
    if (response) scope.postMessage(response);
  });
};
