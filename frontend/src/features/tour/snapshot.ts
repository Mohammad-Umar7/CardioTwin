/**
 * "No residual state" (WORKSTATION_V2 §6.3, §9.3 E accept): the guided demo records everything it may
 * change when it opens and puts it back when it closes — the patient and its edits, the reveal, the
 * selection and camera pose, the peel, isolate/ghost, territory mode, the chrome preset, drawers and the
 * patient card — and returns to the route it started from.
 */
import { Vector3 } from 'three';
import { cameraRigApi } from '@/three/camera/controlsApi';
import { usePatientStore, type PatientState } from '@/state/patientStore';
import { useUiStore, type UiState } from '@/state/uiStore';
import { useViewerStore, type ViewerState } from '@/state/viewerStore';

const PATIENT_KEYS = [
  'selectedPatientId',
  'split',
  'mode',
  'recorded',
  'features',
  'prediction',
  'previous',
  'baseline',
  'recordedPrediction',
  'comparing',
  'revealed',
] as const satisfies readonly (keyof PatientState)[];

const VIEWER_KEYS = [
  'selectedStructure',
  'hoveredStructure',
  'explode',
  'layerVisibility',
  'territoryMode',
  'territories',
  'isolate',
  'ghostOthers',
  'labels',
  'look',
  'viewMode',
] as const satisfies readonly (keyof ViewerState)[];

const UI_KEYS = [
  'chrome',
  'drawer',
  'explainTab',
  'focusField',
  'inputsSection',
  'patientCardOpen',
  'paletteOpen',
  'highlightedFeature',
] as const satisfies readonly (keyof UiState)[];

type Pick2<T, K extends readonly (keyof T)[]> = Pick<T, K[number]>;

export interface CameraPoseSnapshot {
  position: [number, number, number];
  target: [number, number, number];
}

export interface TourSnapshot {
  /** Route (pathname + search) to return to. */
  route: string;
  patient: Pick2<PatientState, typeof PATIENT_KEYS>;
  viewer: Pick2<ViewerState, typeof VIEWER_KEYS>;
  ui: Pick2<UiState, typeof UI_KEYS>;
  camera: CameraPoseSnapshot | null;
}

function pick<T extends object, K extends readonly (keyof T)[]>(state: T, keys: K): Pick2<T, K> {
  const out = {} as Pick2<T, K>;
  for (const k of keys) (out as Record<keyof T, unknown>)[k] = state[k];
  return out;
}

/** Current camera pose from the rig, when a 3D stage is live (null on tier D or when parked). */
export function readCameraPose(): CameraPoseSnapshot | null {
  const controls = cameraRigApi.controls;
  if (!controls) return null;
  try {
    const p = controls.getPosition(new Vector3());
    const t = controls.getTarget(new Vector3());
    const ok = [p.x, p.y, p.z, t.x, t.y, t.z].every(Number.isFinite);
    return ok ? { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] } : null;
  } catch {
    return null;
  }
}

export function captureSnapshot(route: string): TourSnapshot {
  return {
    route,
    patient: pick(usePatientStore.getState(), PATIENT_KEYS),
    viewer: pick(useViewerStore.getState(), VIEWER_KEYS),
    ui: pick(useUiStore.getState(), UI_KEYS),
    camera: readCameraPose(),
  };
}

/**
 * Puts the stores back. The selection is written directly (no camera command), and the camera pose is
 * restored separately by `restoreCamera` once the stage it belongs to is live.
 */
export function restoreStores(snap: TourSnapshot): void {
  // The patient's data fields wholesale: the prediction sync re-runs because `features` changes identity,
  // and the restored prediction (deterministic for those inputs) avoids a stale flash meanwhile.
  usePatientStore.setState({ ...snap.patient, comparing: false });
  useViewerStore.setState({ ...snap.viewer });
  useUiStore.setState({ ...snap.ui });
}

/** Glides the camera back to the recorded pose. Returns false when no rig is available. */
export function restoreCamera(pose: CameraPoseSnapshot | null, animate: boolean): boolean {
  const controls = cameraRigApi.controls;
  if (!pose || !controls) return false;
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  void controls.setLookAt(px, py, pz, tx, ty, tz, animate);
  return true;
}
