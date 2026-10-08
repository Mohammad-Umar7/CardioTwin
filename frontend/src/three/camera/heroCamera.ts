/**
 * Landing hero camera (pure maths; unit tested in heroCamera.test.ts). The camera rig applies the results.
 *
 *   - FRAMING. The hero shows the upper torso (shoulder to shoulder, from just above the shoulders to the
 *     lower rib cage) with the heart where it lies in it, centred in the free area beside the copy. The span
 *     fills the free height; a narrow free area fits the shoulders instead, and phones crop at the shoulders.
 *   - IDLE. A slow sway of a few degrees over tens of seconds, plus a damped pointer parallax.
 *   - DOLLY. "Enter Workstation" moves the camera from wherever it is to the workstation's home pose: target
 *     and view offset linearly, direction by slerp, distance log-linearly (a constant zoom rate, so no
 *     crash-zoom at the end), all on one custom ease.
 */
import { Spherical, Vector3 } from 'three';
import type { AnatomyManifest } from '@/types/contracts';
import { freeArea, heartBox, type Insets, type Offset } from './framing';

/** Rest-frame extent of the torso the hero frames (scene units; manifest frame: +x patient left, +y up). */
export interface TorsoFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Depth of the orbit target (the heart's plane). */
  depth: number;
}

/** The BodyParts3D torso in the manifest frame, used without a manifest. */
export const FALLBACK_TORSO: TorsoFrame = { left: -2.13, right: 1.7, top: 1.68, bottom: -1.83, depth: 0 };
/** The frame ends this far below the heart walls: the lower rib cage (the skin's own crop lies further down). */
const BELOW_HEART = 1.3;
/** Room above the shoulders, where the skin is cropped at the neck. */
const ABOVE_SHOULDERS = 0.08;

/** Torso frame from the manifest's skin box and heart walls (FALLBACK_TORSO without them). */
export function torsoFrame(manifest: AnatomyManifest | null | undefined): TorsoFrame {
  const entry = manifest?.structures.find((s) => s.node === 'Skin_Torso') as unknown as { bbox?: { min: number[]; max: number[] } } | undefined;
  const skin = entry?.bbox;
  if (!skin || skin.min.length < 3 || skin.max.length < 3) return FALLBACK_TORSO;
  const heart = heartBox(manifest);
  return { left: skin.min[0]!, right: skin.max[0]!, top: skin.max[1]! + ABOVE_SHOULDERS, bottom: heart.min.y - BELOW_HEART, depth: 0 };
}

/** The shoulders may overhang the free area by this share (into the copy's fade); narrow free areas crop more. */
export const HERO_OVERHANG = { wide: 1.06, narrow: 1.4 } as const;
/** Below this free width (px) the hero crops at the shoulders instead of shrinking the heart. */
export const NARROW_FREE_WIDTH = 640;

export interface HeroFramingInput {
  frame: TorsoFrame;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Canvas size, CSS px. */
  width: number;
  height: number;
  /** Stage insets (the copy column on wide screens). */
  insets: Insets;
}

export interface HeroPose {
  /** Orbit target: the torso's centre in the heart's plane. */
  target: Vector3;
  /** Camera distance along the hero direction. */
  distance: number;
}

/**
 * The hero's rest pose: the torso span fills the free height (or its shoulders the free width, whichever is
 * tighter) at the target's depth. The view offset puts the target at the free area's centre.
 */
export function heroPose({ frame, fov, width, height, insets }: HeroFramingInput): HeroPose {
  const target = new Vector3((frame.left + frame.right) / 2, (frame.top + frame.bottom) / 2, frame.depth);
  if (!(width > 0) || !(height > 0)) return { target, distance: 7 };
  const free = freeArea(width, height, insets);
  const span = Math.max(0.1, frame.top - frame.bottom);
  const across = Math.max(0.1, frame.right - frame.left);
  const overhang = free.width < NARROW_FREE_WIDTH ? HERO_OVERHANG.narrow : HERO_OVERHANG.wide;
  const pxPerUnit = Math.min(free.height / span, (free.width * overhang) / across);
  const distance = height / (2 * Math.tan((fov * Math.PI) / 360) * pxPerUnit);
  return { target, distance };
}

