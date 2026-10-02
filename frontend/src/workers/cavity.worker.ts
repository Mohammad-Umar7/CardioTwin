/**
 * Cavity worker: computes the heart walls' `aCavity` attribute (`three/anatomy/cavity.ts`) off the main thread.
 * One message per wall; the result's buffer is transferred back. Talk to it through GlbAnatomy, never directly.
 *
 * WHY: one wall took 80–370 ms on the main thread, and the walls were computed while the cold-load assembly and
 * the first beats played — each one a visible stall.
 */
import { cavityAttribute, type CavityInput, type CentrelinePoint } from '@/three/anatomy/cavity';

export interface CavityRequest {
  id: number;
  input: CavityInput;
  points: CentrelinePoint[];
}

export interface CavityResponse {
  id: number;
  values: Float32Array;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<CavityRequest>) => void) | null;
  postMessage(message: CavityResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, input, points } = event.data;
  const values = cavityAttribute(input, points);
  scope.postMessage({ id, values }, [values.buffer]);
};
