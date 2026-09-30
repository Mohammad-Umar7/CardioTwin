import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, Vector3, type PerspectiveCamera } from 'three';
import { useManifest, useVessels } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore, type Stage } from '@/state/viewerStore';
import type { CameraPose, TargetId } from '@/types/contracts';
import { buildTracks } from '../labels/anchorTracks';
import { surfaceBestView, type SurfaceViewScore } from './bestView';
import { collectOccluders, isOccluded } from './occlusion';
import { angleLabel, useCameraState, type ViewKind } from './cameraState';
import { sceneRuntime } from '../stage/sceneRuntime';
import { cameraRigApi } from './controlsApi';
import {
  HERO_HEART_SHARE,
  WORKSTATION_HEART_SHARE,
  ZERO_OFFSET,
  framingDistance,
  freeArea,
  glide,
  PEEL_OPEN_AT,
  heartBox,
  opaqueThoraxBox,
  peelModeFor,
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
 * Open-heart framing: when the peel enters the heart's window the camera fits both exploded halves into the
 * free area with a 6 % margin (the anterior half swings toward viewer-left, which would otherwise put it
 * under the patient card); the peel mode (framing.ts `peelModeFor`) glides it back once the heart closes.
 */
const OPEN_FIT_MARGIN = 0.06;
/**
 * A peel passing THROUGH the heart framing (the chest re-opening on its way to Open heart, or closing from
 * Open heart to Closed) does not stop there: the heart framing is taken only once the value has stayed in it
 * this long, so a dissection is one camera move, not three.
 */
const HEART_SETTLE_MS = 160;
/** A peel resting on another detent inside the thorax view is re-framed after this pause. */
const THORAX_REFIT_MS = 260;
/** Share of the trunk a best view must show (proximal 5–80 %). */
const VIEW_WINDOW: readonly [number, number] = [0.05, 0.8];
/** Margin (px) between the free-area edge and the visible great vessels (≥ 24 px from the canvas top). */
const KEEP_MARGIN = 12;
/** A vessel's best view keeps the home distance for its angle: the target leaning onto the vessel is the "going to it". */
const FOCUS_ZOOM = 1;
/**
 * Room kept free at the top of the free area while a vessel is selected: the selection chip (12 + 32 px)
 * and a margin, so no great vessel runs under it.
 */
const SELECTION_CHIP_ROOM = 56;

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
  const reduced = useIsReducedMotion();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
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
  const returnView = useRef<{ kind: ViewKind; presetId: string | null; label: string; bias: Offset } | null>(null);
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

  // Every centreline point of each vessel's own node (the LAD with its diagonals, the LCX with its marginals,
  // the RCA), to centre the selected vessel — not its trunk's first centimetres — in the free area.
  const vesselSamples = useMemo(() => {
    const out = new Map<string, Vector3[]>();
    for (const v of (vessels?.vessels ?? []) as unknown as { id?: string; segments: { points: number[][] }[] }[]) {
      if (!v.id || !['LAD', 'LCX', 'RCA'].includes(v.id)) continue;
      const pts: Vector3[] = [];
      for (const seg of v.segments) for (let i = 0; i < seg.points.length; i += 2) pts.push(new Vector3(seg.points[i]![0], seg.points[i]![1], seg.points[i]![2]));
      out.set(v.id, pts);
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
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    const onKey = (e: KeyboardEvent) => {
      controls.mouseButtons.left = e.shiftKey ? CameraControlsImpl.ACTION.TRUCK : CameraControlsImpl.ACTION.ROTATE;
    };
    const onUser = () => {
      lastInteraction.current = performance.now();
      userTouched.current = true;
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
      // Arriving on an already opened heart or a closed chest (a deep link, a reload, the tour): frame that
      // state straight away.
      applyPeelMode(peelModeFor(useViewerStore.getState().explode, 'heart'), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, geo]);

  // A resize keeps the stage framing (62 % of the new free area / the hero share) while the camera sits at
  // its untouched stage pose. The canvas also resizes while it moves between page slots: re-solving then
  // (animated, so it only retargets the stage-change glide) is what keeps the hero from landing zoomed out.
  useEffect(() => {
    if (stage === 'hidden' || !(size.width > 0)) return;
    const t = window.setTimeout(() => {
      if (userTouched.current) return;
      const mode = peel.current.mode;
      if (stage === 'workstation' && mode === 'open') return fitOpenHeart(false);
      if (stage === 'workstation' && mode === 'thorax') return fitThorax(false);
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
    if (closed && samples && samples.length > 1) {
      // The orbit target goes where the vessel's projected box is centred in the free area (two refinements
      // of its 3D centre; the distance keeps the whole heart and the visible great vessels inside).
      focus = new Box3().setFromPoints(samples).getCenter(new Vector3());
      for (let i = 0; i < 2; i += 1) {
        distance = focusDistance(direction, focus);
        focus = recentre(samples, direction, focus, distance);
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
      if (p.mode !== 'heart') p.back = null;
      if (p.mode === 'open' && stageRef.current === 'workstation') fitOpenHeart(animate, geo.direction);
      else if (p.mode === 'thorax' && stageRef.current === 'workstation') fitThorax(animate, geo.direction);
      else flyHome(animate);
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
          returnView.current = { kind: cam.viewKind, presetId: cam.presetId, label: cam.viewLabel, bias: silhouetteBias.current };
          s.setCameraReturn({ position: pose.position, target: pose.target });
        } else if (!s.selectedStructure && prev.selectedStructure) {
          const homeCommand = s.cameraCommand !== prev.cameraCommand && s.cameraCommand?.kind === 'home';
          const back = s.cameraReturn;
          if (back) s.setCameraReturn(null);
          if (!homeCommand && back) {
            flyToPose(back, !reducedRef.current);
            const view = returnView.current;
            silhouetteBias.current = view?.bias ?? ZERO_OFFSET;
            // Back where it was: the View menu names that view again ("Home", "LAO 45"…).
            useCameraState.getState().setView(view?.kind ?? 'custom', view ? { presetId: view.presetId, label: view.label } : {});
            returnView.current = null;
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Peel camera modes (framing.ts `peelModeFor`): the heart, the whole opaque thorax while the chest is
  // closed again, or both opened halves. The mode follows the peel VALUE (hysteresis), never a threshold
  // crossing, so every path ends on the framing of where the peel is; leaving the heart framing remembers the
  // pose to come back to (home re-solves home), and a peel passing through the heart framing on its way from
  // the thorax to the open heart (or back) makes one camera move, not three.
  const peel = useRef<{
    mode: PeelMode;
    back: { pose: Pose; bias: Offset; home: boolean } | null;
    timer: number;
    limits: number;
    refit: number;
  }>({ mode: 'heart', back: null, timer: 0, limits: 0, refit: 0 });

  const resetPeel = () => {
    const p = peel.current;
    window.clearTimeout(p.timer);
    window.clearTimeout(p.limits);
    window.clearTimeout(p.refit);
    p.mode = 'heart';
    p.back = null;
    p.timer = 0;
  };

  /**
   * The thorax view of the peel: frame everything OPAQUE at the peel value (framing.ts `opaqueThoraxBox`: the
   * heart plus the chest layers still solid there, as far as they travel before turning into ghosts) inside
   * the free area, from the current angle, so no solid layer ever balloons past the lens or runs under the
   * cards or the toolbar; re-fitted once the value settles on another detent.
   */
  const fitThorax = (animate: boolean, from?: Vector3) => {
    const controls = ref.current;
    const { width, height } = sizeRef.current;
    if (!controls || !(width > 0) || !(height > 0)) return;
    const viewer = useViewerStore.getState();
    const box =
      opaqueThoraxBox(manifest, viewer.explode, (id) => viewer.layerVisibility[id] ?? id !== 'lungs') ??
      new Box3(new Vector3(-3.6, -3.8, -1.3), new Vector3(3.2, 2.6, 2.1));
    const centre = box.getCenter(new Vector3());
    const direction = from?.clone() ?? controls.getPosition(new Vector3()).sub(controls.getTarget(new Vector3())).normalize();
    const free = freeArea(width, height, insetsFor('workstation'));
    const d = framingDistance(
      { box, target: centre, direction, fov: CAMERA_FOV, width, height, freeWidth: free.width, freeHeight: free.height, share: THORAX_SHARE },
      THORAX_DISTANCE,
      THORAX_MAX_DISTANCE,
    );
    window.clearTimeout(peel.current.limits);
    setThoraxView(true);
    controls.maxDistance = Math.max(controls.maxDistance, d);
    silhouetteBias.current = ZERO_OFFSET;
    const pos = centre.clone().addScaledVector(direction, d);
    void controls.setLookAt(pos.x, pos.y, pos.z, centre.x, centre.y, centre.z, animate);
    invalidate();
  };

  /** Frame the opened heart (both halves, the fat and the coronaries riding them) from the current angle. */
  const fitOpenHeart = (animate: boolean, from?: Vector3) => {
    const controls = ref.current;
    const points = sceneRuntime.framing.open;
    const { width, height } = sizeRef.current;
    if (!controls || points.length === 0 || !(width > 0) || !(height > 0)) return;
    const box = new Box3().setFromPoints(points);
    const centre = box.getCenter(new Vector3());
    const direction = from?.clone() ?? controls.getPosition(new Vector3()).sub(controls.getTarget(new Vector3())).normalize();
    const free = freeArea(width, height, insetsFor('workstation'));
    const input = { box, points, target: centre, direction, fov: CAMERA_FOV, width, height, freeWidth: free.width, freeHeight: free.height };
    const l = useCameraState.getState().freeOrbit ? ORBIT_LIMITS.free : ORBIT_LIMITS.clamped;
    const d = Math.min(
      l.maxDistance,
      Math.max(
        l.minDistance,
        framingDistance({ ...input, share: 1 - 2 * OPEN_FIT_MARGIN, keep: points, keepMargin: OPEN_FIT_MARGIN * Math.min(free.width, free.height) }),
      ),
    );
    const e = projectedExtent(input, points, d);
    silhouetteBias.current = { x: -(e.right - e.left) / 2, y: -(e.down - e.up) / 2 };
    const pos = centre.clone().addScaledVector(direction, d);
    void controls.setLookAt(pos.x, pos.y, pos.z, centre.x, centre.y, centre.z, animate);
    invalidate();
  };

  /** Take the framing of `mode` (no-op when it is already the current one). */
  const applyPeelMode = (mode: PeelMode, animate: boolean) => {
    const controls = ref.current;
    const p = peel.current;
    window.clearTimeout(p.timer);
    p.timer = 0;
    if (!controls || mode === p.mode) return;
    if (p.mode === 'heart' && !p.back) {
      const cam = useCameraState.getState();
      p.back = { pose: poseOf(controls), bias: silhouetteBias.current, home: cam.viewKind === 'home' };
    }
    p.mode = mode;
    if (mode === 'open') fitOpenHeart(animate);
    else if (mode === 'thorax') fitThorax(animate);
    else {
      const back = p.back;
      p.back = null;
      if (!back || back.home) flyHome(animate);
      else {
        silhouetteBias.current = back.bias;
        flyToPose(back.pose, animate);
      }
    }
    // Back to the orbit limits once the glide out of the thorax has landed (lowering them mid-glide would
    // clamp it).
    if (mode !== 'thorax') {
      window.clearTimeout(p.limits);
      p.limits = window.setTimeout(() => peel.current.mode !== 'thorax' && setThoraxView(false), 1400);
    }
  };

  useEffect(
    () =>
      useViewerStore.subscribe((s, prev) => {
        if (!ref.current || s.explode === prev.explode || s.stage !== 'workstation') return;
        const p = peel.current;
        const next = peelModeFor(s.explode, p.mode);
        window.clearTimeout(p.refit);
        if (next === p.mode) {
          window.clearTimeout(p.timer);
          p.timer = 0;
          // Another detent inside the thorax view: frame what is opaque there once the value has settled.
          if (next === 'thorax' && !userTouched.current) {
            p.refit = window.setTimeout(() => peel.current.mode === 'thorax' && fitThorax(!reducedRef.current), THORAX_REFIT_MS);
          }
          return;
        }
        if (next !== 'heart') {
          applyPeelMode(next, !reducedRef.current);
          return;
        }
        // Into the heart framing: only once the peel has stayed there (it may be passing through).
        if (p.timer) return;
        p.timer = window.setTimeout(() => {
          peel.current.timer = 0;
          const v = useViewerStore.getState();
          if (v.stage !== 'workstation') return;
          applyPeelMode(peelModeFor(v.explode, peel.current.mode), !reducedRef.current);
        }, reducedRef.current ? 0 : HEART_SETTLE_MS);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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
      else if (mode === 'open' && !userTouched.current) fitOpenHeart(animate);
    }

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
