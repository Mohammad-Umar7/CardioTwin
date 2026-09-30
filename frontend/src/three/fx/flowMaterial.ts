/**
 * Flow particle material: GPU-instanced streak sprites positioned entirely in the vertex shader.
 *
 * Per instance (4 floats each): aPath = (first texel, texel count, tree length, target slot) and
 * aSeed = (offset, speed jitter, lateral position, density key). Per frame the CPU uploads only ~60
 * uniforms (node matrices, flow distances, risk state); positions are never touched on the CPU.
 *
 * Vertex stage, per particle:
 *   d      = (offset·L + D[slot]·jitter) mod L                       distance along its ostium→tip path
 *   head   = lerp(node[i0]·texel[i0], node[i1]·texel[i1])            arc-length addressed centreline
 *   tail   = head − tangent · clamp(speed·exposure)                  streak length ∝ instantaneous speed
 *   lift   = both ends moved onto the vessel's camera-facing surface (radius + display inflation) and
 *            spread across the lumen, so the opaque vessel does not hide them but the heart wall does
 *   quad   = screen-space capsule from tail to head, `uWidthPx` wide
 * Fragment stage: a comet profile (bright head, fading tail), soft across — additive light with a faint
 * darkening halo (premultiplied blend), no depth write.
 */
import {
  AddEquation,
  Color,
  CustomBlending,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  ZeroFactor,
  type Texture,
} from 'three';
import { BEAT_MODE, BEAT_UNIFORMS, BEAT_VERTEX_PARS } from '../anatomy/beatDeform';
import { KEEP_LEVELS, NODE_SLOTS, RADIUS_SCALE } from './centreline';
import { FLOW_WHITE, MAX_NODES, MAX_TARGET_SLOTS } from './fxState';

/** The instanced quad's corners are stored at ±QUAD_SCALE (see FlowParticles) and scaled back in the shader. */
export const QUAD_SCALE = 1e-4;

