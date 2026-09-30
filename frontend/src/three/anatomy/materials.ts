/**
 * Materials (DESIGN_SYSTEM §7.3): MeshStandardMaterial with small onBeforeCompile patches. Anatomy is
 * achromatic clay; only coronary targets carry (risk) colour; territories are a subtle, approximate tint.
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import { ANATOMY, LIGHTS } from '@/theme/tokens';
import { getRiskLUT } from '../riskLut';

type Shader = Parameters<NonNullable<MeshStandardMaterial['onBeforeCompile']>>[0];

/** Adds a fresnel rim (view-dependent emissive) to a standard material's fragment shader. */
function addFresnelRim(shader: Shader, uniforms: Record<string, IUniform>) {
  shader.uniforms.uRimColor = uniforms.uRimColor!;
  shader.uniforms.uRimStrength = uniforms.uRimStrength!;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float ctFresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += uRimColor * uRimStrength * ctFresnel;`,
    );
}

// ------------------------------------------------------------------------------- myocardium

export interface MyocardiumUniforms {
  uP: IUniform<Vector3>;
  uRiskLUT: IUniform<Texture>;
  uTerritoryOn: IUniform<number>;
  uSelMask: IUniform<Vector3>;
  uRimColor: IUniform<Color>;
  uRimStrength: IUniform<number>;
}

export type MyocardiumMaterial = MeshStandardMaterial & { userData: { uniforms: MyocardiumUniforms } };

/**
 * Clay (default) or anatomical myocardium with the supplied-territory tint (§7.4):
 *   w = normalize(pow(weights, 2)); tint = Σ wᵢ·LUT(pᵢ); strength = 0.10 + 0.40·Σ wᵢpᵢ (×0.25 for
 *   non-selected territories); albedo = mix(clay, tint, strength); no emissive, so a vessel always
 *   outshines its own territory. `territoryAttribute` is `aTerritory` (procedural) or `color` (GLB COLOR_0).
 */
export function createMyocardiumMaterial(look: 'clay' | 'anat' = 'clay', territoryAttribute = 'aTerritory'): MyocardiumMaterial {
  const uniforms: MyocardiumUniforms = {
    uP: { value: new Vector3(0, 0, 0) },
    uRiskLUT: { value: getRiskLUT() },
    uTerritoryOn: { value: 0 },
    uSelMask: { value: new Vector3(1, 1, 1) },
    uRimColor: { value: new Color(ANATOMY.fresnelRim) },
    uRimStrength: { value: 0.1 },
  };
  const material = new MeshStandardMaterial({
    color: look === 'clay' ? ANATOMY.clay : ANATOMY.flesh,
    roughness: 0.62,
    metalness: 0,
    envMapIntensity: LIGHTS.envMapIntensity,
  }) as MyocardiumMaterial;
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uP: uniforms.uP, uRiskLUT: uniforms.uRiskLUT, uTerritoryOn: uniforms.uTerritoryOn, uSelMask: uniforms.uSelMask });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 ${territoryAttribute};\nvarying vec3 vTerritory;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvTerritory = ${territoryAttribute};`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uP;
        uniform sampler2D uRiskLUT;
        uniform float uTerritoryOn;
        uniform vec3 uSelMask;
        varying vec3 vTerritory;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 ctW = pow(max(vTerritory, vec3(0.0)), vec3(2.0));
        float ctSum = ctW.x + ctW.y + ctW.z;
        if (uTerritoryOn > 0.001 && ctSum > 1e-4) {
          ctW /= ctSum;
          vec3 ctTint = ctW.x * texture2D(uRiskLUT, vec2(uP.x, 0.5)).rgb
                      + ctW.y * texture2D(uRiskLUT, vec2(uP.y, 0.5)).rgb
                      + ctW.z * texture2D(uRiskLUT, vec2(uP.z, 0.5)).rgb;
          float ctStrength = (0.10 + 0.40 * dot(ctW, uP)) * dot(ctW, uSelMask) * uTerritoryOn;
          diffuseColor.rgb = mix(diffuseColor.rgb, ctTint, ctStrength);
        }`,
      );
    addFresnelRim(shader, uniforms as unknown as Record<string, IUniform>);
  };
  material.customProgramCacheKey = () => `ct-myocardium-${territoryAttribute}`;
  return material;
}

// ---------------------------------------------------------------------------------- vessels

export type VesselMaterial = MeshStandardMaterial & { userData: { uniforms: { uRimColor: IUniform<Color>; uRimStrength: IUniform<number> } } };

/**
 * Coronary target material: color = emissive = ramp(p) (set per frame by useRiskAnimation), roughness
 * 0.30, fresnel rim #E8ECF1 × 0.25. One uniform colour per target, root to tip.
 */
export function createVesselMaterial(): VesselMaterial {
  const uniforms = { uRimColor: { value: new Color(ANATOMY.vesselRim) }, uRimStrength: { value: 0.25 } };
  const material = new MeshStandardMaterial({
    color: ANATOMY.vesselPending,
    emissive: ANATOMY.vesselPending,
    emissiveIntensity: 0,
    roughness: 0.3,
    metalness: 0,
    envMapIntensity: LIGHTS.envMapIntensity,
  }) as VesselMaterial;
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => addFresnelRim(shader, uniforms);
  material.customProgramCacheKey = () => 'ct-vessel';
  return material;
}

/** Dark inverted-hull rim so vessel silhouettes read against a similar-lightness wall. */
export function createHullMaterial(color: string = ANATOMY.vesselHullRim): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, side: BackSide, toneMapped: false });
}

// ------------------------------------------------------------------------------ neutral anatomy

export const createLeftMainMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.leftMain, roughness: 0.45, metalness: 0, envMapIntensity: LIGHTS.envMapIntensity });

export const createGreatVesselMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.greatVessel, roughness: 0.45, metalness: 0, envMapIntensity: LIGHTS.envMapIntensity });

export const createValveMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.valvePapillary, roughness: 0.5, metalness: 0, envMapIntensity: LIGHTS.envMapIntensity });

export const createCutFaceMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.cutFace, roughness: 0.7, metalness: 0, side: DoubleSide });

/**
 * Ghost material for outer layers (skin, bone once peeled, lungs): additive fresnel outline, no depth
 * write, env map off. Reads like an X-ray contour and never competes with the coronary colours.
 */
export function createGhostMaterial(color: string, baseAlpha: number, rimAlpha: number, power = 2): MeshBasicMaterial {
  const uniforms = { uBase: { value: baseAlpha }, uRim: { value: rimAlpha }, uPower: { value: power }, uFade: { value: 1 } };
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCtNormal;\nvarying vec3 vCtView;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCtNormal = normalize(normalMatrix * normal);
        vCtView = normalize(-mvPosition.xyz);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uBase;\nuniform float uRim;\nuniform float uPower;\nuniform float uFade;\nvarying vec3 vCtNormal;\nvarying vec3 vCtView;',
      )
      .replace(
        '#include <opaque_fragment>',
        `float ctF = pow(1.0 - abs(dot(normalize(vCtNormal), normalize(vCtView))), uPower);
        diffuseColor.a = (uBase + uRim * ctF) * uFade;
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `ct-ghost-${power}`;
  return material;
}

export const createBoneMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.bone, roughness: 0.85, metalness: 0, envMapIntensity: LIGHTS.envMapIntensity });

export const createMuscleMaterial = () =>
  new MeshStandardMaterial({ color: ANATOMY.muscle, roughness: 0.7, metalness: 0, envMapIntensity: LIGHTS.envMapIntensity });

export const createDiaphragmMaterial = () =>
  new MeshStandardMaterial({
    color: ANATOMY.diaphragm,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
