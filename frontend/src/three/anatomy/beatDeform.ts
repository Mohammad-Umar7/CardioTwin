/**
 * Heartbeat deformation (pure maths + GLSL; unit tested in heartbeat.test.ts).
 *
 * ONE continuous displacement field, defined in the heart's rest frame, moves every mesh of the heart and of
 * its great vessels: walls, epicardial fat, valves, papillary muscles, coronary arteries, cardiac veins, the
 * aorta, the pulmonary trunk, the venae cavae and the pulmonary veins — and the fx layer that rides them (flow
 * particles, the risk overlay). The displacement depends only on WHERE a point is, so two meshes that touch at
 * rest touch through the whole beat: no seam can open where a vein joins its atrium or the aorta leaves the
 * ventricle. (The earlier design moved the walls with an affine node matrix and the great vessels with a
 * separate root blend; the two disagreed by up to 5 mm at the venous junctions at end-systole.)
 *
 * The field follows cardiac mechanics (amplitudes in `BEAT_AMPLITUDE`):
 *   - the AV plane descends toward a nearly still apex, the ventricles shortening evenly from apex to base;
 *   - above the AV plane the atria and the great-vessel roots STRETCH between the descending plane and their
 *     anchored roof and venous entries, which stay still (the atrial reservoir phase);
 *   - the ventricular walls move in toward the long axis;
 *   - the LV twists: the apex counter-clockwise, the base clockwise, viewed from the apex;
 *   - the atria swell while the ventricles eject and squeeze in the atrial kick.
 * Outside the heart, each great vessel carries a per-vertex weight (`aBeatW`, `beatWeights.ts`): 1 where it
 * joins the heart (so the junction moves exactly like the chamber), fading to 0 along the vessel, so the arch,
 * the descending aorta and the distal veins stay still.
 *
 * `BEAT_UNIFORMS` is one shared uniform set: any material can include `BEAT_VERTEX_PARS` + `BEAT_VERTEX` (or the
 * weighted variants) to deform exactly like the anatomy, and `beatDisplace` is the CPU twin.
 */
import { Vector3, type IUniform } from 'three';
import type { HeartFrame } from './explode';
import { BEAT_AMPLITUDE } from './heartbeat';

/** Normalised height (0 = apex, 1 = AV plane) above which the atrial roof and venous anchors stay still. */
export const ANCHOR_HEIGHT = 1.95;
/** Height of the atrial centre the atria swell from and squeeze toward. */
export const ATRIAL_CENTRE_HEIGHT = 1.22;

const DEG = Math.PI / 180;
/** Twist at the apex / base, radians per unit activation, right-handed about the apex → base axis. */
const TWIST_APEX = -BEAT_AMPLITUDE.twistApexDeg * DEG; // counter-clockwise viewed from the apex
const TWIST_BASE = BEAT_AMPLITUDE.twistBaseDeg * DEG; // clockwise viewed from the apex

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** AV-plane descent profile: 0 at the apex, 1 at the AV plane, back to 0 at the anchored roof. */
export function longitudinalProfile(h: number): number {
  return h <= 1 ? clamp01(h) : 1 - smoothstep(1, ANCHOR_HEIGHT, h);
}

/** Radial contraction profile: the ventricles, fading out across the AV groove. */
export function radialProfile(h: number): number {
  return smoothstep(-0.1, 0.3, h) * (1 - smoothstep(0.92, 1.12, h));
}

/** Twist (radians per unit activation, right-handed about +axis): apex → base, fading out above the AV plane. */
export function twistProfile(h: number): number {
  const hv = clamp01(h);
  return (TWIST_APEX + (TWIST_BASE - TWIST_APEX) * hv) * (1 - smoothstep(1, 1.3, h));
}

/** Atrial region weight at normalised height h (0 in the ventricles, 1 in the atria, 0 far above). */
export function atrialWeight(h: number): number {
  return smoothstep(0.88, 1.08, h) * (1 - smoothstep(1.5, 1.8, h));
}

/** Height along the long axis, normalised: 0 at the apex, 1 at the base. */
export function heightOf(frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>, p: Vector3): number {
  return (
    ((p.x - frame.apex.x) * frame.axis.x + (p.y - frame.apex.y) * frame.axis.y + (p.z - frame.apex.z) * frame.axis.z) /
    frame.length
  );
}

const tmpC = new Vector3();
const tmpR = new Vector3();
const tmpK = new Vector3();
const tmpCa = new Vector3();

