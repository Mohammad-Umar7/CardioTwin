import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { useManifest, useVessels } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore, type Stage } from '@/state/viewerStore';
import type { CameraPose } from '@/types/contracts';
import { buildTracks } from '../labels/anchorTracks';
import { visibleBestView } from './bestView';
import { angleLabel, useCameraState } from './cameraState';
import { cameraRigApi } from './controlsApi';
import {
  HERO_HEART_SHARE,
  WORKSTATION_HEART_SHARE,
  ZERO_OFFSET,
  framingDistance,
  freeArea,
  glide,
  heartBox,
  sameOffset,
  viewOffsetFor,
  type Insets,
  type Offset,
} from './framing';
import { CameraHistory, type Pose } from './history';
import { PROJECTIONS, bestViewFor, fromControlsAngles, toControlsAngles } from './presets';

const DEG = Math.PI / 180;
/** Landing turntable: 6°/s, stops on pointer-down, resumes after 8 s idle (DESIGN_SYSTEM §6). */
const TURNTABLE_RAD_PER_S = 6 * DEG;
const TURNTABLE_RESUME_MS = 8000;
/** Camera field of view (DESIGN_SYSTEM §7.1). */
export const CAMERA_FOV = 30;
/** A vessel's best view sits a touch closer than home so the selection reads as "going to it". */
const FOCUS_ZOOM = 0.9;

/**
 * Orbit limits (V2 §5.15): in the default mode the polar angle is clamped to 35°–145° and the distance
 * to 2.4–7 so nobody can lose the heart; ⋯ › Free orbit lifts both.
 */
export const ORBIT_LIMITS = {
  clamped: { minPolar: 35 * DEG, maxPolar: 145 * DEG, minDistance: 2.4, maxDistance: 7 },
  free: { minPolar: 1 * DEG, maxPolar: 179 * DEG, minDistance: 1.2, maxDistance: 12 },
} as const;

const ZERO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

const toVec = (v: readonly number[] | undefined, fallback: Vector3) =>
  v && v.length >= 3 ? new Vector3(v[0], v[1], v[2]) : fallback.clone();

function poseOf(controls: CameraControlsImpl): Pose {
  const p = controls.getPosition(new Vector3());
  const t = controls.getTarget(new Vector3());
  return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
}

/** Stage insets as the camera should honour them: the page's published free area, none when parked. */
function insetsFor(stage: Stage): Insets {
  return stage === 'hidden' ? ZERO_INSETS : useUiStore.getState().stageInsets;
}

