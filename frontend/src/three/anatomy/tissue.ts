/**
 * Tissue materials for both looks (DESIGN_SYSTEM §7.3 Clinical, §7.9 Realistic).
 *
 * One material instance per mesh (the per-mesh rest offset, assembly dissolve and baked maps differ), but
 * only a handful of programs: the shader variant is keyed by the patch flags, never by the mesh. Shared
 * uniform objects (beat, territory, pulmonary clip) are passed by reference so the whole scene animates
 * without recompiling or allocating per frame.
 *
 *  Clinical  = LUMEN clay: MeshStandardMaterial, achromatic, smooth, wrap-diffuse only.
 *  Realistic = MeshPhysicalMaterial: clearcoat (wet epicardium / glossy vessel walls), sheen (tier A),
 *              wrap + back-scatter subsurface approximation, procedural rest-frame detail (bump, mottling,
 *              fibre direction, AV-groove fat), ivory bone, translucent spongy lung; baked GLB maps are used
 *              when present (CONTRACTS §7.1) with the procedural layer toned down on top.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  type IUniform,
  type Material,
  type Plane,
  type Texture,
} from 'three';
import { ANATOMY, LIGHTS } from '@/theme/tokens';
import { BEAT_UNIFORMS } from './beatDeform';
import type { TissueKind } from './classify';
import { getNoiseTexture } from './noiseTexture';
import { GHOST, REAL } from './palette';
import { FRAME_UNIFORMS, IGN, NO_PATCH, patchKey, patchTissueShader, type PatchFlags } from './shaders';

export type SceneLookId = 'realistic' | 'clinical';
export type QualityTier = 'A' | 'B' | 'C' | 'D';

export interface BakedMaps {
  map?: Texture | null;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  aoMap?: Texture | null;
}

/** Shared per-scene uniform sets. */
export interface TerritoryUniforms {
  uP: IUniform<Vector3>;
  uRiskLUT: IUniform<Texture | null>;
  uTerritoryOn: IUniform<number>;
  uSelMask: IUniform<Vector3>;
  uTerritoryGain: IUniform<number>;
}

export interface ClipUniforms {
  uClipCentre: IUniform<Vector3>;
  uClipRadius: IUniform<number>;
  uClipFeather: IUniform<number>;
}

export interface SharedUniforms {
  territory: TerritoryUniforms;
  /** Pulmonary trees: a sphere at the hilum (V2 §5.15). */
  clip: ClipUniforms;
  /** Systemic great vessels: a larger sphere around the heart (the descending aorta and IVC fade out). */
  clipGreat: ClipUniforms;
}

/** Kinds trimmed by a clip sphere, and which one. */
export function clipOf(kind: TissueKind, shared: SharedUniforms): ClipUniforms | null {
  if (kind === 'pulmonaryArtery' || kind === 'pulmonaryVeins') return shared.clip;
  if (kind === 'aorta' || kind === 'systemicVein') return shared.clipGreat;
  return null;
}

export interface TissueUniforms extends Record<string, IUniform> {
  uRestOffset: IUniform<Vector3>;
  uBeatMode: IUniform<number>;
  uReveal: IUniform<number>;
}

export type TissueMaterial = (MeshStandardMaterial | MeshPhysicalMaterial) & {
  userData: { ct: { uniforms: TissueUniforms; kind: TissueKind; look: SceneLookId; flags: PatchFlags; floorScale: number } };
};

export interface TissueOptions {
  kind: TissueKind;
  look: SceneLookId;
  tier: QualityTier;
  restOffset: Vector3;
  beatMode: number;
  shared: SharedUniforms;
  /** Territory weights attribute (`color` = GLB COLOR_0, `aTerritory` = procedural), myocardium only. */
  territoryAttribute?: string | null;
  maps?: BakedMaps | null;
  /** Section plane(s), shared array (heart structures only). */
  clippingPlanes?: Plane[] | null;
  /** Display inflation along normals (vessels), scene units. */
  inflate?: number;
  /** The geometry carries `aCavity` (crease AO, vessel groove, fat along the arteries). */
  cavity?: boolean;
}

