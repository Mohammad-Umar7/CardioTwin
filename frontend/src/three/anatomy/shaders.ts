/**
 * GLSL chunks for the anatomy materials (§7.9 Realistic mode). Everything procedural runs in the heart's
 * REST frame (`vCtRest` = object position + the mesh's rest offset), so detail, clipping and the beat stick
 * to the tissue while nodes explode, hinge and beat. No UVs are needed; baked textures (CONTRACTS §7.1) are
 * layered on top when a GLB carries them.
 */
import { ShaderChunk, type IUniform } from 'three';
import { BEAT_VERTEX, BEAT_VERTEX_PARS } from './beatDeform';

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, IUniform> };

/** Interleaved gradient noise (Jimenez 2014): a cheap, stable per-pixel dither in [0, 1). */
export const IGN = /* glsl */ `
float ctIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/**
 * Gradient noise from the baked 32³ volume (noiseTexture.ts): value ∈ [−1, 1] and its gradient in the
 * caller's units, one trilinear fetch per octave. The fBm offsets each octave so the repeating volume
 * never lines up with itself, and fades octaves out as they approach the pixel footprint (`aa` = world
 * units per pixel), so distant tissue never shimmers.
 */
export const NOISE = /* glsl */ `
uniform highp sampler3D uNoise3D;
vec4 ctNoised(vec3 x) {
  vec4 t = texture(uNoise3D, x * 0.125);
  return vec4(t.x * 2.0 - 1.0, (t.yzw * 2.0 - 1.0) * 4.0);
}
vec4 ctFbm(vec3 p, float f, float aa) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  for (int i = 0; i < CT_OCTAVES; i++) {
    float fade = 1.0 - smoothstep(0.25, 0.6, aa * f);
    if (fade <= 0.0) break;
    vec4 n = ctNoised(p * f + float(i) * vec3(2.71, 5.37, 1.19));
    sum += amp * fade * vec4(n.x, n.yzw * f);
    f *= 2.07;
    amp *= 0.5;
  }
  return sum;
}
`;

/**
 * Uniforms shared by every tissue material (by reference): a frame counter, and the gain of the warm edge
 * that rims the materialise front while the cold-load assembly plays (0 otherwise, so peel fades stay plain).
 */
export const FRAME_UNIFORMS = { uCtFrame: { value: 0 } as IUniform<number>, uCtEdgeGain: { value: 0 } as IUniform<number> };

/**
 * Materialise (assembly dissolve, solid ↔ ghost peel fades): a WORLD-SPACE noise front in the tissue's rest
 * frame, not a per-pixel screen-door dither — the tissue fills in as soft organic patches that ride with it,
 * with no dot lattice at any frame rate, and it rests only at fully shown or fully hidden. `ctEdge` (1 on
 * the front) feeds the warm rim of the assembly.
 */
export const MATERIALISE = /* glsl */ `
float ctEdge = 0.0;
if (uReveal < 0.999) {
  float ctN = 0.65 * texture(uNoise3D, vCtRest * 0.75).x + 0.35 * texture(uNoise3D, vCtRest * 2.3 + vec3(0.31, 0.17, 0.53)).x;
  ctN = clamp((ctN - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  float ctFront = uReveal * 1.12 - 0.06;
  if (ctN > ctFront) discard;
  ctEdge = 1.0 - smoothstep(0.0, 0.07, ctFront - ctN);
}
`;

export interface PatchFlags {
  /** Procedural bump + albedo variation. */
  detail: boolean;
  /** Stretch the detail across the long axis (myocardial fibres run circumferentially). */
  fibre: boolean;
  /** Epicardial fat in the AV groove (myocardium only). */
  fat: boolean;
  /** Wrap-diffuse + back-scatter translucency (fake subsurface scattering). */
  sss: boolean;
  /** Back faces (chamber interiors, cut faces) get their own colour. */
  interior: boolean;
  /** Supplied-territory tint from a vertex attribute (name). */
  territory: string | null;
  /** Fresnel rim added to emission. */
  rim: boolean;
  /** Dithered sphere clip (pulmonary trees, V2 §5.15). */
  clipSphere: boolean;
  /** Clamp the saturation of a baked albedo (so anatomical red never competes with the ramp). */
  desaturateMap: boolean;
  /** Per-vertex cavity attribute `aCavity` (crease AO, vessel groove, fat along vessels). */
  cavity: boolean;
  /**
   * Outer layers (skin, muscle, ribs, lungs, diaphragm): the peel fades them with real alpha instead of the
   * noise front, so a chest layer turning into its ghost never breaks into confetti or black holes.
   */
  fadeAlpha: boolean;
  /** Noise octaves (tier dependent). */
  octaves: number;
}

export const NO_PATCH: PatchFlags = {
  detail: false,
  fibre: false,
  fat: false,
  sss: false,
  interior: false,
  territory: null,
  rim: false,
  clipSphere: false,
  desaturateMap: false,
  cavity: false,
  fadeAlpha: false,
  octaves: 3,
};

export function patchKey(f: PatchFlags): string {
  return [
    f.detail ? 'd' : '',
    f.fibre ? 'f' : '',
    f.fat ? 't' : '',
    f.sss ? 's' : '',
    f.interior ? 'i' : '',
    f.territory ? `T${f.territory}` : '',
    f.rim ? 'r' : '',
    f.clipSphere ? 'c' : '',
    f.desaturateMap ? 'x' : '',
    f.cavity ? 'v' : '',
    f.fadeAlpha ? 'a' : '',
    `o${f.octaves}`,
  ].join('');
}

/**
 * Patch a MeshStandard/MeshPhysical shader in place. `uniforms` must hold every uniform the flags use (see
 * `tissue.ts`); they are shared by reference so the scene animates them without recompiling.
 */
export function patchTissueShader(shader: Shader, uniforms: Record<string, IUniform>, f: PatchFlags): void {
  Object.assign(shader.uniforms, uniforms);

  // ------------------------------------------------------------------------------------ vertex
  let vs = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
${BEAT_VERTEX_PARS}
varying vec3 vCtRest;
${f.territory ? `attribute vec3 ${f.territory};\nvarying vec3 vCtTerritory;` : ''}
${f.cavity ? 'attribute vec3 aCavity;\nvarying vec3 vCtCavity;' : ''}`,
  );
  vs = vs.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
vCtRest = transformed + uRestOffset;
${BEAT_VERTEX}
${f.territory ? `vCtTerritory = ${f.territory};` : ''}
${f.cavity ? 'vCtCavity = aCavity;' : ''}`,
  );
  shader.vertexShader = vs;

  // ---------------------------------------------------------------------------------- fragment
  const defines = [`#define CT_OCTAVES ${Math.max(1, Math.min(5, f.octaves))}`];
  let fs = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
${defines.join('\n')}
varying vec3 vCtRest;
uniform float uReveal;
uniform float uCtFrame;
uniform float uCtEdgeGain;
${f.detail ? '' : 'uniform highp sampler3D uNoise3D;'}
${f.cavity ? 'varying vec3 vCtCavity;\nuniform float uCavityAO;\nuniform float uGrooveAO;\nuniform float uVesselFat;' : ''}
${f.detail ? `${NOISE}
uniform mat3 normalMatrix;
uniform float uDetailFreq;
uniform float uBump;
uniform float uColorVar;
uniform float uRoughVar;
uniform vec3 uTintDeep;
uniform vec3 uFibreAxis;
uniform float uFibreStretch;` : ''}
${f.fat ? 'uniform vec3 uFatColor;\nuniform float uFatAmount;\nuniform vec3 uHeartApex;\nuniform vec3 uHeartAxis;\nuniform float uHeartLength;' : ''}
${f.sss ? 'uniform float uWrap;\nuniform vec3 uWrapTint;\nuniform vec3 uSssColor;\nuniform float uSssStrength;' : ''}
${f.interior ? 'uniform vec3 uInteriorColor;' : ''}
${f.territory ? 'uniform vec3 uP;\nuniform sampler2D uRiskLUT;\nuniform float uTerritoryOn;\nuniform vec3 uSelMask;\nuniform float uTerritoryGain;\nvarying vec3 vCtTerritory;' : ''}
${f.rim ? 'uniform vec3 uRimColor;\nuniform float uRimStrength;' : ''}
${f.clipSphere ? 'uniform vec3 uClipCentre;\nuniform float uClipRadius;\nuniform float uClipFeather;' : ''}
${f.desaturateMap ? 'uniform float uSaturation;' : ''}`,
  );

  // Materialise (world-space noise front, see MATERIALISE) and the pulmonary / great-vessel sphere clip.
  fs = fs.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
${f.fadeAlpha ? 'float ctEdge = 0.0;' : MATERIALISE}
${f.clipSphere ? `float ctClipKeep = 1.0 - smoothstep(uClipRadius - uClipFeather, uClipRadius, distance(vCtRest, uClipCentre));
if (ctClipKeep <= 0.0) discard;` : ''}`,
  );

  fs = fs.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
