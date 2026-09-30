/**
 * Heartbeat deformation (pure maths + GLSL; unit tested in heartbeat.test.ts).
 *
 * The ventricular beat is an AFFINE map in the heart's rest frame — radial shortening toward the long axis
 * and longitudinal shortening toward a point near the apex — so it can live in the node matrices of the
 * heart walls, valves and coronaries. Everything that follows node matrices (the coronary tree riding the
 * wall, the fx flow particles, label anchors if they wanted to) therefore beats identically and never
 * detaches. Two regional terms that are not affine run in the vertex shader with the SAME uniforms:
 *   - the atrial kick (a squeeze of the atria at end-diastole);
 *   - the great-vessel roots, which follow the affine beat near the heart and fade to still distally (the
 *     descending aorta must not swing with the ventricles).
 * `BEAT_UNIFORMS` is one shared uniform set: any material (including the fx layer's) can include
 * `BEAT_VERTEX_PARS` + `BEAT_VERTEX` to deform exactly like the anatomy.
 */
import { Matrix4, Vector3, type IUniform } from 'three';
import type { HeartFrame } from './explode';
import { BEAT_AMPLITUDE } from './heartbeat';

/** Longitudinal pivot: this fraction of the way from the apex to the base (the apex barely moves). */
export const LONGITUDINAL_PIVOT = 0.18;

const tmpA = new Matrix4();
const tmpB = new Matrix4();

/**
 * Affine beat matrix (rest frame) at ventricular activation v (see heartbeat.ts). v = 0 → identity; v < 0
 * (atrial filling) gives a slight expansion.
 */
export function beatMatrix(frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>, v: number, out = new Matrix4()): Matrix4 {
  if (v === 0) return out.identity();
  const sr = 1 - BEAT_AMPLITUDE.radial * v;
  const sl = 1 - BEAT_AMPLITUDE.longitudinal * v;
  const pivot = frame.apex.clone().addScaledVector(frame.axis, frame.length * LONGITUDINAL_PIVOT);
  const a = frame.axis;
  // S = sr·I + (sl − sr)·a·aᵀ : radial scale everywhere, longitudinal scale along a.
  const k = sl - sr;
  tmpA.set(
    sr + k * a.x * a.x, k * a.x * a.y, k * a.x * a.z, 0,
    k * a.y * a.x, sr + k * a.y * a.y, k * a.y * a.z, 0,
    k * a.z * a.x, k * a.z * a.y, sr + k * a.z * a.z, 0,
    0, 0, 0, 1,
  );
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(tmpA);
  out.multiply(tmpB.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return out;
}

/** Height along the long axis, normalised: 0 at the apex, 1 at the base. */
export function heightOf(frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>, p: Vector3): number {
  return p.clone().sub(frame.apex).dot(frame.axis) / frame.length;
}

/** Atrial region weight at normalised height h (0 in the ventricles, 1 in the atria, 0 far above). */
export function atrialWeight(h: number): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(0.88, 1.08, h) * (1 - s(1.5, 1.8, h));
}

// ----------------------------------------------------------------------------------------- GLSL

export interface BeatUniforms {
  /** Affine ventricular beat (rest frame). */
  uBeatMatrix: IUniform<Matrix4>;
  /** Atrial activation 0..1. */
  uBeatAtrial: IUniform<number>;
  uHeartApex: IUniform<Vector3>;
  uHeartAxis: IUniform<Vector3>;
  uHeartLength: IUniform<number>;
  uAtrialAmp: IUniform<number>;
}

/** The one shared set (module singleton, one canvas per page). Updated each frame by the anatomy. */
export const BEAT_UNIFORMS: BeatUniforms = {
  uBeatMatrix: { value: new Matrix4() },
  uBeatAtrial: { value: 0 },
  uHeartApex: { value: new Vector3() },
  uHeartAxis: { value: new Vector3(0, 1, 0) },
  uHeartLength: { value: 1 },
  uAtrialAmp: { value: BEAT_AMPLITUDE.atrial },
};

/** Point the shared uniforms at a heart frame (once per loaded anatomy). */
export function setBeatFrame(frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>): void {
  BEAT_UNIFORMS.uHeartApex.value.copy(frame.apex);
  BEAT_UNIFORMS.uHeartAxis.value.copy(frame.axis);
  BEAT_UNIFORMS.uHeartLength.value = frame.length;
}

/**
 * Vertex declarations. `uRestOffset` is the mesh's rest translation inside the anatomy root, so
 * `position + uRestOffset` is the vertex in the heart's rest frame (each GLB node is centred on itself).
 */
export const BEAT_VERTEX_PARS = /* glsl */ `
uniform mat4 uBeatMatrix;
uniform float uBeatAtrial;
uniform vec3 uHeartApex;
uniform vec3 uHeartAxis;
uniform float uHeartLength;
uniform float uAtrialAmp;
uniform vec3 uRestOffset;
uniform float uBeatMode; // 0 = none, 1 = atrial only (node matrix carries the affine beat), 2 = root blend
vec3 ctBeat(vec3 p) {
  if (uBeatMode < 0.5) return p;
  float h = dot(p - uHeartApex, uHeartAxis) / uHeartLength;
  vec3 q = p;
  if (uBeatMode > 1.5) {
    // Great-vessel roots follow the ventricular beat near the base and stay still distally.
    float root = 1.0 - smoothstep(1.05, 1.9, h);
    vec3 beat = (uBeatMatrix * vec4(p, 1.0)).xyz;
    q = mix(p, beat, root);
  }
  float wa = smoothstep(0.88, 1.08, h) * (1.0 - smoothstep(1.5, 1.8, h));
  vec3 atrialCentre = uHeartApex + uHeartAxis * (uHeartLength * 1.22);
  return q - (q - atrialCentre) * (uAtrialAmp * uBeatAtrial * wa);
}
`;

/** Replaces `transformed` (object space) after `#include <begin_vertex>`. */
export const BEAT_VERTEX = /* glsl */ `
transformed = ctBeat(transformed + uRestOffset) - uRestOffset;
`;

/** Beat modes for `uBeatMode`. */
export const BEAT_MODE = { none: 0, atrial: 1, root: 2 } as const;