/** Absolute display inflation of coronary walls (≈ the spec's 1.3×, documented in §7.3). */
export { VESSEL_INFLATE } from './materials';
/**
 * Depth bias of the coronary tree toward the camera (scene units; 0.03 = 3 mm): enough to show through the
 * epicardial fat over the arteries in their grooves, far less than the ventricular wall.
 */
export const VESSEL_DEPTH_PULL = 0.03;

interface Look {
  color: string;
  roughness: number;
  metalness?: number;
  env: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  detail?: { freq: number; bump: number; colorVar: number; roughVar: number; deep: string; fibre?: { axis: 'heart' | [number, number, number]; stretch: number } };
  sss?: { wrap: number; tint: string; color: string; strength: number };
  interior?: string;
  rim?: { color: string; strength: number };
  fat?: number;
  transparent?: { opacity: number };
  /**
   * With a baked albedo (CONTRACTS §7.1) the map IS the tissue colour: the colour factor becomes this light
   * tint (default white) instead of `color`, so the bake is never multiplied into a second, darker copy of
   * itself. `saturation` < 1 greys the bake (great vessels and veins must never out-shout the coronary
   * ramp, V2 §5.15).
   */
  baked?: { tint?: string; saturation?: number };
  /** Depth bias toward the camera (epicardial fat lying on the wall it covers). */
  polygonOffset?: boolean;
}

const CLINICAL: Partial<Record<TissueKind, Look>> = {
  myocardium: { color: ANATOMY.clay, roughness: 0.62, env: 0.25, sss: { wrap: 0.25, tint: ANATOMY.clayWrap, color: '#000000', strength: 0 }, interior: ANATOMY.cutFace, rim: { color: ANATOMY.fresnelRim, strength: 0.1 } },
  papillary: { color: ANATOMY.valvePapillary, roughness: 0.5, env: LIGHTS.envMapIntensity },
  valve: { color: ANATOMY.valvePapillary, roughness: 0.5, env: LIGHTS.envMapIntensity, interior: ANATOMY.cutFace },
  coronary: { color: ANATOMY.vesselPending, roughness: 0.3, env: LIGHTS.envMapIntensity, rim: { color: ANATOMY.vesselRim, strength: 0.25 }, interior: '#1A1012' },
  leftMain: { color: ANATOMY.leftMain, roughness: 0.45, env: LIGHTS.envMapIntensity, interior: '#1A1012' },
  aorta: { color: ANATOMY.greatVessel, roughness: 0.45, env: LIGHTS.envMapIntensity, interior: ANATOMY.cutFace },
  pulmonaryArtery: { color: ANATOMY.vein, roughness: 0.65, env: 0.2, interior: ANATOMY.cutFace },
  pulmonaryVeins: { color: ANATOMY.vein, roughness: 0.65, env: 0.2, interior: ANATOMY.cutFace },
  systemicVein: { color: ANATOMY.greatVessel, roughness: 0.45, env: LIGHTS.envMapIntensity, interior: ANATOMY.cutFace },
  cardiacVein: { color: ANATOMY.vein, roughness: 0.6, env: 0.2 },
  fat: { color: ANATOMY.clay, roughness: 0.72, env: 0.2, polygonOffset: true },
  bone: { color: ANATOMY.bone, roughness: 0.85, env: LIGHTS.envMapIntensity },
  cartilage: { color: ANATOMY.bone, roughness: 0.7, env: LIGHTS.envMapIntensity },
  muscle: { color: ANATOMY.muscle, roughness: 0.7, env: LIGHTS.envMapIntensity },
  diaphragm: { color: ANATOMY.diaphragm, roughness: 0.6, env: LIGHTS.envMapIntensity, transparent: { opacity: 0.5 } },
  airway: { color: ANATOMY.bone, roughness: 0.7, env: 0.2 },
  oesophagus: { color: ANATOMY.muscle, roughness: 0.7, env: 0.2 },
};

/**
 * Realistic look. Gloss is a soft, broad wet sheen (clearcoat ≤ 0.35 at roughness ≥ 0.35 over the baked
 * roughness), never lacquer: highlights stay small and warm, and the baked albedo carries the colour.
 */