const vertexShader = /* glsl */ `
  precision highp float;
  precision highp int;
  #define MAX_NODES ${MAX_NODES}
  #define MAX_SLOTS ${MAX_TARGET_SLOTS}

  uniform highp sampler2D uCentre;
  uniform int uTexWidth;
  uniform float uSpacing;
  uniform float uRadiusScale;
  uniform mat4 uNode[MAX_NODES];
  uniform float uNodeAlpha[MAX_NODES];
  uniform float uFlowDist[MAX_SLOTS];
  uniform float uFlowSpeed[MAX_SLOTS];
  uniform float uDensity[MAX_SLOTS];
  uniform float uTintMix[MAX_SLOTS];
  uniform float uP[MAX_SLOTS];
  uniform float uDim[MAX_SLOTS];
  uniform float uHover[MAX_SLOTS];
  uniform sampler2D uRiskLUT;
  uniform vec3 uFlowWhite;
  uniform float uIgnite;
  uniform float uPulseFront;
  uniform float uPulseAmp;
  uniform float uOpacity;
  uniform float uMeanSpeed;
  uniform vec2 uViewport;
  uniform float uWidthPx;
  uniform float uInflate;
  uniform float uExposure;

  attribute vec4 aPath;
  attribute vec4 aSeed;

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;

  // The anatomy's non-affine beat terms (atrial kick) — same chunk and shared uniforms as the vessels.
  ${BEAT_VERTEX_PARS}
  #include <clipping_planes_pars_vertex>

  vec4 centreTexel(int i) {
    return texelFetch(uCentre, ivec2(i % uTexWidth, i / uTexWidth), 0);
  }

  // w = node + NODE_SLOTS · round(keep · KEEP_LEVELS) + radius / RADIUS_SCALE (centreline.ts encodeW)
  int nodeOf(float w) { return int(mod(floor(w), ${NODE_SLOTS}.0)); }
  float keepOf(float w) { return floor(floor(w) / ${NODE_SLOTS}.0) / ${KEEP_LEVELS}.0; }

  vec3 toWorld(vec4 t, out float alpha) {
    int n = nodeOf(t.w);
    alpha = uNodeAlpha[n];
    return (uNode[n] * vec4(ctBeat(t.xyz), 1.0)).xyz;
  }

  void collapse() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: no fragments
    vAlpha = 0.0;
    vHalo = 0.0;
    #if NUM_CLIPPING_PLANES > 0
      vClipPosition = vec3(0.0);
    #endif
    vColor = vec3(0.0);
    vQuad = vec2(0.0);
  }

  void main() {
    int start = int(aPath.x + 0.5);
    int count = int(aPath.y + 0.5);
    int slot = int(aPath.w + 0.5);
    float L = float(count - 1) * uSpacing;
    float d = mod(aSeed.x * L + uFlowDist[slot] * aSeed.y, L);
    float arcN = d / aPath.z;

    // gates that do not depend on geometry: global fade, density thinning, ignition front
    float keep = smoothstep(aSeed.w, aSeed.w + 0.06, uDensity[slot]);
    float gate = 1.0 - smoothstep(uIgnite - 0.06, uIgnite, arcN);
    float alpha = uOpacity * keep * gate;
    if (alpha < 0.002) { collapse(); return; }

    float fi = d / uSpacing;
    int i0 = min(int(fi), count - 2);
    float f = fi - float(i0);
    vec4 t0 = centreTexel(start + i0);
    vec4 t1 = centreTexel(start + i0 + 1);
    float a0; float a1; float ab;
    vec3 p0 = toWorld(t0, a0);
    vec3 p1 = toWorld(t1, a1);
    vec3 head = mix(p0, p1, f);
    float radius = mix(fract(t0.w), fract(t1.w), f) * uRadiusScale;

    // Direction of flow, smoothed over three texels; across an exploded node seam use the local step.
    vec3 pb = toWorld(centreTexel(start + max(i0 - 2, 0)), ab);
    vec3 dir = head - pb;
    float span = length(dir);
    if (span > 6.0 * uSpacing || span < 1e-6) dir = p1 - p0;
    dir = normalize(dir + vec3(0.0, 1e-7, 0.0));
    // Two consecutive texels on different, separated nodes (exploded view): hide the jump.
    float seam = step(3.5 * uSpacing, distance(p0, p1));

    float speed = uFlowSpeed[slot] * aSeed.y;
    float len = clamp(speed * uExposure, 0.002, 0.03);

    vec4 hv = viewMatrix * vec4(head, 1.0);
    vec4 tv = viewMatrix * vec4(head - dir * len, 1.0);
    vec3 toCam = normalize(-hv.xyz);
    vec3 dirV = normalize(mat3(viewMatrix) * dir);
    vec3 side = cross(dirV, toCam);
    float sideLen = length(side);
    side = sideLen > 1e-5 ? side / sideLen : vec3(1.0, 0.0, 0.0);
    // Moving a point along its own view ray does not change where it lands on screen, only its depth: lift
    // generously (the lumen radius is the distance to the NEAREST wall, the display tube is inflated and
    // elliptical) so the opaque vessel never hides its own flow while the heart wall still occludes it.
    float lat = aSeed.z * 0.72;
    float lift = 1.6 * (radius + uInflate) + 0.002;
    vec3 offset = toCam * lift + side * (lat * radius);
    hv.xyz += offset;
    tv.xyz += offset;

    #if NUM_CLIPPING_PLANES > 0
      vClipPosition = -hv.xyz; // section-plane clipping (three's clipping_planes_fragment)
    #endif
    vec4 hc = projectionMatrix * hv;
    vec4 tc = projectionMatrix * tv;
    if (hc.w <= 0.0 || tc.w <= 0.0) { collapse(); return; }
    vec2 half_ = 0.5 * uViewport;
    vec2 hs = hc.xy / hc.w * half_;
    vec2 ts = tc.xy / tc.w * half_;
    vec2 axis = hs - ts;
    float axisLen = length(axis);
    vec2 ax = axisLen > 1e-3 ? axis / axisLen : vec2(1.0, 0.0);
    vec2 perp = vec2(-ax.y, ax.x);
    float halfW = 0.5 * uWidthPx;
    vec2 corner = position.xy * ${(1 / QUAD_SCALE).toFixed(1)}; // undo QUAD_SCALE
    float along = corner.x * 0.5 + 0.5;
    vec2 px = mix(ts, hs, along) + ax * (corner.x * halfW) + perp * (corner.y * halfW);
    gl_Position = vec4(px / half_ * hc.w, hc.z, hc.w);

    // Appearance
    float fade = smoothstep(0.0, 0.03, d) * smoothstep(0.0, 0.05, L - d);
    // Trunk thinning (particles.ts thinningFactors): an independent per-particle random against the local
    // keep factor, so overlapping ostium→tip paths do not pile up into a tuft on the proximal trunks.
    float thin = mix(keepOf(t0.w), keepOf(t1.w), f);
    float r2 = fract(sin(dot(aSeed.xw, vec2(12.9898, 78.233))) * 43758.5453);
    fade *= smoothstep(r2 - 0.1, r2, thin);
    float taper = mix(0.55, 1.0, smoothstep(0.004, 0.012, radius));
    alpha *= fade * taper * min(a0, a1) * (1.0 - seam) * (1.0 - 0.72 * uDim[slot]);
    float pulse = uPulseFront < 0.0 ? 0.0 : uPulseAmp * exp(-pow((arcN - uPulseFront) / 0.07, 2.0));
    vec3 ramp = texture2D(uRiskLUT, vec2(clamp(uP[slot], 0.0, 1.0), 0.5)).rgb;
    vec3 tint = mix(uFlowWhite, ramp, uTintMix[slot]);
    float surge = clamp(speed / max(uMeanSpeed, 1e-4), 0.0, 2.6);
    // HDR on purpose: the particles must read as light running OVER an already glowing vessel, so their
    // core sits well above the bloom threshold (they glint) while the tint keeps the vessel's hue family.
    vColor = tint * (1.05 + 0.55 * surge + 0.5 * pulse + 0.3 * uHover[slot]);
    vAlpha = alpha;
    // the lighter the vessel (high p → light apricot), the more the halo must darken around the streak
    vHalo = 0.22 + 0.5 * smoothstep(0.45, 1.0, uP[slot]) * uTintMix[slot] / 0.6;
    vQuad = corner;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    if (vAlpha <= 0.0) discard;
    float across = exp(-2.4 * vQuad.y * vQuad.y);
    // comet: dim tail, bright head, soft round cap
    float along = mix(0.12, 1.0, smoothstep(-1.0, 0.7, vQuad.x)) * (1.0 - smoothstep(0.78, 1.0, vQuad.x));
    float a = vAlpha * across * along;
    if (a < 0.003) discard;
    // white-hot head: the core crosses the bloom threshold even over a bright (high-risk) vessel
    float head = smoothstep(0.2, 0.85, vQuad.x) * exp(-6.0 * vQuad.y * vQuad.y);
    // Premultiplied output: additive light (rgb) plus a faint dark halo (alpha) that dims the vessel just
    // around the streak, so flow stays legible on the light apricot of a very-high-risk vessel.
    float halo = vAlpha * vHalo * exp(-1.1 * vQuad.y * vQuad.y) * smoothstep(-1.0, 0.2, vQuad.x);
    gl_FragColor = vec4(vColor * (1.0 + 1.3 * head) * a, halo);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface FlowUniforms {
  [name: string]: { value: unknown };
  uRestOffset: { value: Vector3 };
  uBeatMode: { value: number };
  uCentre: { value: Texture | null };
  uTexWidth: { value: number };
  uSpacing: { value: number };
  uRadiusScale: { value: number };
  uNode: { value: Matrix4[] };
  uNodeAlpha: { value: Float32Array };
  uFlowDist: { value: Float32Array };
  uFlowSpeed: { value: Float32Array };
  uDensity: { value: Float32Array };
  uTintMix: { value: Float32Array };
  uP: { value: Float32Array };
  uDim: { value: Float32Array };
  uHover: { value: Float32Array };
  uRiskLUT: { value: Texture };
  uFlowWhite: { value: Color };
  uIgnite: { value: number };
  uPulseFront: { value: number };
  uPulseAmp: { value: number };
  uOpacity: { value: number };
  uMeanSpeed: { value: number };
  uViewport: { value: Vector2 };
  uWidthPx: { value: number };
  uInflate: { value: number };
  uExposure: { value: number };
}

export type FlowMaterial = ShaderMaterial & { uniforms: FlowUniforms };

/** Streak "shutter": a particle's streak covers the distance it travels in this many seconds. */
export const STREAK_EXPOSURE_S = 0.045;
/** Quad width in CSS pixels (× device pixel ratio); the soft profile leaves a ≈ 2.5–3.5 px visible core (§7.4). */
export const STREAK_WIDTH_PX = 5.2;

export function createFlowMaterial(riskLut: Texture, inflate: number): FlowMaterial {
  const uniforms: FlowUniforms = {
    // Shared beat uniforms (same objects as the anatomy's, so they update together). Centreline points
    // are already in the rest frame, hence a zero rest offset; coronaries use the atrial-only mode.
    ...BEAT_UNIFORMS,
    uRestOffset: { value: new Vector3() },
    uBeatMode: { value: BEAT_MODE.atrial },
    uCentre: { value: null },
    uTexWidth: { value: 1 },
    uSpacing: { value: 0.008 },
    uRadiusScale: { value: RADIUS_SCALE },
    uNode: { value: Array.from({ length: MAX_NODES }, () => new Matrix4()) },
    uNodeAlpha: { value: new Float32Array(MAX_NODES) },
    uFlowDist: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uFlowSpeed: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uDensity: { value: new Float32Array(MAX_TARGET_SLOTS).fill(1) },
    uTintMix: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uP: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uDim: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uHover: { value: new Float32Array(MAX_TARGET_SLOTS) },
    uRiskLUT: { value: riskLut },
    uFlowWhite: { value: new Color().setRGB(...FLOW_WHITE) },
    uIgnite: { value: 0 },
    uPulseFront: { value: -1 },
    uPulseAmp: { value: 0 },
    uOpacity: { value: 0 },
    uMeanSpeed: { value: 0.3 },
    uViewport: { value: new Vector2(1, 1) },
    uWidthPx: { value: STREAK_WIDTH_PX },
    uInflate: { value: inflate },
    uExposure: { value: STREAK_EXPOSURE_S },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // result = light + destination · (1 − halo): additive light with a soft darkening halo
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    clipping: true,
  }) as FlowMaterial;
  return material;
}
