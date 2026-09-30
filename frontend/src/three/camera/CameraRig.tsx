import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, Vector3, type PerspectiveCamera } from 'three';
import { useManifest, useVessels } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore, type Stage } from '@/state/viewerStore';
import type { CameraPose, TargetId } from '@/types/contracts';
import { buildTracks } from '../labels/anchorTracks';
import { SURFACE_PREFERRED, surfaceBestView, type SurfaceViewScore } from './bestView';
import { collectOccluders, isOccluded } from './occlusion';
import { angleLabel, useCameraState, type ViewKind } from './cameraState';
import { sceneRuntime } from '../stage/sceneRuntime';
import { cameraRigApi } from './controlsApi';
import {
  HERO_HEART_SHARE,
  WORKSTATION_HEART_SHARE,
  ZERO_OFFSET,
  centringBias,
  containDistance,
  fitCentredDistance,
  framingDistance,
  freeArea,
  glide,
  PEEL_OPEN_AT,
  heartBox,
  opaqueThoraxBox,
  openPointsAt,
  projectedExtent,
  sameOffset,
  viewOffsetFor,
  type Insets,
  type Offset,
  type PeelMode,
} from './framing';
import { CameraHistory, type Pose } from './history';
import { PROJECTIONS, bestViewFor, fromControlsAngles, toControlsAngles } from './presets';

const DEG = Math.PI / 180;
/** Landing turntable: 6°/s, stops on pointer-down, resumes after 8 s idle (DESIGN_SYSTEM §6). */
const TURNTABLE_RAD_PER_S = 6 * DEG;
const TURNTABLE_RESUME_MS = 8000;
/** Camera field of view (DESIGN_SYSTEM §7.1). */
export const CAMERA_FOV = 30;
/** Thorax view: the exploded thorax fills this share of the free area, 7–18 units away. */
const THORAX_DISTANCE = 7;
const THORAX_MAX_DISTANCE = 18;
const THORAX_SHARE = 0.9;
/**
 * Open-heart framing: the camera fits both exploded halves (with the fat, the coronaries and the lifted great
 * vessels riding them) into the free area with a 6 % margin — the anterior half swings toward viewer-left,
 * which would otherwise put it under the patient card.
 */
const OPEN_FIT_MARGIN = 0.06;
/** Half-width of the rest detent's "heart" zone of the displayed peel value (the camera is free there). */
const HEART_ZONE = 0.004;
/**
 * The closed-chest framing holds up to this peel value (the whole rib cage in view while it starts to open,
 * like an atlas plate); from here to the rest detent the camera's distance falls log-linearly with the peel,
 * so "Ribs open" (0.45) already shows the heart at ~40 % of the free height while the ribs swing out of the
 * frame, and under the player's sine easing no half-second holds more than half of the dolly (no crash-zoom).
 */
const THORAX_FULL_UNTIL = 0.2;
/** Share of the trunk a best view must show (proximal 5–80 %). */
const VIEW_WINDOW: readonly [number, number] = [0.05, 0.8];
/** Margin (px) between the free-area edge and the visible great vessels (≥ 24 px from the canvas top). */
const KEEP_MARGIN = 12;
/** A vessel's best view keeps the home distance for its angle: the target leaning onto the vessel is the "going to it". */
const FOCUS_ZOOM = 1;
/**
 * Room kept free at the top of the free area while a vessel is selected: the selection chip (12 + 32 px)
 * and a 24 px margin, so no great vessel runs under it.
 */
const SELECTION_CHIP_ROOM = 68;
/**
 * A selection view centres a blend of the selected vessel (42 %) and the heart walls (58 %): the vessel is the
 * subject and stays well inside the free area, but the heart stays balanced (within ~32 px of the centre)
 * instead of riding high with an empty lower third.
 */
const VESSEL_WEIGHT = 0.42;

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

const poseDistance = (a: Pose, b: Pose) =>
  Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]) +
  Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1], a.target[2] - b.target[2]);

/** The camera moved (more than a rounding error) between two poses. */
const movedFrom = (a: Pose, b: Pose) => poseDistance(a, b) > 2e-3;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A camera pose the peel follower computes: orbit target, distance along the view direction, view-offset bias. */
interface PeelPose {
  target: Vector3;
  distance: number;
  bias: Offset;
}