/** The backdrop's coloured light on the hero (a share of the workstation's): a dark room, no blue haze. */
export const HERO_BACKDROP_GLOW = 0.35;

// ------------------------------------------------------------------------------------------------ idle

const DEG = Math.PI / 180;
/** Idle sway: a few degrees over tens of seconds, never a turntable. */
export const HERO_SWAY = { azimuthDeg: 3, periodS: 30, elevationDeg: 0.8, elevationPeriodS: 43 } as const;
/** Pointer parallax at the hero's edges, damped (λ). */
export const HERO_PARALLAX = { azimuthDeg: 2.2, elevationDeg: 1.2, lambda: 2.4 } as const;

/** Idle sway angles (radians) `t` seconds into the hero's own clock (0 at t = 0). */
export function heroSway(t: number): { azimuth: number; elevation: number } {
  return {
    azimuth: HERO_SWAY.azimuthDeg * DEG * Math.sin((2 * Math.PI * t) / HERO_SWAY.periodS),
    elevation: HERO_SWAY.elevationDeg * DEG * Math.sin((2 * Math.PI * t) / HERO_SWAY.elevationPeriodS),
  };
}

const spherical = new Spherical();

/** `base` (a unit direction from the target to the camera) orbited by `azimuth` about +Y and lifted by `elevation`. */
export function orbitDirection(base: Vector3, azimuth: number, elevation: number, out = new Vector3()): Vector3 {
  spherical.setFromVector3(base);
  spherical.theta += azimuth;
  spherical.phi = Math.min(Math.PI - 0.01, Math.max(0.01, spherical.phi - elevation));
  return out.setFromSpherical(spherical).normalize();
}

// ----------------------------------------------------------------------------------------------- dolly

/**
 * CSS-style cubic-bezier easing (x1, y1, x2, y2 in 0..1): Newton steps on x(t), bisection as the fallback.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)));
}

/**
 * The dolly's ease: a short breath while the chest starts to clear (the camera is visibly under way by ~0.2 s),
 * a decisive move, then a long soft landing on the workstation framing.
 */
export const HERO_DOLLY_EASE = [0.42, 0.02, 0.18, 1] as const;
export const easeDolly = cubicBezier(...HERO_DOLLY_EASE);

export interface DollyPose {
  target: Vector3;
  /** Unit direction from the target to the camera. */
  direction: Vector3;
  distance: number;
  /** View offset (CSS px): where the target sits relative to the canvas centre. */
  offset: Offset;
}

const tmpA = new Vector3();

/** Spherical interpolation of two unit vectors (written to `out`, which may alias neither input). */
function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const theta = Math.acos(dot);
  if (theta < 1e-5) return out.copy(a).lerp(b, t).normalize();
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  tmpA.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
  return out.copy(tmpA).normalize();
}

/** The dolly's pose at eased progress `k` between `from` (k = 0) and `to` (k = 1). */
export function dollyAt(from: DollyPose, to: DollyPose, k: number, out?: DollyPose): DollyPose {
  const t = Math.min(1, Math.max(0, k));
  const o = out ?? { target: new Vector3(), direction: new Vector3(), distance: 0, offset: { x: 0, y: 0 } };
  o.target.lerpVectors(from.target, to.target, t);
  slerpUnit(from.direction, to.direction, t, o.direction);
  o.distance = Math.exp(Math.log(Math.max(1e-3, from.distance)) * (1 - t) + Math.log(Math.max(1e-3, to.distance)) * t);
  o.offset = { x: from.offset.x + (to.offset.x - from.offset.x) * t, y: from.offset.y + (to.offset.y - from.offset.y) * t };
  return o;
}
