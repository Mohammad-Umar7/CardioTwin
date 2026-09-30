import type CameraControlsImpl from 'camera-controls';

const DEG = Math.PI / 180;

/**
 * Shared handle on the active camera controls (set by CameraRig) for DOM-side keyboard control, and the
 * rig's peel follower, which the anatomy calls right after it has moved the pieces for this frame (so the
 * camera frames exactly what is drawn, never last frame's peel value).
 */
export const cameraRigApi: { controls: CameraControlsImpl | null; followPeel: (() => void) | null } = { controls: null, followPeel: null };

/** Canvas keyboard: arrows orbit 15°, +/− zoom (DESIGN_SYSTEM §10.3). Returns true when handled. */
export function handleCanvasKey(key: string): boolean {
  const controls = cameraRigApi.controls;
  if (!controls) return false;
  const step = 15 * DEG;
  switch (key) {
    case 'ArrowLeft':
      void controls.rotate(-step, 0, true);
      return true;
    case 'ArrowRight':
      void controls.rotate(step, 0, true);
      return true;
    case 'ArrowUp':
      void controls.rotate(0, -step, true);
      return true;
    case 'ArrowDown':
      void controls.rotate(0, step, true);
      return true;
    case '+':
    case '=':
      void controls.dolly(0.6, true);
      return true;
    case '-':
    case '_':
      void controls.dolly(-0.6, true);
      return true;
    default:
      return false;
  }
}