${f.desaturateMap ? `diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, uSaturation);` : ''}
${f.detail ? `
vec3 ctP = vCtRest;
${f.fibre ? 'ctP += uFibreAxis * (dot(ctP, uFibreAxis) * (uFibreStretch - 1.0));' : ''}
float ctAA = length(fwidth(vCtRest));
vec4 ctDetail = ctFbm(ctP, uDetailFreq, ctAA);
vec4 ctBroad = ctNoised(vCtRest * (uDetailFreq * 0.23) + vec3(3.1, 7.7, 1.3));
diffuseColor.rgb *= 1.0 + uColorVar * (0.55 * ctDetail.x + 0.45 * ctBroad.x);
diffuseColor.rgb = mix(diffuseColor.rgb, uTintDeep, uColorVar * smoothstep(0.1, 0.9, ctBroad.x));` : 'vec4 ctDetail = vec4(0.0);\nvec4 ctBroad = vec4(0.0);'}
${f.fat ? `{
  float ctH = dot(vCtRest - uHeartApex, uHeartAxis) / uHeartLength;
  float ctGroove = smoothstep(0.78, 0.93, ctH) * (1.0 - smoothstep(1.02, 1.12, ctH));
  float ctFat = clamp(ctGroove * (0.6 + 0.7 * ctDetail.x + 0.5 * ctBroad.x), 0.0, 1.0) * uFatAmount;
  diffuseColor.rgb = mix(diffuseColor.rgb, uFatColor * (0.9 + 0.2 * ctDetail.x), ctFat);
}` : ''}
${f.cavity ? `{
  float ctVesselFat = vCtCavity.z * clamp(0.45 + 0.7 * ctDetail.x + 0.5 * ctBroad.x, 0.0, 1.0);
  ${f.fat ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uFatColor * (0.9 + 0.2 * ctDetail.x), ctVesselFat * uVesselFat);' : ''}
}` : ''}
${f.territory ? `{
  vec3 ctW = pow(max(vCtTerritory, vec3(0.0)), vec3(2.0));
  float ctSum = ctW.x + ctW.y + ctW.z;
  if (uTerritoryOn > 0.001 && ctSum > 1e-4) {
    float ctNeutral = clamp(1.0 - (vCtTerritory.x + vCtTerritory.y + vCtTerritory.z), 0.0, 1.0);
    ctW /= ctSum;
    vec3 ctTint = ctW.x * texture2D(uRiskLUT, vec2(uP.x, 0.5)).rgb
                + ctW.y * texture2D(uRiskLUT, vec2(uP.y, 0.5)).rgb
                + ctW.z * texture2D(uRiskLUT, vec2(uP.z, 0.5)).rgb;
    float ctStrength = (0.10 + uTerritoryGain * dot(ctW, uP)) * dot(ctW, uSelMask) * uTerritoryOn * (1.0 - ctNeutral);
    diffuseColor.rgb = mix(diffuseColor.rgb, ctTint, ctStrength);
  }
}` : ''}
${f.interior ? `if (!gl_FrontFacing) diffuseColor.rgb = uInteriorColor * (1.0 + 0.35 * ctDetail.x);` : ''}`,
  );

  if (f.detail) {
    fs = fs.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + uRoughVar * ctDetail.x, 0.04, 1.0);`,
    );
    // Bump: tilt the shading normal by the tangential part of the noise gradient (object → view space).
    fs = fs.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
{
  vec3 ctG = normalMatrix * ctDetail.yzw;
  vec3 ctT = ctG - dot(ctG, normal) * normal;
  normal = normalize(normal - uBump * ctT);
}`,
    );
  }

  if (f.cavity) {
    fs = fs.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
{
  float ctAO = (1.0 - uCavityAO * vCtCavity.x) * (1.0 - uGrooveAO * vCtCavity.y);
  reflectedLight.indirectDiffuse *= ctAO;
  reflectedLight.indirectSpecular *= ctAO;
  reflectedLight.directDiffuse *= mix(1.0, ctAO, 0.65);
  reflectedLight.directSpecular *= mix(1.0, ctAO, 0.5);
}`,
    );
  }

  // The warm rim on the materialise front (assembly only: uCtEdgeGain is 0 the rest of the time).
  fs = fs.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.45) * (0.9 * ctEdge * uCtEdgeGain);`,
  );

  if (f.rim) {
    fs = fs.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  float ctF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uRimColor * uRimStrength * ctF;
}`,
    );
  }

  if (f.sss) {
    // Wrap diffuse (light bleeds past the terminator, tinted like blood-filled tissue) + back-scatter where
    // the rim light shines through thin edges. Specular keeps the true N·L.
    const lights = ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `{
    float ctNL = dot( geometryNormal, directLight.direction );
    float ctWrapNL = saturate( ( ctNL + uWrap ) / ( 1.0 + uWrap ) );
    vec3 ctIrr = directLight.color * ( dotNL + uWrapTint * max( ctWrapNL - dotNL, 0.0 ) );
    reflectedLight.directDiffuse += ctIrr * BRDF_Lambert( material.diffuseColor );
    vec3 ctH = normalize( directLight.direction + geometryNormal * 0.4 );
    float ctBack = pow( saturate( dot( geometryViewDir, -ctH ) ), 3.0 );
    reflectedLight.directDiffuse += directLight.color * uSssColor * ( ctBack * uSssStrength );
  }`,
    );
    fs = fs.replace('#include <lights_physical_pars_fragment>', lights);
  }

  if (f.fadeAlpha) {
    // Smoothstep so the last few percent of a fade do not linger as a haze.
    fs = fs.replace('#include <opaque_fragment>', `diffuseColor.a *= smoothstep(0.0, 1.0, uReveal);
if (diffuseColor.a < 0.004) discard;
#include <opaque_fragment>`);
  }

  if (f.clipSphere) {
    // Fade the trimmed vessel out with real alpha (the material is transparent): no dither sparkle and no
    // black stub where a trimmed branch crosses the heart.
    fs = fs.replace('#include <opaque_fragment>', `diffuseColor.a *= ctClipKeep * ctClipKeep;\n#include <opaque_fragment>`);
  }

  shader.fragmentShader = fs;
}