/** The heart-zone pose the peel follower leaves from and returns to, with its View-menu state. */
interface PeelAnchor extends PeelPose {
  home: boolean;
  kind: ViewKind;
  presetId: string | null;
  label: string;
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
  const reduced = useIsReducedMotion();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const lastInteraction = useRef(0);
  /** The user has orbited / zoomed / panned since the stage was entered (automatic re-framing stops). */
  const userTouched = useRef(false);
  const lastReadout = useRef({ t: 0, az: NaN, el: NaN });
  const stageEnteredAt = useRef(0);
  const framedFreeHeight = useRef(0);
  const history = useRef(new CameraHistory());
  const replaying = useRef(false);
  const readyFrames = useRef(0);
  /** The View-menu state that goes with `viewerStore.cameraReturn`. */
  const returnView = useRef<{ kind: ViewKind; presetId: string | null; label: string; bias: Offset; zone: PeelMode } | null>(null);
  /** A vessel flown to before its centrelines loaded (re-checked when they arrive). */
  const pendingVessel = useRef<{ target: TargetId; at: number } | null>(null);
  /** Visible best view per vessel (the search raycasts, so it runs once per anatomy). */
  const bestViews = useRef(new Map<string, SurfaceViewScore>());
  const offset = useRef<{ from: Offset; to: Offset; current: Offset; t0: number; applied: string }>({
    from: ZERO_OFFSET,
    to: ZERO_OFFSET,
    current: ZERO_OFFSET,
    t0: 0,
    applied: '',
  });
  /** Screen shift (px) that centres the heart's silhouette instead of the orbit target (set per flight). */
  const silhouetteBias = useRef<Offset>(ZERO_OFFSET);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const freeOrbitRef = useRef(freeOrbit);
  freeOrbitRef.current = freeOrbit;

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

  // Centre of each vessel target's anatomy (union of its manifest boxes, rest frame), for the selection focus.
  const vesselCentres = useMemo(() => {
    const out = new Map<string, Vector3>();
    for (const t of ['LAD', 'LCX', 'RCA']) {
      const box = new Box3();
      for (const s of manifest?.structures ?? []) {
        const raw = s as unknown as { target?: string; bbox?: { min: number[]; max: number[] } };
        if (raw.target !== t || !raw.bbox || raw.bbox.min.length < 3) continue;
        box.expandByPoint(new Vector3(raw.bbox.min[0], raw.bbox.min[1], raw.bbox.min[2]));
        box.expandByPoint(new Vector3(raw.bbox.max[0], raw.bbox.max[1], raw.bbox.max[2]));
      }
      if (!box.isEmpty()) out.set(t, box.getCenter(new Vector3()));
    }
    return out;
  }, [manifest]);

  // Every centreline point of each target's whole tree (the LAD with its diagonals and septals, the LCX with
  // its marginals, the RCA with its marginal, PDA and posterolateral branches), to centre the selected vessel —
  // not its trunk's first centimetres — in the free area.
  const vesselSamples = useMemo(() => {
    const out = new Map<string, Vector3[]>();
    for (const v of (vessels?.vessels ?? []) as unknown as { id?: string; target?: string; segments: { points: number[][] }[] }[]) {
      const t = v.target ?? v.id;
      if (!t || !['LAD', 'LCX', 'RCA'].includes(t)) continue;
      const pts = out.get(t) ?? [];
      for (const seg of v.segments) for (let i = 0; i < seg.points.length; i += 2) pts.push(new Vector3(seg.points[i]![0], seg.points[i]![1], seg.points[i]![2]));
      out.set(t, pts);
    }
    return out;
  }, [vessels]);

  // Trunk samples per vessel, to make sure a best view really shows its vessel (P0-2). The view search
  // looks at the proximal 80 % of the trunk (the labels anchor on the proximal–mid 60 %).
  const tracks = useMemo(() => {
    bestViews.current.clear();
    return buildTracks(manifest, vessels, ['LAD', 'LCX', 'RCA'], VIEW_WINDOW, 14);
  }, [manifest, vessels]);

  const limits = freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped;
  // While the peel shows the thorax the camera may sit further out than the orbit clamp.
  const [thoraxView, setThoraxView] = useState(false);