/** Rodrigues rotation of v about unit k by ang (in place). */
function rotateAbout(v: Vector3, k: Vector3, ang: number): Vector3 {
  if (ang === 0) return v;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = k.dot(v);
  tmpK.crossVectors(k, v);
  return v.multiplyScalar(c).addScaledVector(tmpK, s).addScaledVector(k, kv * (1 - c));
}

/**
 * CPU twin of the vertex shader's `ctBeat`: the beat-displaced position of rest-frame point p at ventricular
 * activation v (1 = end-systole, < 0 = atrial over-fill) and atrial activation a, blended by weight w
 * (1 = heart, 0 = still). Allocation-free; `out` may alias p.
 */
export function beatDisplace(
  frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>,
  v: number,
  a: number,
  p: Vector3,
  out = new Vector3(),
  w = 1,
): Vector3 {
  if (w <= 0 || (v === 0 && a === 0)) return out.copy(p);
  const L = frame.length;
  const ax = frame.axis;
  const h = heightOf(frame, p);
  const c = tmpC.copy(frame.apex).addScaledVector(ax, h * L);
  const r = tmpR.copy(p).sub(c);
  rotateAbout(r, ax, v * twistProfile(h));
  r.multiplyScalar(1 - BEAT_AMPLITUDE.radial * v * radialProfile(h));
  const qx = c.x + r.x - ax.x * BEAT_AMPLITUDE.longitudinal * L * v * longitudinalProfile(h);
  const qy = c.y + r.y - ax.y * BEAT_AMPLITUDE.longitudinal * L * v * longitudinalProfile(h);
  const qz = c.z + r.z - ax.z * BEAT_AMPLITUDE.longitudinal * L * v * longitudinalProfile(h);
  let x = qx;
  let y = qy;
  let z = qz;
  const wa = atrialWeight(h);
  if (wa > 0) {
    const hc = ATRIAL_CENTRE_HEIGHT;
    const ca = tmpCa.copy(frame.apex).addScaledVector(ax, hc * L - BEAT_AMPLITUDE.longitudinal * L * v * longitudinalProfile(hc));
    const k = (BEAT_AMPLITUDE.atrialReservoir * Math.max(v, 0) - BEAT_AMPLITUDE.atrial * a) * wa;
    x += (qx - ca.x) * k;
    y += (qy - ca.y) * k;
    z += (qz - ca.z) * k;
  }
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  return out.set(px + (x - px) * w, py + (y - py) * w, pz + (z - pz) * w);
}

// ----------------------------------------------------------------------------------------- GLSL

export interface BeatUniforms {
  /** Ventricular activation (1 = end-systole, < 0 = atrial over-fill). */
  uBeatV: IUniform<number>;
  /** Atrial activation 0..1. */
  uBeatAtrial: IUniform<number>;
  uHeartApex: IUniform<Vector3>;
  uHeartAxis: IUniform<Vector3>;
  uHeartLength: IUniform<number>;
}

/** The one shared set (module singleton, one canvas per page). Updated each frame by the anatomy. */
export const BEAT_UNIFORMS: BeatUniforms = {
  uBeatV: { value: 0 },
  uBeatAtrial: { value: 0 },
  uHeartApex: { value: new Vector3() },
  uHeartAxis: { value: new Vector3(0, 1, 0) },
  uHeartLength: { value: 1 },
};

/** Point the shared uniforms at a heart frame (once per loaded anatomy). */
export function setBeatFrame(frame: Pick<HeartFrame, 'apex' | 'axis' | 'length'>): void {
  BEAT_UNIFORMS.uHeartApex.value.copy(frame.apex);
  BEAT_UNIFORMS.uHeartAxis.value.copy(frame.axis);
  BEAT_UNIFORMS.uHeartLength.value = frame.length;
}

/** Set this frame's activations (the anatomy rig, once per frame). */
export function setBeatActivation(v: number, a: number): void {
  BEAT_UNIFORMS.uBeatV.value = v;
  BEAT_UNIFORMS.uBeatAtrial.value = a;
}

const glslFloat = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * Vertex declarations. `uRestOffset` is the mesh's rest translation inside the anatomy root, so
 * `position + uRestOffset` is the vertex in the heart's rest frame (each GLB node is centred on itself).
 * The constants are generated from `BEAT_AMPLITUDE` and the profile constants above, so the shader and the
 * CPU twin cannot drift apart.
 */
