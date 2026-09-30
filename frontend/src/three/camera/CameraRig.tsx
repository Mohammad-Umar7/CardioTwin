import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useManifest } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useViewerStore } from '@/state/viewerStore';
import { cameraRigApi } from './controlsApi';
import { HOME_DISTANCE, PROJECTIONS, bestViewFor, fromControlsAngles, toControlsAngles } from './presets';

const DEG = Math.PI / 180;
/** Landing turntable: 6°/s, stops on pointer-down, resumes after 8 s idle (DESIGN_SYSTEM §6). */
const TURNTABLE_RAD_PER_S = 6 * DEG;
const TURNTABLE_RESUME_MS = 8000;
const HERO_DISTANCE = 5.4;
/** Camera field of view (DESIGN_SYSTEM §7.1). */
export const CAMERA_FOV = 30;

/**
 * Camera (DESIGN_SYSTEM §7.1, §7.5): drei CameraControls with distance 2.2–9, polar 20°–160°, pan only
 * with Shift-drag, smoothTime 0.35 / draggingSmoothTime 0.12. Executes viewer-store camera commands
 * (home, C-arm projections, fly-to-vessel best views on a sphere around the heart), runs the landing
 * turntable and publishes the live C-arm readout.
 */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null);
  const manifest = useManifest().data;
  const stage = useViewerStore((s) => s.stage);
  const command = useViewerStore((s) => s.cameraCommand);
  const reduced = useReducedMotion();
  const invalidate = useThree((s) => s.invalidate);
  const lastInteraction = useRef(0);
  const lastReadout = useRef({ t: 0, az: NaN, el: NaN });

  // Workstation home frames the heart (manifest `camera.heart`, additive) so the heart is the largest
  // element. The landing hero looks at the heart from the direction of the manifest's torso `home` pose,
  // a little further back, so the ghosted chest frames it while it turns.
  const heartPose = manifest?.camera.heart ?? manifest?.camera.home;
  const home = heartPose;
  const homeTarget = new Vector3(...((heartPose?.target as number[] | undefined) ?? [0, 0, 0]));
  const homePosition = new Vector3(...((heartPose?.position as number[] | undefined) ?? [0, 0.3, HOME_DISTANCE]));
  // Poses authored for another field of view keep their framing at our fixed 30° (§7.1).
  const poseFov = heartPose?.fov ?? manifest?.camera.fov;
  if (poseFov && poseFov !== CAMERA_FOV) {
    const k = Math.tan(((poseFov / 2) * Math.PI) / 180) / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
    homePosition.sub(homeTarget).multiplyScalar(k).add(homeTarget);
  }
  const torso = manifest?.camera.home;
  const heroDirection = torso
    ? new Vector3(...(torso.position as number[])).sub(new Vector3(...(torso.target as number[]))).normalize()
    : new Vector3(0, 0.05, 1).normalize();

  // Expose controls; Shift-drag pans (truck), otherwise left-drag rotates.
  useEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    cameraRigApi.controls = controls;
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    const onKey = (e: KeyboardEvent) => {
      controls.mouseButtons.left = e.shiftKey ? CameraControlsImpl.ACTION.TRUCK : CameraControlsImpl.ACTION.ROTATE;
    };
    const onStart = () => {
      lastInteraction.current = performance.now();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    controls.addEventListener('controlstart', onStart);
    controls.addEventListener('control', onStart);
    return () => {
      cameraRigApi.controls = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      controls.removeEventListener('controlstart', onStart);
      controls.removeEventListener('control', onStart);
    };
  }, []);

  // Stage poses: both look at the heart centre; the hero sits further back on the torso axis.
  useEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    const pos =
      stage === 'hero'
        ? homeTarget.clone().addScaledVector(heroDirection, HERO_DISTANCE)
        : homePosition.clone();
    void controls.setLookAt(pos.x, pos.y, pos.z, homeTarget.x, homeTarget.y, homeTarget.z, !reduced && stage !== 'hidden');
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, home]);

  // Camera commands from the UI (home, projections, fly-to-vessel).
  useEffect(() => {
    const controls = ref.current;
    if (!controls || !command) return;
    const animate = !reduced;
    if (command.kind === 'home') {
      void controls.setLookAt(homePosition.x, homePosition.y, homePosition.z, homeTarget.x, homeTarget.y, homeTarget.z, animate);
    } else if (command.kind === 'preset' && command.preset) {
      const preset = PROJECTIONS.find((p) => p.id === command.preset);
      if (preset) {
        const { azimuth, polar } = toControlsAngles(preset.azimuth, preset.elevation);
        void controls.moveTo(homeTarget.x, homeTarget.y, homeTarget.z, animate);
        void controls.rotateTo(azimuth, polar, animate);
      }
    } else if (command.kind === 'focus' && command.target) {
      const structure = manifest?.structures.find((s) => s.target === command.target && s.bestView);
      const view = bestViewFor(command.target, structure?.bestView);
      const { azimuth, polar } = toControlsAngles(view.azimuth, view.elevation);
      void controls.moveTo(homeTarget.x, homeTarget.y, homeTarget.z, animate);
      void controls.rotateTo(azimuth, polar, animate);
      void controls.dollyTo(view.distance, animate);
    }
    lastInteraction.current = performance.now();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce]);

  useFrame((_, delta) => {
    const controls = ref.current;
    if (!controls) return;
    // Landing turntable only; never in the workstation.
    if (stage === 'hero' && !reduced && performance.now() - lastInteraction.current > TURNTABLE_RESUME_MS) {
      controls.azimuthAngle += TURNTABLE_RAD_PER_S * Math.min(delta, 0.1);
    }
    // C-arm readout, throttled to ~8 Hz and to visible changes.
    const now = performance.now();
    if (now - lastReadout.current.t > 120) {
      const { azimuth, elevation } = fromControlsAngles(controls.azimuthAngle, controls.polarAngle);
      const last = lastReadout.current;
      if (!Number.isFinite(last.az) || Math.abs(azimuth - last.az) >= 0.5 || Math.abs(elevation - last.el) >= 0.5) {
        lastReadout.current = { t: now, az: azimuth, el: elevation };
        useViewerStore.getState().setCarm({ azimuth, elevation });
      }
    }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      regress
      minDistance={2.2}
      maxDistance={9}
      minPolarAngle={20 * DEG}
      maxPolarAngle={160 * DEG}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
      truckSpeed={1}
    />
  );
}