  /** Distance that frames the heart for `direction` at the stage's share of the current free area. */
  const distanceFor = (direction: Vector3, forStage: Stage = stageRef.current): number => {
    const { width, height } = sizeRef.current;
    if (!(width > 0) || !(height > 0)) return 3.6;
    const free = freeArea(width, height, insetsFor(forStage));
    const share =
      forStage === 'hero' ? Math.min(0.8, (HERO_HEART_SHARE * height) / Math.max(1, free.height)) : WORKSTATION_HEART_SHARE;
    const { heart, keep } = sceneRuntime.framing;
    const d = framingDistance({
      box: geo.box,
      // The real walls' silhouette (not their box) fills the share; the visible great vessels stay inside.
      points: heart,
      keep,
      // The hero is full-bleed under the top bar: its fading vessels may reach the free area's edge.
      keepMargin: forStage === 'hero' ? 0 : KEEP_MARGIN,
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

  const flyTo = (direction: Vector3, distance: number, animate: boolean, focus: Vector3 | null = null) => {
    const controls = ref.current;
    if (!controls) return;
    const target = focus ?? geo.target;
    // Centre the heart's real silhouette (not the orbit target) in the free area: the walls are not
    // symmetric about the target, so the view offset takes the small remainder (a few px). A focus point
    // (a selected vessel) is centred itself.
    const points = sceneRuntime.framing.heart;
    const { width, height } = sizeRef.current;
    if (!focus && points.length > 0 && width > 0 && height > 0) {
      const e = projectedExtent({ target, direction, fov: CAMERA_FOV, width, height }, points, distance);
      silhouetteBias.current = { x: -(e.right - e.left) / 2, y: -(e.down - e.up) / 2 };
    } else silhouetteBias.current = ZERO_OFFSET;
    const pos = target.clone().addScaledVector(direction, distance);
    void controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, animate);
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
    // Through a ref: the follower closes over this render's manifest-derived geometry.
    cameraRigApi.followPeel = () => {
      if (stageRef.current === 'workstation') followPeelRef.current?.();
    };
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    const onKey = (e: KeyboardEvent) => {
      controls.mouseButtons.left = e.shiftKey ? CameraControlsImpl.ACTION.TRUCK : CameraControlsImpl.ACTION.ROTATE;
    };
    // A press that does not move the camera (a click to select, to focus the canvas before pressing a key) is
    // not an orbit: the view becomes "Custom" only once the pose really changes.
    let pressed: Pose | null = null;
    const onUser = () => {
      lastInteraction.current = performance.now();
      replaying.current = false;
      pressed = poseOf(controls);
    };
    const onControl = () => {
      lastInteraction.current = performance.now();
      if (!pressed || !movedFrom(pressed, poseOf(controls))) return;
      pressed = null;
      userTouched.current = true;
      if (useCameraState.getState().viewKind !== 'custom') useCameraState.getState().setView('custom');
    };
    const onRest = () => {
      if (stageRef.current !== 'workstation') return;
      if (replaying.current) {
        replaying.current = false;
        return;
      }
      const pose = poseOf(controls);
      history.current.push(pose);
      useCameraState.getState().setHistory(history.current.canBack, history.current.canForward);
      // The View label follows the actual pose: back exactly at home (by any path) reads "Home".
      if (useCameraState.getState().viewKind !== 'home' && latest.current?.isHomePose(pose)) useCameraState.getState().setView('home');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    controls.addEventListener('controlstart', onUser);
    controls.addEventListener('control', onControl);
    controls.addEventListener('sleep', onRest);
    return () => {
      cameraRigApi.controls = null;
      cameraRigApi.followPeel = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      controls.removeEventListener('controlstart', onUser);
      controls.removeEventListener('control', onControl);
      controls.removeEventListener('sleep', onRest);
    };
  }, []);

  // Stage poses: the workstation home frames the heart in the free area; the hero sits on the torso axis.
  // Entering a stage always starts from that stage's own pose: no peel pull-back, open-heart fit or
  // selection pose carries over from another page (the landing hero is never left zoomed out).
  // A stage change SNAPS to the new stage's pose and view offset (no glide from the previous page's framing:
  // the slot hides the canvas for the frames of the move, and the first frame it shows is already framed).
  useEffect(() => {
    if (!ref.current) return;
    stageEnteredAt.current = performance.now();
    userTouched.current = false;
    resetPeel();
    setThoraxView(false);
    flyHome(false);
    offset.current.applied = '';
    if (stage === 'workstation') {
      useCameraState.getState().setView('home');
      // Arriving on an already opened heart or a closed chest (a deep link, a reload, the tour): the follower
      // frames that state on the next frame.
      peel.current.dirty = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, geo]);

  // The stage switch itself (SceneHost moves the canvas in a layout effect, before the next frame): snap the
  // new stage's pose, projection and view offset SYNCHRONOUSLY, from the canvas's new CSS size — the first
  // frame drawn in the new slot is already framed (no frame of the previous page's pose, no glide).
  useEffect(
    () =>
      useViewerStore.subscribe((s, prev) => {
        if (s.stage === prev.stage || s.stage === 'hidden' || !ref.current) return;
        const el = gl.domElement;
        const width = el.clientWidth;
        const height = el.clientHeight;
        if (!(width > 0) || !(height > 0)) return;
        sizeRef.current = { ...sizeRef.current, width, height };
        stageRef.current = s.stage;
        userTouched.current = false;
        resetPeel();
        flyHome(false);
        const base = viewOffsetFor(width, height, insetsFor(s.stage));
        const goal = { x: base.x + silhouetteBias.current.x, y: base.y + silhouetteBias.current.y };
        offset.current = { from: goal, to: goal, current: goal, t0: performance.now(), applied: '' };
        camera.aspect = width / height;
        camera.setViewOffset(width, height, -goal.x, -goal.y, width, height);
        camera.updateProjectionMatrix();
        invalidate();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A resize keeps the stage framing (62 % of the new free area / the hero share) while the camera sits at
  // its untouched stage pose. The canvas also resizes while it moves between page slots: re-solving then
  // (animated, so it only retargets the stage-change glide) is what keeps the hero from landing zoomed out.
  useEffect(() => {
    if (stage === 'hidden' || !(size.width > 0)) return;
    const t = window.setTimeout(() => {
      const mode = peel.current.mode;
      if (stage === 'workstation' && mode !== 'heart') return fitOpenHeart(false);
      if (userTouched.current) return;
      const atHome = stage === 'hero' || useCameraState.getState().viewKind === 'home';
      if (atHome) flyHome(false);
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // Re-frame once if the page published its free area just after the stage switched (cold load), as long
  // as nobody has touched the camera yet.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (s.stageInsets === prev.stageInsets) return;
        invalidate();
        const st = stageRef.current;
        // The hero re-frames whenever its copy / bands move the free area (web fonts load late); the
        // workstation only right after the stage switch (later chrome changes glide the view offset only).
        const since = performance.now() - stageEnteredAt.current;
        if (st === 'hidden' || (st === 'workstation' && since > 900)) return;
        if (userTouched.current || peel.current.mode !== 'heart') return;
        const { width, height } = sizeRef.current;
        const free = freeArea(width, height, insetsFor(st));
        // Right after the stage switch the canvas is still hidden by the slot move: snap, never glide.
        if (Math.abs(free.height - framedFreeHeight.current) > 0.08 * height) flyHome(!reducedRef.current && since > 400);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo, invalidate],
  );

  /**
   * The best SURFACE view of a vessel (bestView.ts `surfaceBestView`: the proximal trunk facing the camera,
   * unobstructed and spread across the image), cached per anatomy once occlusion can be tested.
   */
  const viewFor = (target: TargetId, closed: boolean) => {
    const structure = manifest?.structures.find((s) => s.target === target && s.bestView);
    const conventional = bestViewFor(target, structure?.bestView);
    const candidates = tracks.find((t) => t.target === target)?.candidates ?? [];
    const occluders = closed ? collectOccluders(scene) : [];
    const key = `${target}:${occluders.length > 0}`;
    let found = bestViews.current.get(key);
    if (!found) {
      found = surfaceBestView(conventional, candidates, {
        target: geo.target,
        visible: occluders.length > 0 ? (eye, p) => !isOccluded(eye, p, occluders) : undefined,
        step: 15,
        preferred: SURFACE_PREFERRED[target] ?? null,
      });
      if (closed && candidates.length > 0) bestViews.current.set(key, found);
    }
    return { view: found.view, candidates };
  };

  /** Move `focus` so the projected box of `points` is centred on it (screen px → world units at its depth). */
  const recentre = (points: readonly Vector3[], direction: Vector3, focus: Vector3, distance: number): Vector3 => {
    const { width, height } = sizeRef.current;
    if (!(width > 0) || !(height > 0)) return focus;
    const e = projectedExtent({ target: focus, direction, fov: CAMERA_FOV, width, height }, points, distance);
    const perPx = (2 * distance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / height;
    const forward = direction.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    return focus
      .clone()
      .addScaledVector(right, ((e.right - e.left) / 2) * perPx)
      .addScaledVector(up, ((e.up - e.down) / 2) * perPx);
  };

  /**
   * Distance that frames the heart like home from `direction` with the orbit target on `focus` (the selected
   * trunk): the whole heart and the visible great vessels stay inside the free area, clear of the selection
   * chip at its top.
   */
  const focusDistance = (direction: Vector3, focus: Vector3): number => {
    const { width, height } = sizeRef.current;
    if (!(width > 0) || !(height > 0)) return distanceFor(direction);
    const free = freeArea(width, height, insetsFor('workstation'));
    const { heart, keep } = sceneRuntime.framing;
    const d = framingDistance({
      box: geo.box,
      points: heart,
      keep: heart.length > 0 || keep.length > 0 ? [...heart, ...keep] : null,
      keepMargin: KEEP_MARGIN,
      keepMarginTop: SELECTION_CHIP_ROOM,
      target: focus,
      direction,
      fov: CAMERA_FOV,
      width,
      height,
      freeWidth: free.width,
      freeHeight: free.height,
      share: WORKSTATION_HEART_SHARE * FOCUS_ZOOM,
    });
    const l = useCameraState.getState().freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped;
    return Math.min(l.maxDistance, Math.max(l.minDistance, d));
  };

  /**
   * Fly to a vessel: its best surface view, with the orbit target on the centre of the trunk that view shows,
   * so the selected artery — not the heart's centre or its silhouette — sits in the middle of the free area.
   */
  const flyToVessel = (target: TargetId, animate: boolean) => {
    const closed = useViewerStore.getState().explode < PEEL_OPEN_AT;
    const { view, candidates } = viewFor(target, closed);
    // Centrelines not loaded yet (a deep link on a cold load): fly now, correct once they arrive.
    pendingVessel.current = candidates.length === 0 ? { target, at: performance.now() } : null;
    const { azimuth, polar } = toControlsAngles(view.azimuth, view.elevation);
    const direction = new Vector3().setFromSphericalCoords(1, polar, azimuth);
    let focus: Vector3 | null = null;
    let distance = distanceFor(direction);
    const samples = vesselSamples.get(target);
    const walls = sceneRuntime.framing.heart;
    if (closed && samples && samples.length > 1) {
      // The orbit target goes where a 60 / 40 blend of the vessel's and the walls' projected boxes is centred
      // in the free area (two refinements; the distance keeps the whole heart and the visible great vessels
      // inside, clear of the selection chip).
      focus = new Box3().setFromPoints(samples).getCenter(new Vector3());
      for (let i = 0; i < 3; i += 1) {
        distance = focusDistance(direction, focus);
        const onVessel = recentre(samples, direction, focus, distance);
        focus = walls.length > 0 ? recentre(walls, direction, focus, distance).lerp(onVessel, VESSEL_WEIGHT) : onVessel;
      }
      distance = focusDistance(direction, focus);
    } else if (closed) {
      focus = vesselCentres.get(target)?.clone() ?? null;
      if (focus) distance = focusDistance(direction, focus);
    }
    flyTo(direction, distance, animate, focus);
    useCameraState.getState().setView('focus', { label: angleLabel(view.azimuth, view.elevation) });
  };

  // Search the vessels' surface views in idle time once every occluder's BVH exists, so a first selection
  // flies at once instead of raycasting on the click.
  useEffect(() => {
    if (tracks.length === 0) return;
    let cancelled = false;
    let handle = 0;
    const next = () => {
      if (cancelled) return;
      if (useViewerStore.getState().explode >= PEEL_OPEN_AT || collectOccluders(scene).length === 0) {
        handle = window.setTimeout(next, 700);
        return;
      }
      const todo = tracks.find((t) => !bestViews.current.has(`${t.target}:true`));
      if (!todo) return;
      viewFor(todo.target as TargetId, true);
      handle = window.setTimeout(next, 120);
    };
    handle = window.setTimeout(next, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, scene]);

  // A vessel flown to before its centreline arrived gets its checked view once it does (if untouched).
  useEffect(() => {
    const pending = pendingVessel.current;
    if (!pending || tracks.length === 0) return;
    if (useViewerStore.getState().selectedStructure !== pending.target || lastInteraction.current > pending.at + 50) return;
    flyToVessel(pending.target, !reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  // Camera commands from the UI (home, projections, fly-to-vessel).
  useEffect(() => {
    const controls = ref.current;
    if (!controls || !command) return;
    const animate = !reduced;
    const state = useCameraState.getState();
    if (command.kind === 'home') {
      // Home frames the peel's own state from the home direction (the open heart, the thorax), and the
      // heart framing it later returns to is home.
      const p = peel.current;
      if (p.mode !== 'heart' && stageRef.current === 'workstation') {
        p.anchor = homeAnchor();
        framePeel(geo.direction, animate);
      } else flyHome(animate);
      state.setView('home');
    } else if (command.kind === 'preset' && command.preset) {
      const preset = PROJECTIONS.find((p) => p.id === command.preset);
      if (preset) {
        const { azimuth, polar } = toControlsAngles(preset.azimuth, preset.elevation);
        const direction = new Vector3().setFromSphericalCoords(1, polar, azimuth);
        const p = peel.current;
        if (p.mode !== 'heart' && stageRef.current === 'workstation') {
          p.anchor = { ...homeAnchor(), home: false, kind: 'preset', presetId: preset.id, label: preset.label };
          framePeel(direction, animate);
        } else flyTo(direction, distanceFor(direction), animate);
        state.setView('preset', { presetId: preset.id });
      }
    } else if (command.kind === 'focus' && command.target) {
      flyToVessel(command.target, animate);
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
          const cam = useCameraState.getState();
          returnView.current = { kind: cam.viewKind, presetId: cam.presetId, label: cam.viewLabel, bias: silhouetteBias.current, zone: peel.current.mode };
          s.setCameraReturn({ position: pose.position, target: pose.target });
        } else if (!s.selectedStructure && prev.selectedStructure) {
          const homeCommand = s.cameraCommand !== prev.cameraCommand && s.cameraCommand?.kind === 'home';
          const back = s.cameraReturn;
          if (back) s.setCameraReturn(null);
          const view = returnView.current;
          returnView.current = null;
          if (!homeCommand && back) {
            const animate = !reducedRef.current;
            const [px, py, pz] = back.position as number[];
            const [tx, ty, tz] = back.target as number[];
            const far = Math.hypot(px! - tx!, py! - ty!, pz! - tz!) > ORBIT_LIMITS.clamped.maxDistance + 0.05;
            // A saved pose from another peel state (the tour's closed chest), a far thorax pose or a pose that
            // was home is never replayed verbatim: home is re-solved for where the peel is NOW, so Esc can
            // never restore a stale far camera while the View menu reads "Home".
            const stale = !view || view.zone !== peel.current.mode || far;
            const live = latest.current;
            if (live && (view?.kind === 'home' || (stale && !freeOrbitRef.current))) {
              if (peel.current.mode !== 'heart') {
                peel.current.anchor = live.homeAnchor();
                live.framePeel(live.currentDirection() ?? live.geo.direction, animate);
              } else live.flyHome(animate);
              useCameraState.getState().setView('home');
            } else {
              flyToPose(back, animate);
              silhouetteBias.current = view?.bias ?? ZERO_OFFSET;
              // Back where it was: the View menu names that view again ("LAO 45"…).
              useCameraState.getState().setView(view?.kind ?? 'custom', view ? { presetId: view.presetId, label: view.label } : {});
            }
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- Peel camera: a FOLLOWER (V2 §5.11). While the DISPLAYED peel value (the rig's spring output,
  // sceneRuntime.peel.e) changes, the camera pose is recomputed every frame as a continuous function of it,
  // from the current view direction:
  //   - opening (above rest): a blend from the heart-zone pose (the "anchor": home, a projection, a vessel
  //     view) to the tight fit of the halves WHERE THEY ARE NOW, with a containment floor so the union of the
  //     walls, fat, coronaries and lifted great vessels never leaves the free area — ▶ Explode, ⟲ Assemble,
  //     the tour and a slider scrub all move the camera in lockstep with the pieces (never ahead of them);
  //   - dissecting (below rest): a log-distance ease between the closed-chest framing (held until 0.1) and
  //     the anchor, so the chest opens in one continuous dolly — no crash-zoom;
  //   - back at rest: the anchor exactly (home is re-solved for the current direction) and its View label.
  // The camera is free whenever the peel is still (orbit, zoom, selections).
  const peel = useRef<{
    mode: PeelMode;
    anchor: PeelAnchor | null;
    active: boolean;
    lastE: number;
    dirty: boolean;
  }>({ mode: 'heart', anchor: null, active: false, lastE: NaN, dirty: false });
  /** Subsampled open samples (the follower projects them every frame) and a reusable output array. */
  const openCache = useRef<{ version: number; src: { open: Vector3[]; openRest: Vector3[]; openWindow: (readonly [number, number])[] }; out: Vector3[] }>({
    version: -1,
    src: { open: [], openRest: [], openWindow: [] },
    out: [],
  });
  const snapOffset = useRef(false);

  const zoneOf = (e: number): PeelMode => (e > PEEL_REST + HEART_ZONE ? 'open' : e < PEEL_REST - HEART_ZONE ? 'thorax' : 'heart');

  const resetPeel = () => {
    const p = peel.current;
    p.mode = zoneOf(useViewerStore.getState().explode);
    p.anchor = null;
    p.active = false;
    p.lastE = NaN;
    p.dirty = false;
  };

  const currentDirection = (): Vector3 | null => {
    const controls = ref.current;
    if (!controls) return null;
    const d = controls.getPosition(new Vector3()).sub(controls.getTarget(new Vector3()));
    return d.lengthSq() > 1e-10 ? d.normalize() : null;
  };

  /** Screen shift that centres the heart walls' silhouette seen from `direction` at `distance` (home). */
  const homeBias = (direction: Vector3, distance: number): Offset => {
    const points = sceneRuntime.framing.heart;
    const { width, height } = sizeRef.current;
    if (points.length === 0 || !(width > 0) || !(height > 0)) return ZERO_OFFSET;
    return centringBias(projectedExtent({ target: geo.target, direction, fov: CAMERA_FOV, width, height }, points, distance));
  };

  const homeAnchor = (): PeelAnchor => ({ target: geo.target.clone(), distance: 0, bias: ZERO_OFFSET, home: true, kind: 'home', presetId: null, label: 'Home' });

  /** The current camera pose and View state as the follower's anchor. */
  const captureAnchor = (): PeelAnchor => {
    const controls = ref.current;
    const cam = useCameraState.getState();
    if (!controls || cam.viewKind === 'home') return homeAnchor();
    const target = controls.getTarget(new Vector3());
    return {
      target,
      distance: controls.getPosition(new Vector3()).distanceTo(target),
      bias: silhouetteBias.current,
      home: false,
      kind: cam.viewKind,
      presetId: cam.presetId,
      label: cam.viewLabel,
    };
  };

  /** The anchor's pose from `direction` (home is re-solved: 62 % of the free height from that direction). */
  const anchorPose = (anchor: PeelAnchor, direction: Vector3): PeelPose => {
    if (!anchor.home) return anchor;
    const distance = distanceFor(direction, 'workstation');
    return { target: geo.target.clone(), distance, bias: homeBias(direction, distance) };
  };

  /** The closed chest, everything opaque at Closed, framed at THORAX_SHARE of the free area. */
  const thoraxPose = (direction: Vector3): PeelPose => {
    const { width, height } = sizeRef.current;
    const viewer = useViewerStore.getState();
    const box = opaqueThoraxBox(manifest, 0, (id) => viewer.layerVisibility[id] ?? true) ?? new Box3(new Vector3(-3.6, -3.8, -1.3), new Vector3(3.2, 2.6, 2.1));
    const target = box.getCenter(new Vector3());
    const free = freeArea(width, height, insetsFor('workstation'));
    const distance = framingDistance(
      { box, target, direction, fov: CAMERA_FOV, width, height, freeWidth: free.width, freeHeight: free.height, share: THORAX_SHARE },
      THORAX_DISTANCE,
      THORAX_MAX_DISTANCE,
    );
    return { target, distance, bias: ZERO_OFFSET };
  };

  /** The open samples (the follower projects them each frame while the heart opens). */
  const openSamples = () => {
    const c = openCache.current;
    const f = sceneRuntime.framing;
    if (c.version !== f.version) {
      c.version = f.version;
      c.src = { open: f.open, openRest: f.openRest, openWindow: f.openWindow };
    }
    return c;
  };

  /** The camera pose for displayed peel value `e` from `direction` (see the follower above). */
  const peelPose = (e: number, direction: Vector3, anchor: PeelAnchor): PeelPose => {
    const A = anchorPose(anchor, direction);
    const zone = zoneOf(e);
    const { width, height } = sizeRef.current;
    if (zone === 'heart' || !(width > 0) || !(height > 0)) return A;
    const free = freeArea(width, height, insetsFor('workstation'));
    const view = { direction, fov: CAMERA_FOV, width, height, freeWidth: free.width, freeHeight: free.height };
    if (zone === 'open') {
      const c = openSamples();
      if (c.src.open.length === 0) return A;
      const points = openPointsAt(c.src, e, c.out);
      const s = smooth((e - PEEL_REST) / (1 - PEEL_REST));
      const centre = new Box3().setFromPoints(points).getCenter(new Vector3());
      const margin = OPEN_FIT_MARGIN * Math.min(free.width, free.height);
      const fitD = fitCentredDistance({ ...view, target: centre, margin }, points);
      const fitBias = centringBias(projectedExtent({ ...view, target: centre }, points, fitD));
      const target = A.target.clone().lerp(centre, s);
      const bias = { x: mix(A.bias.x, fitBias.x, s), y: mix(A.bias.y, fitBias.y, s) };
      const eased = Math.exp(mix(Math.log(A.distance), Math.log(fitD), s));
      // Containment floor: the margin grows with the opening (at rest the heart framing itself holds), plus a
      // few px for the vertices between the samples and the hinge's arc (the samples move on its chord).
      const floor = containDistance({ ...view, target, bias, margin: mix(-40, margin + 10, s) }, points);
      return { target, distance: Math.max(eased, floor), bias };
    }
    const T = thoraxPose(direction);
    const s = clamp01((e - THORAX_FULL_UNTIL) / (PEEL_REST - THORAX_FULL_UNTIL));
    return {
      target: T.target.clone().lerp(A.target, s),
      distance: Math.exp(mix(Math.log(T.distance), Math.log(A.distance), s)),
      bias: { x: mix(0, A.bias.x, s), y: mix(0, A.bias.y, s) },
    };
  };

  /** Put the camera on `pose` from `direction` (animated for commands; per frame the follower snaps). */
  const applyPeelPose = (pose: PeelPose, direction: Vector3, animate: boolean) => {
    const controls = ref.current;
    if (!controls) return;
    const clampMax = (useCameraState.getState().freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped).maxDistance;
    if (pose.distance > clampMax) {
      // Beyond the orbit clamp (the chest): lift it for the move (the prop follows on the next render).
      controls.maxDistance = Math.max(controls.maxDistance, pose.distance + 0.01);
      setThoraxView(true);
    }
    silhouetteBias.current = pose.bias;
    snapOffset.current = !animate;
    const pos = pose.target.clone().addScaledVector(direction, pose.distance);
    void controls.setLookAt(pos.x, pos.y, pos.z, pose.target.x, pose.target.y, pose.target.z, animate);
    if (!animate) controls.update(0);
    invalidate();
  };

  /** Frame the peel's current state from `direction` (Home / a projection while the peel is not at rest). */
  const framePeel = (direction: Vector3, animate: boolean) => {
    const p = peel.current;
    p.anchor ??= captureAnchor();
    applyPeelPose(peelPose(sceneRuntime.peel.e, direction, p.anchor), direction, animate);
  };

  /** Per frame (workstation): follow the displayed peel value while it moves. */
  const followPeel = () => {
    const controls = ref.current;
    const p = peel.current;
    if (!controls) return;
    const e = sceneRuntime.peel.e;
    const changed = !(Math.abs(e - p.lastE) < 1e-6) || p.dirty;
    p.lastE = e;
    p.dirty = false;
    const zone = zoneOf(e);
    if (!changed && !p.active) return;
    if (!p.active && zone === 'heart') {
      p.mode = zone;
      return;
    }
    if (!p.active) {
      p.active = true;
      p.anchor ??= captureAnchor();
    }
    const direction = currentDirection() ?? geo.direction;
    applyPeelPose(peelPose(e, direction, p.anchor!), direction, false);
    p.mode = zone;
    const settled = !changed && Math.abs(e - useViewerStore.getState().explode) < 1e-4;
    if (!settled) return;
    p.active = false;
    if (zone !== 'heart') return;
    // Home again: the anchor's View state (home only if the direction is still home's), the orbit clamp back.
    const anchor = p.anchor!;
    p.anchor = null;
    const cam = useCameraState.getState();
    if (anchor.home) cam.setView(direction.dot(geo.direction) > 0.9995 ? 'home' : 'custom');
    else cam.setView(anchor.kind, { presetId: anchor.presetId, label: anchor.label });
    controls.maxDistance = (cam.freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped).maxDistance;
    setThoraxView(false);
  };

  const followPeelRef = useRef<(() => void) | null>(null);
  followPeelRef.current = followPeel;
  /** This render's helpers, for listeners registered once at mount (they must not use a stale manifest). */
  const latest = useRef<{
    geo: typeof geo;
    flyHome: typeof flyHome;
    framePeel: typeof framePeel;
    homeAnchor: typeof homeAnchor;
    currentDirection: typeof currentDirection;
    isHomePose: (pose: Pose) => boolean;
  } | null>(null);

  /** True when `pose` is the workstation home pose (the View label follows the actual pose). */
  const isHomePose = (pose: Pose): boolean => {
    if (peel.current.mode !== 'heart') return false;
    const distance = distanceFor(geo.direction, 'workstation');
    const home = geo.target.clone().addScaledVector(geo.direction, distance);
    const t = geo.target;
    return poseDistance(pose, { position: [home.x, home.y, home.z], target: [t.x, t.y, t.z] }) < 0.02;
  };

  /** Re-frame the peel's current state (a resize while the heart is open or the chest closed). */
  const fitOpenHeart = (animate: boolean, from?: Vector3) => {
    const direction = from?.clone() ?? currentDirection() ?? geo.direction;
    framePeel(direction, animate);
  };
  latest.current = { geo, flyHome, framePeel, homeAnchor, currentDirection, isHomePose: (pose: Pose) => isHomePose(pose) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => resetPeel(), []);

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

  // The anatomy publishes its surface samples once its rig is built (after the stage pose was first
  // solved on the manifest box): re-frame on them while the camera still sits at the untouched home pose.
  const framingVersion = useRef(sceneRuntime.framing.version);

  useFrame((_, delta) => {
    const controls = ref.current;
    if (!controls) return;
    const now = performance.now();

    if (framingVersion.current !== sceneRuntime.framing.version) {
      framingVersion.current = sceneRuntime.framing.version;
      const st = stageRef.current;
      const atHome = st === 'hero' || (st === 'workstation' && useCameraState.getState().viewKind === 'home');
      // Before the first anatomy frame the poster is still up: snap, so the crossfade lands on the exact
      // pose the poster was rendered at instead of a zoom.
      const animate = !reduced && useCameraState.getState().firstFrame;
      const mode = st === 'workstation' ? peel.current.mode : 'heart';
      if (st !== 'hidden' && atHome && !userTouched.current && mode === 'heart') flyHome(animate);
      else if (mode !== 'heart') peel.current.dirty = true;
    }

    // The GLB anatomy calls the follower right after it moved the pieces (cameraRigApi.followPeel); without
    // it (the procedural heart) the camera follows here.
    if (stage === 'workstation' && !sceneRuntime.anatomyReady) followPeel();

    // View offset: the orbit target sits at the centre of the free area; glides over `flyout`.
    const { width, height } = size;
    const off = offset.current;
    const base = viewOffsetFor(width, height, insetsFor(stage));
    const bias = stage === 'hidden' ? ZERO_OFFSET : silhouetteBias.current;
    const goal = { x: base.x + bias.x, y: base.y + bias.y };
    if (!sameOffset(goal, off.to)) {
      off.from = off.current;
      off.to = goal;
      off.t0 = now;
    }
    // The peel follower moves the camera in lockstep with the pieces: its bias is applied at once, not glided.
    if (snapOffset.current) {
      snapOffset.current = false;
      off.from = goal;
      off.to = goal;
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
      minDistance={limits.minDistance}
      maxDistance={thoraxView ? Math.max(limits.maxDistance, THORAX_MAX_DISTANCE) : limits.maxDistance}
      minPolarAngle={limits.minPolar}
      maxPolarAngle={limits.maxPolar}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
      truckSpeed={1}
    />
  );
}