const REALISTIC: Partial<Record<TissueKind, Look>> = {
  myocardium: {
    color: REAL.myocardium,
    roughness: 0.55,
    env: 0.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    sheen: 0.2,
    sheenColor: '#8E3A34',
    sheenRoughness: 0.6,
    detail: { freq: 5.5, bump: 0.0035, colorVar: 0.22, roughVar: 0.12, deep: REAL.myocardiumDeep, fibre: { axis: 'heart', stretch: 2.2 } },
    sss: { wrap: 0.55, tint: REAL.wrapTint, color: REAL.sss, strength: 0.28 },
    interior: REAL.interior,
    fat: 0.5,
    baked: { tint: '#FFFFFF', saturation: 0.94 },
  },
  fat: {
    // Epicardial adipose tissue: soft, yellow, faintly translucent lobules in the grooves.
    color: REAL.fatMesh,
    roughness: 0.5,
    env: 0.45,
    clearcoat: 0.4,
    clearcoatRoughness: 0.34,
    sheen: 0.3,
    sheenColor: '#FFF3DE',
    sheenRoughness: 0.5,
    detail: { freq: 16, bump: 0.004, colorVar: 0.14, roughVar: 0.1, deep: REAL.fatDeep },
    sss: { wrap: 0.3, tint: '#FFF0D6', color: '#B89A6A', strength: 0.14 },
    // The bake is a saturated ochre: grey it toward the pale ivory-yellow of real epicardial fat, well away
    // from the ramp's high (apricot / orange) end so a high-risk artery never melts into its groove.
    baked: { tint: '#F6EEE2', saturation: 0.5 },
    polygonOffset: true,
  },
  papillary: {
    color: REAL.papillary,
    roughness: 0.5,
    env: 0.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    detail: { freq: 12, bump: 0.005, colorVar: 0.18, roughVar: 0.1, deep: REAL.myocardiumDeep },
    sss: { wrap: 0.5, tint: REAL.wrapTint, color: REAL.sss, strength: 0.25 },
    baked: { tint: '#FFFFFF', saturation: 0.94 },
  },
  valve: {
    // Thin pale leaflets: a toned-down bake so the valves read as tissue, not bright tan combs.
    color: REAL.valve,
    roughness: 0.55,
    env: 0.45,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    detail: { freq: 22, bump: 0.003, colorVar: 0.12, roughVar: 0.1, deep: '#A88E72' },
    sss: { wrap: 0.5, tint: '#FFD2B0', color: '#C07A58', strength: 0.3 },
    interior: '#8E7866',
    baked: { tint: '#BFB0A4', saturation: 0.8 },
  },
  coronary: {
    // Glossy but not mirror-like: at low risk the thin tube must still read as its ramp blue, not as a
    // white highlight.
    color: ANATOMY.vesselPending,
    roughness: 0.34,
    env: 0.5,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    detail: { freq: 45, bump: 0.0015, colorVar: 0.05, roughVar: 0.06, deep: '#000000' },
    rim: { color: REAL.coronaryRim, strength: 0.1 },
    interior: '#1A0C0C',
  },
  leftMain: {
    color: REAL.leftMain,
    roughness: 0.4,
    env: 0.6,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    detail: { freq: 45, bump: 0.0015, colorVar: 0.06, roughVar: 0.06, deep: '#5E4C46' },
    interior: '#1A0C0C',
  },
  aorta: {
    // Pale adventitia (a real specimen's cream-pink), greyed so its chroma stays under the coronary ramp.
    color: REAL.adventitia,
    roughness: 0.6,
    env: 0.45,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    detail: { freq: 14, bump: 0.004, colorVar: 0.14, roughVar: 0.12, deep: REAL.adventitiaDeep },
    sss: { wrap: 0.35, tint: '#FFC2B0', color: '#9A4C3E', strength: 0.12 },
    interior: '#4A2322',
    baked: { tint: '#EADCD4', saturation: 0.3 },
  },
  pulmonaryArtery: {
    color: REAL.adventitia,
    roughness: 0.6,
    env: 0.45,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    detail: { freq: 14, bump: 0.004, colorVar: 0.14, roughVar: 0.12, deep: REAL.adventitiaDeep },
    sss: { wrap: 0.35, tint: '#FFC2B0', color: '#9A4C3E', strength: 0.12 },
    interior: '#4A2322',
    baked: { tint: '#E2D2CA', saturation: 0.3 },
  },
  pulmonaryVeins: {
    color: REAL.pulmonaryVein,
    roughness: 0.5,
    env: 0.45,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    detail: { freq: 16, bump: 0.003, colorVar: 0.12, roughVar: 0.1, deep: '#4A2424' },
    interior: '#3A1716',
    baked: { tint: '#D2C0BC', saturation: 0.35 },
  },
  systemicVein: {
    // Dark plum-grey: venous, and never confusable with the ramp's low (blue) end.
    color: REAL.atlasVein,
    roughness: 0.5,
    env: 0.45,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    detail: { freq: 16, bump: 0.003, colorVar: 0.12, roughVar: 0.1, deep: REAL.atlasVeinDeep },
    interior: '#1B2233',
    baked: { tint: '#B8A8B2', saturation: 0.22 },
  },
  cardiacVein: {
    color: REAL.cardiacVein,
    roughness: 0.5,
    env: 0.4,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    detail: { freq: 30, bump: 0.002, colorVar: 0.1, roughVar: 0.08, deep: REAL.atlasVeinDeep },
    baked: { tint: '#F2DCE8', saturation: 0.3 },
  },
  bone: {
    color: REAL.bone,
    roughness: 0.62,
    env: 0.45,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    detail: { freq: 38, bump: 0.0035, colorVar: 0.16, roughVar: 0.14, deep: REAL.boneDeep },
    sss: { wrap: 0.2, tint: '#FFE8CC', color: '#6E5A3A', strength: 0.05 },
    baked: {},
  },
  cartilage: {
    color: REAL.cartilage,
    roughness: 0.4,
    env: 0.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    detail: { freq: 20, bump: 0.002, colorVar: 0.1, roughVar: 0.08, deep: '#98A6AA' },
    sss: { wrap: 0.4, tint: '#E8F4F6', color: '#7E9298', strength: 0.18 },
    baked: {},
  },
  muscle: {
    color: REAL.muscle,
    roughness: 0.55,
    env: 0.45,
    clearcoat: 0.22,
    clearcoatRoughness: 0.42,
    detail: { freq: 14, bump: 0.005, colorVar: 0.22, roughVar: 0.12, deep: REAL.muscleDeep, fibre: { axis: [1, 0.15, 0], stretch: 0.22 } },
    sss: { wrap: 0.45, tint: REAL.wrapTint, color: REAL.sss, strength: 0.2 },
    baked: { saturation: 0.85 },
  },
  diaphragm: {
    color: REAL.diaphragm,
    roughness: 0.55,
    env: 0.45,
    clearcoat: 0.2,
    clearcoatRoughness: 0.42,
    detail: { freq: 12, bump: 0.004, colorVar: 0.2, roughVar: 0.12, deep: REAL.muscleDeep },
    sss: { wrap: 0.45, tint: REAL.wrapTint, color: REAL.sss, strength: 0.2 },
    baked: { saturation: 0.8 },
  },
  lung: {
    color: REAL.lung,
    roughness: 0.62,
    env: 0.4,
    detail: { freq: 34, bump: 0.01, colorVar: 0.32, roughVar: 0.1, deep: REAL.lungDeep },
    rim: { color: '#F2C7C2', strength: 0.35 },
    transparent: { opacity: 0.42 },
    baked: {},
  },
  airway: {
    color: REAL.airway,
    roughness: 0.5,
    env: 0.45,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    detail: { freq: 24, bump: 0.003, colorVar: 0.12, roughVar: 0.1, deep: '#A8927E' },
    baked: {},
  },
  oesophagus: {
    color: REAL.muscle,
    roughness: 0.55,
    env: 0.4,
    clearcoat: 0.2,
    clearcoatRoughness: 0.42,
    detail: { freq: 14, bump: 0.004, colorVar: 0.18, roughVar: 0.12, deep: REAL.muscleDeep },
    baked: { saturation: 0.8 },
  },
};