/**
 * Camera (DESIGN_SYSTEM §7.1, §7.5; WORKSTATION_V2 §4.1, §5.15, §8.2): drei CameraControls with Shift-drag
 * pan, smoothTime 0.35 / draggingSmoothTime 0.12. It
 *   - frames the heart at 62 % of the free-area height (workstation home, projections, best views) and at
 *     ~58 % of the hero height on the landing, solved from the manifest's heart box for each direction;
 *   - centres the orbit target in the free area with `camera.setViewOffset`, gliding over `flyout` (360 ms)
 *     whenever `uiStore.stageInsets` change — chrome never resizes the canvas;
 *   - executes viewer-store camera commands (home, C-arm projections, fly-to-vessel best views);
 *   - remembers the pose before a selection (`viewerStore.cameraReturn`) and flies back to it when the
 *     selection is cleared by Esc / ✕ / an empty click (H flies home instead) — Primal's reversible modes;
 *   - records settled poses for Back / Forward, publishes the View-menu label, the live C-arm readout and
 *     the first-frame signal, and runs the landing turntable.
 */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null);
  const manifest = useManifest().data;
  const vessels = useVessels().data;
  const stage = useViewerStore((s) => s.stage);
  const command = useViewerStore((s) => s.cameraCommand);
  const freeOrbit = useCameraState((s) => s.freeOrbit);
  const request = useCameraState((s) => s.request);
  const reduced = useReducedMotion();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const lastInteraction = useRef(0);
  const lastReadout = useRef({ t: 0, az: NaN, el: NaN });
  const stageEnteredAt = useRef(0);
  const framedFreeHeight = useRef(0);
  const history = useRef(new CameraHistory());
  const replaying = useRef(false);
  const readyFrames = useRef(0);
  const offset = useRef<{ from: Offset; to: Offset; current: Offset; t0: number; applied: string }>({
    from: ZERO_OFFSET,
    to: ZERO_OFFSET,
    current: ZERO_OFFSET,
    t0: 0,
    applied: '',
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // Heart geometry from the manifest: target, heart box, workstation and hero directions.
  const geo = useMemo(() => {
    const heartPose = manifest?.camera.heart ?? manifest?.camera.home;
    const box = heartBox(manifest);
    const target = toVec(heartPose?.target as number[] | undefined, box.getCenter(new Vector3()));
    const position = toVec(heartPose?.position as number[] | undefined, target.clone().add(new Vector3(0.24, 0.19, 0.95)));
    const direction = position.sub(target).normalize();
    const torso = manifest?.camera.home;
    const heroDirection = torso
      ? toVec(torso.position as number[], new Vector3(0, 0.3, 6)).sub(toVec(torso.target as number[], new Vector3())).normalize()
      : new Vector3(0, 0.05, 1).normalize();
    return { box, target, direction, heroDirection };
  }, [manifest]);

  // Trunk candidates per vessel, to make sure a best view really shows its vessel (P0-2).
  const tracks = useMemo(() => buildTracks(manifest, vessels, ['LAD', 'LCX', 'RCA']), [manifest, vessels]);

  const limits = freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped;

  /** Distance that frames the heart for `direction` at the stage's share of the current free area. */
  const distanceFor = (direction: Vector3, forStage: Stage = stageRef.current): number => {
    const { width, height } = sizeRef.current;
    if (!(width > 0) || !(height > 0)) return 3.6;
    const free = freeArea(width, height, insetsFor(forStage));
    const share =
      forStage === 'hero' ? Math.min(0.8, (HERO_HEART_SHARE * height) / Math.max(1, free.height)) : WORKSTATION_HEART_SHARE;
    const d = framingDistance({
      box: geo.box,
      target: geo.target,
      direction,
      fov: CAMERA_FOV,
      width,
      height,
      freeWidth: free.width,
      freeHeight: free.height,
      share,
    });
    framedFreeHeight.current = free.height;
    const l = useCameraState.getState().freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped;
    return Math.min(l.maxDistance, Math.max(l.minDistance, d));
  };

  const flyTo = (direction: Vector3, distance: number, animate: boolean) => {
    const controls = ref.current;
    if (!controls) return;
    const pos = geo.target.clone().addScaledVector(direction, distance);
    void controls.setLookAt(pos.x, pos.y, pos.z, geo.target.x, geo.target.y, geo.target.z, animate);
    lastInteraction.current = performance.now();
    invalidate();
  };

  const flyHome = (animate: boolean) => {
    const direction = stageRef.current === 'hero' ? geo.heroDirection : geo.direction;
    flyTo(direction, distanceFor(direction), animate);
  };

  const flyToPose = (pose: Pose | CameraPose, animate: boolean) => {
    const controls = ref.current;
    if (!controls) return;
    const [px, py, pz] = pose.position as number[];
    const [tx, ty, tz] = pose.target as number[];
    void controls.setLookAt(px!, py!, pz!, tx!, ty!, tz!, animate);
    invalidate();
  };

  // Expose controls; Shift-drag pans (truck), otherwise left-drag rotates. User input → "Custom" view.
  useEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    cameraRigApi.controls = controls;
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    const onKey = (e: KeyboardEvent) => {
      controls.mouseButtons.left = e.shiftKey ? CameraControlsImpl.ACTION.TRUCK : CameraControlsImpl.ACTION.ROTATE;
    };
    const onUser = () => {
      lastInteraction.current = performance.now();
      replaying.current = false;
      if (useCameraState.getState().viewKind !== 'custom') useCameraState.getState().setView('custom');
    };
    const onControl = () => {
      lastInteraction.current = performance.now();
    };
    const onRest = () => {
      if (stageRef.current !== 'workstation') return;
      if (replaying.current) {
        replaying.current = false;
        return;
      }
      history.current.push(poseOf(controls));
      useCameraState.getState().setHistory(history.current.canBack, history.current.canForward);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    controls.addEventListener('controlstart', onUser);
    controls.addEventListener('control', onControl);
    controls.addEventListener('sleep', onRest);
    return () => {
      cameraRigApi.controls = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      controls.removeEventListener('controlstart', onUser);
      controls.removeEventListener('control', onControl);
      controls.removeEventListener('sleep', onRest);
    };
  }, []);

  // Stage poses: the workstation home frames the heart in the free area; the hero sits on the torso axis.
  useEffect(() => {
    if (!ref.current) return;
    stageEnteredAt.current = performance.now();
    flyHome(!reduced && stage !== 'hidden');
    if (stage === 'workstation') useCameraState.getState().setView('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, geo]);

  // Re-frame once if the page published its free area just after the stage switched (cold load), as long
  // as nobody has touched the camera yet.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (s.stageInsets === prev.stageInsets) return;
        invalidate();
        const st = stageRef.current;
        if (st === 'hidden' || performance.now() - stageEnteredAt.current > 900) return;
        if (lastInteraction.current > stageEnteredAt.current + 50) return;
        const { width, height } = sizeRef.current;
        const free = freeArea(width, height, insetsFor(st));
        if (Math.abs(free.height - framedFreeHeight.current) > 0.08 * height) flyHome(!reducedRef.current);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo, invalidate],
  );

  // Camera commands from the UI (home, projections, fly-to-vessel).
  useEffect(() => {
    const controls = ref.current;
    if (!controls || !command) return;
    const animate = !reduced;
    const state = useCameraState.getState();
    if (command.kind === 'home') {
      flyHome(animate);
      state.setView('home');
    } else if (command.kind === 'preset' && command.preset) {
      const preset = PROJECTIONS.find((p) => p.id === command.preset);
      if (preset) {
        const { azimuth, polar } = toControlsAngles(preset.azimuth, preset.elevation);
        const direction = new Vector3().setFromSphericalCoords(1, polar, azimuth);
        flyTo(direction, distanceFor(direction), animate);
        state.setView('preset', { presetId: preset.id });
      }
    } else if (command.kind === 'focus' && command.target) {
      const structure = manifest?.structures.find((s) => s.target === command.target && s.bestView);
      const conventional = bestViewFor(command.target, structure?.bestView);
      const candidates = tracks.find((t) => t.target === command.target)?.candidates ?? [];
      const view = visibleBestView(conventional, candidates, geo.target);
      const { azimuth, polar } = toControlsAngles(view.azimuth, view.elevation);
      const direction = new Vector3().setFromSphericalCoords(1, polar, azimuth);
      flyTo(direction, distanceFor(direction) * FOCUS_ZOOM, animate);
      state.setView('focus', { label: angleLabel(view.azimuth, view.elevation) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce]);

  // Reversible selection (V2 §8.2): remember the pose before a selection; fly back when it is cleared
  // without a home command (H clears too, but flies home).
  useEffect(
    () =>
      useViewerStore.subscribe((s, prev) => {
        const controls = ref.current;
        if (!controls || s.stage !== 'workstation') return;
        if (s.selectedStructure && !prev.selectedStructure && !s.cameraReturn) {
          const pose = poseOf(controls);
          s.setCameraReturn({ position: pose.position, target: pose.target });
        } else if (!s.selectedStructure && prev.selectedStructure) {
          const homeCommand = s.cameraCommand !== prev.cameraCommand && s.cameraCommand?.kind === 'home';
          const back = s.cameraReturn;
          if (back) s.setCameraReturn(null);
          if (!homeCommand && back) {
            flyToPose(back, !reducedRef.current);
            useCameraState.getState().setView('custom');
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Back / Forward through the settled poses.
  useEffect(() => {
    if (!request) return;
    const pose = request.kind === 'back' ? history.current.back() : history.current.forward();
    useCameraState.getState().setHistory(history.current.canBack, history.current.canForward);
    if (!pose) return;
    replaying.current = true;
    flyToPose(pose, !reduced);
    useCameraState.getState().setView('custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  useFrame((_, delta) => {
    const controls = ref.current;
    if (!controls) return;
    const now = performance.now();

    // View offset: the orbit target sits at the centre of the free area; glides over `flyout`.
    const { width, height } = size;
    const off = offset.current;
    const goal = viewOffsetFor(width, height, insetsFor(stage));
    if (!sameOffset(goal, off.to)) {
      off.from = off.current;
      off.to = goal;
      off.t0 = now;
    }
    off.current = reduced || off.applied === '' ? goal : glide(off.from, off.to, now - off.t0);
    const key = `${width}x${height}:${off.current.x.toFixed(2)},${off.current.y.toFixed(2)}`;
    if (key !== off.applied && width > 0 && height > 0) {
      off.applied = key;
      camera.setViewOffset(width, height, -off.current.x, -off.current.y, width, height);
      camera.updateProjectionMatrix();
    }
    if (!sameOffset(off.current, off.to, 0.01)) invalidate();

    // Landing turntable only; never in the workstation.
    if (stage === 'hero' && !reduced && now - lastInteraction.current > TURNTABLE_RESUME_MS) {
      controls.azimuthAngle += TURNTABLE_RAD_PER_S * Math.min(delta, 0.1);
    }

    // First frame with anatomy (V2 §5.18): the slot crossfades the poster away on this signal.
    if (!useCameraState.getState().firstFrame && stage !== 'hidden') {
      if (useViewerStore.getState().anatomySource !== 'loading') {
        readyFrames.current += 1;
        if (readyFrames.current >= 2) useCameraState.getState().markFirstFrame();
        else invalidate();
      }
    }

    // C-arm readout, throttled to ~8 Hz and to visible changes.
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
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      minPolarAngle={limits.minPolar}
      maxPolarAngle={limits.maxPolar}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
      truckSpeed={1}
    />
  );
}