export const BEAT_VERTEX_PARS = /* glsl */ `
uniform float uBeatV;
uniform float uBeatAtrial;
uniform vec3 uHeartApex;
uniform vec3 uHeartAxis;
uniform float uHeartLength;
uniform vec3 uRestOffset;
uniform float uBeatMode; // 0 = still, 1 = moves with the heart (BEAT_MODE)
const float CT_LONG = ${glslFloat(BEAT_AMPLITUDE.longitudinal)};
const float CT_RAD = ${glslFloat(BEAT_AMPLITUDE.radial)};
const float CT_TWIST_APEX = ${glslFloat(TWIST_APEX)};
const float CT_TWIST_BASE = ${glslFloat(TWIST_BASE)};
const float CT_ATRIAL = ${glslFloat(BEAT_AMPLITUDE.atrial)};
const float CT_RESERVOIR = ${glslFloat(BEAT_AMPLITUDE.atrialReservoir)};
const float CT_ANCHOR = ${glslFloat(ANCHOR_HEIGHT)};
const float CT_ATRIAL_CENTRE = ${glslFloat(ATRIAL_CENTRE_HEIGHT)};
float ctLongProfile(float h) { return h <= 1.0 ? clamp(h, 0.0, 1.0) : 1.0 - smoothstep(1.0, CT_ANCHOR, h); }
float ctRadialProfile(float h) { return smoothstep(-0.1, 0.3, h) * (1.0 - smoothstep(0.92, 1.12, h)); }
float ctTwistProfile(float h) { return mix(CT_TWIST_APEX, CT_TWIST_BASE, clamp(h, 0.0, 1.0)) * (1.0 - smoothstep(1.0, 1.3, h)); }
float ctAtrialProfile(float h) { return smoothstep(0.88, 1.08, h) * (1.0 - smoothstep(1.5, 1.8, h)); }
vec3 ctRotateAbout(vec3 v, vec3 k, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(k, v) * s + k * (dot(k, v) * (1.0 - c));
}
vec3 ctBeatField(vec3 p) {
  float L = uHeartLength;
  vec3 ax = uHeartAxis;
  float v = uBeatV;
  float h = dot(p - uHeartApex, ax) / L;
  vec3 c = uHeartApex + ax * (h * L);
  vec3 r = ctRotateAbout(p - c, ax, v * ctTwistProfile(h));
  r *= 1.0 - CT_RAD * v * ctRadialProfile(h);
  vec3 q = c + r - ax * (CT_LONG * L * v * ctLongProfile(h));
  float wa = ctAtrialProfile(h);
  if (wa > 0.0) {
    vec3 ca = uHeartApex + ax * (CT_ATRIAL_CENTRE * L - CT_LONG * L * v * ctLongProfile(CT_ATRIAL_CENTRE));
    q += (q - ca) * ((CT_RESERVOIR * max(v, 0.0) - CT_ATRIAL * uBeatAtrial) * wa);
  }
  return q;
}
// p: rest-frame position; w: 1 = heart, 0 = still (great vessels fade along their length, aBeatW).
vec3 ctBeat(vec3 p, float w) {
  if (uBeatMode < 0.5 || w <= 0.0 || (uBeatV == 0.0 && uBeatAtrial == 0.0)) return p;
  return mix(p, ctBeatField(p), w);
}
// The twist rotates the surface, so it rotates the normal with it (the small strains do not, noticeably).
vec3 ctBeatNormal(vec3 n, vec3 p, float w) {
  if (uBeatMode < 0.5 || w <= 0.0 || uBeatV == 0.0) return n;
  float h = dot(p - uHeartApex, uHeartAxis) / uHeartLength;
  return ctRotateAbout(n, uHeartAxis, w * uBeatV * ctTwistProfile(h));
}
`;

/** Extra declaration for meshes that carry the per-vertex great-vessel weight. */
export const BEAT_WEIGHT_PARS = /* glsl */ `
attribute float aBeatW;
`;

/** Replaces `transformed` (object space) after `#include <begin_vertex>`; full weight (heart meshes). */
export const BEAT_VERTEX = /* glsl */ `
transformed = ctBeat(transformed + uRestOffset, 1.0) - uRestOffset;
`;

/** As `BEAT_VERTEX`, weighted by `aBeatW` (great vessels). */
export const BEAT_VERTEX_WEIGHTED = /* glsl */ `
transformed = ctBeat(transformed + uRestOffset, aBeatW) - uRestOffset;
`;

/** Rotates `objectNormal` with the twist, after `#include <beginnormal_vertex>`. */
export const beatNormalChunk = (weighted: boolean): string => /* glsl */ `
objectNormal = ctBeatNormal(objectNormal, position + uRestOffset, ${weighted ? 'aBeatW' : '1.0'});
`;

/** Beat modes for `uBeatMode`. */
export const BEAT_MODE = { none: 0, heart: 1 } as const;