const TIER_OCTAVES: Record<QualityTier, number> = { A: 3, B: 2, C: 1, D: 1 };

function lookFor(kind: TissueKind, look: SceneLookId): Look {
  const table = look === 'realistic' ? REALISTIC : CLINICAL;
  return table[kind] ?? CLINICAL[kind] ?? { color: ANATOMY.greatVessel, roughness: 0.5, env: LIGHTS.envMapIntensity };
}

/** Creates the fresh territory / clip uniform sets for one scene. */
export function createSharedUniforms(lut: Texture | null): SharedUniforms {
  return {
    territory: {
      uP: { value: new Vector3() },
      uRiskLUT: { value: lut },
      uTerritoryOn: { value: 0 },
      uSelMask: { value: new Vector3(1, 1, 1) },
      uTerritoryGain: { value: 0.25 },
    },
    clip: {
      uClipCentre: { value: new Vector3() },
      uClipRadius: { value: 100 },
      uClipFeather: { value: 0.15 },
    },
    clipGreat: {
      uClipCentre: { value: new Vector3() },
      uClipRadius: { value: 100 },
      uClipFeather: { value: 0.4 },
    },
  };
}

/**
 * The solid material of one mesh in one look. `kind` decides the parameters; the flags decide the shader
 * variant. Vessel colour / emission are driven per frame by useRiskAnimation.
 */
export function createTissueMaterial(o: TissueOptions): TissueMaterial {
  const L = lookFor(o.kind, o.look);
  const realistic = o.look === 'realistic';
  // Tiers A/B: MeshPhysical (soft wet clearcoat, sheen at A). Tier C: MeshStandard over the baked maps — no
  // clearcoat, no procedural noise on textured meshes — so a machine without a dedicated GPU keeps its
  // frame rate (the bake already carries the detail).
  const physical = realistic && (o.tier === 'A' || o.tier === 'B');
  const maps = realistic ? o.maps ?? null : null;
  const baked = !!maps?.map;
  const params = {
    // A baked albedo IS the colour: multiply it by a light tint, never by the dark procedural base.
    color: baked ? L.baked?.tint ?? '#FFFFFF' : L.color,
    // The baked ORM map drives roughness (three multiplies its green channel by this factor).
    roughness: maps?.roughnessMap ? 1 : L.roughness,
    metalness: L.metalness ?? 0,
    envMapIntensity: L.env,
    side: L.interior || o.kind === 'myocardium' ? DoubleSide : FrontSide,
    // Clip-sphere vessels fade out with alpha at their trimmed ends (they keep writing depth).
    transparent: !!L.transparent || !!clipOf(o.kind, o.shared),
    opacity: L.transparent?.opacity ?? 1,
    depthWrite: !L.transparent,
  };
  const material = (
    physical
      ? new MeshPhysicalMaterial({
          ...params,
          clearcoat: L.clearcoat ?? 0,
          clearcoatRoughness: L.clearcoatRoughness ?? 0.2,
          sheen: o.tier === 'A' ? L.sheen ?? 0 : 0,
          sheenColor: new Color(L.sheenColor ?? '#000000'),
          sheenRoughness: L.sheenRoughness ?? 0.5,
        })
      : new MeshStandardMaterial(params)
  ) as TissueMaterial;
  if (maps?.map) material.map = maps.map;
  if (maps?.normalMap) material.normalMap = maps.normalMap;
  if (maps?.roughnessMap) material.roughnessMap = maps.roughnessMap;
  if (maps?.aoMap) material.aoMap = maps.aoMap;
  if (o.clippingPlanes) material.clippingPlanes = o.clippingPlanes;
  if (L.polygonOffset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  const saturation = baked ? L.baked?.saturation ?? 1 : 1;

  const flags: PatchFlags = {
    ...NO_PATCH,
    detail: !!L.detail && o.tier !== 'D' && (o.tier !== 'C' || !baked),
    fibre: !!L.detail?.fibre,
    fat: !!L.fat && !!L.detail && !maps?.map,
    sss: !!L.sss,
    interior: !!L.interior,
    territory: o.kind === 'myocardium' ? o.territoryAttribute ?? null : null,
    rim: !!L.rim,
    clipSphere: !!clipOf(o.kind, o.shared),
    desaturateMap: saturation < 0.995,
    cavity: !!o.cavity,
    octaves: TIER_OCTAVES[o.tier],
  };

  const uniforms: TissueUniforms = {
    ...BEAT_UNIFORMS,
    ...FRAME_UNIFORMS,
    uRestOffset: { value: o.restOffset.clone() },
    uBeatMode: { value: o.beatMode },
    uReveal: { value: 1 },
    uInflate: { value: o.inflate ?? 0 },
    // The materialise front samples the shared noise volume on every material (shaders.ts MATERIALISE).
    uNoise3D: { value: getNoiseTexture() },
  };
  if (L.detail) {
    const fibre = L.detail.fibre;
    Object.assign(uniforms, {
      uDetailFreq: { value: L.detail.freq },
      uBump: { value: L.detail.bump * (maps?.normalMap ? 0.35 : 1) },
      uColorVar: { value: L.detail.colorVar * (maps?.map ? 0.4 : 1) },
      uRoughVar: { value: L.detail.roughVar },
      uTintDeep: { value: new Color(L.detail.deep) },
      uFibreAxis: { value: fibre ? (fibre.axis === 'heart' ? BEAT_UNIFORMS.uHeartAxis.value : new Vector3(...fibre.axis).normalize()) : new Vector3(0, 1, 0) },
      uFibreStretch: { value: fibre?.stretch ?? 1 },
    });
  }
  if (flags.fat) Object.assign(uniforms, { uFatColor: { value: new Color(REAL.fat) }, uFatAmount: { value: L.fat } });
  if (L.sss) {
    Object.assign(uniforms, {
      uWrap: { value: L.sss.wrap },
      uWrapTint: { value: new Color(L.sss.tint) },
      uSssColor: { value: new Color(L.sss.color) },
      uSssStrength: { value: L.sss.strength },
    });
  }
  if (L.interior) uniforms.uInteriorColor = { value: new Color(L.interior) };
  if (L.rim) Object.assign(uniforms, { uRimColor: { value: new Color(L.rim.color) }, uRimStrength: { value: L.rim.strength } });
  if (flags.territory) Object.assign(uniforms, o.shared.territory);
  if (flags.clipSphere) Object.assign(uniforms, clipOf(o.kind, o.shared));
  if (flags.desaturateMap) uniforms.uSaturation = { value: saturation };
  if (flags.cavity) {
    Object.assign(uniforms, {
      uCavityAO: { value: realistic ? 0.55 : 0.4 },
      uGrooveAO: { value: realistic ? 0.5 : 0.3 },
      uVesselFat: { value: realistic ? 0.32 : 0 },
    });
    if (!flags.fat) Object.assign(uniforms, { uFatColor: { value: new Color(REAL.fat) } });
  }

  material.userData.ct = { uniforms, kind: o.kind, look: o.look, flags, floorScale: realistic ? 0.45 : 1 };
  const inflate = (o.inflate ?? 0) > 0;
  material.onBeforeCompile = (shader) => {
    patchTissueShader(shader, uniforms, flags);
    if (inflate) {
      // Coronaries lie in their grooves under the epicardial fat: pull their DEPTH (not their screen
      // position) toward the camera so the risk-coloured artery reads through the thin fat over it, while
      // the heart wall itself still hides the far side.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uInflate;\nconst float CT_DEPTH_PULL = ${VESSEL_DEPTH_PULL.toFixed(4)};`)
        .replace('vCtRest = transformed + uRestOffset;', 'transformed += normalize(objectNormal) * uInflate;\nvCtRest = transformed + uRestOffset;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
{
  vec4 ctPulled = projectionMatrix * vec4(mvPosition.xy, mvPosition.z + CT_DEPTH_PULL, 1.0);
  gl_Position.z = ctPulled.z / ctPulled.w * gl_Position.w;
}`,
        );
    }
  };
  const key = `ct-tissue-${physical ? 'P' : 'S'}-${patchKey(flags)}-${inflate ? 'inf' : ''}`;
  material.customProgramCacheKey = () => key;
  return material;
}

// ------------------------------------------------------------------------------------------ ghosts

export interface GhostUniforms extends Record<string, IUniform> {
  uBase: IUniform<number>;
  uRim: IUniform<number>;
  uPower: IUniform<number>;
  uFade: IUniform<number>;
  uNearFade: IUniform<number>;
  uRestOffset: IUniform<Vector3>;
}

export type GhostMaterial = MeshBasicMaterial & { userData: { ct: { uniforms: GhostUniforms; ghost: true } } };

/** Ghost opacity curves per kind (LUMEN §7.3): α = (base + rim·F^power) · fade. */
const GHOST_CURVES: Partial<Record<TissueKind, [number, number, number]>> = {
  cardiacVein: [0.14, 0.3, 1.5],
  skin: [0.02, 0.2, 3],
  lung: [0.02, 0.2, 2.5],
  airway: [0.02, 0.16, 2.5],
  bone: [0.01, 0.14, 2],
  cartilage: [0.01, 0.12, 2],
  muscle: [0, 0.12, 2],
  diaphragm: [0.02, 0.1, 2],
};

function ghostTint(kind: TissueKind, look: SceneLookId): string {
  const g = GHOST[look];
  switch (kind) {
    case 'skin':
      return g.skin;
    case 'lung':
    case 'airway':
      return g.lung;
    case 'bone':
    case 'cartilage':
      return g.bone;
    case 'muscle':
      return g.muscle;
    case 'diaphragm':
      return g.diaphragm;
    case 'coronary':
    case 'leftMain':
      return g.vessel;
    case 'cardiacVein':
      return g.vein;
    default:
      return g.heart;
  }
}

/**
 * Additive fresnel ghost: reads like an X-ray contour (Clinical) or a glassy tissue silhouette (Realistic).
 * No depth write, no environment. Fades out right in front of the lens (exploded skin swings through the
 * camera) and honours the pulmonary sphere clip so a ghosted tree is still trimmed.
 */
export function createGhostMaterial(kind: TissueKind, look: SceneLookId, restOffset: Vector3, shared: SharedUniforms | null): GhostMaterial {
  const [base, rim, power] = GHOST_CURVES[kind] ?? [0.015, 0.16, 2];
  const clipSet = shared ? clipOf(kind, shared) : null;
  const clip = !!clipSet;
  const uniforms: GhostUniforms = {
    uBase: { value: base },
    uRim: { value: rim },
    uPower: { value: power },
    uFade: { value: 1 },
    uNearFade: { value: 0.9 },
    uRestOffset: { value: restOffset.clone() },
    ...(clipSet ?? {}),
  };
  const material = new MeshBasicMaterial({
    color: ghostTint(kind, look),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }) as GhostMaterial;
  material.userData.ct = { uniforms, ghost: true };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRestOffset;\nvarying vec3 vCtNormal;\nvarying vec3 vCtView;\nvarying vec3 vCtRest;\nvarying float vCtDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCtRest = transformed + uRestOffset;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCtNormal = normalize(normalMatrix * normal);
        vCtView = normalize(-mvPosition.xyz);
        vCtDepth = -mvPosition.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBase;
uniform float uRim;
uniform float uPower;
uniform float uFade;
uniform float uNearFade;
varying vec3 vCtNormal;
varying vec3 vCtView;
varying vec3 vCtRest;
varying float vCtDepth;
${IGN}
${clip ? 'uniform vec3 uClipCentre;\nuniform float uClipRadius;\nuniform float uClipFeather;' : ''}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float ctF = pow(1.0 - abs(dot(normalize(vCtNormal), normalize(vCtView))), uPower);
        diffuseColor.a = (uBase + uRim * ctF) * uFade * smoothstep(uNearFade * 0.35, uNearFade, vCtDepth);
        ${clip ? 'diffuseColor.a *= 1.0 - smoothstep(uClipRadius - uClipFeather, uClipRadius, distance(vCtRest, uClipCentre));' : ''}
        if (diffuseColor.a < 0.002) discard;
        #include <opaque_fragment>`,
      );
  };
  const key = `ct-ghost-${clip ? 'c' : ''}`;
  material.customProgramCacheKey = () => key;
  return material;
}

/** Recolour a ghost for a look without recompiling. */
export function setGhostLook(material: GhostMaterial, kind: TissueKind, look: SceneLookId): void {
  material.color.set(ghostTint(kind, look));
}

export const isGhost = (m: Material): m is GhostMaterial => !!(m.userData as { ct?: { ghost?: boolean } }).ct?.ghost;
