import { DataTexture, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { TissueKind } from './classify';
import { REAL } from './palette';
import { createSharedUniforms, createTissueMaterial, type BakedMaps, type QualityTier, type SceneLookId } from './tissue';

const tex = () => new DataTexture(new Uint8Array(4), 1, 1);
const baked = (): BakedMaps => {
  const orm = tex();
  return { map: tex(), normalMap: tex(), roughnessMap: orm, aoMap: orm };
};

function make(kind: TissueKind, maps: BakedMaps | null, look: SceneLookId = 'realistic', tier: QualityTier = 'B') {
  return createTissueMaterial({ kind, look, tier, restOffset: new Vector3(), beatMode: 0, shared: createSharedUniforms(null), maps });
}

describe('tissue materials (Realistic look)', () => {
  it('lets a baked albedo carry the colour: a light maroon multiplier, roughness from the ORM map', () => {
    const m = make('myocardium', baked()) as MeshPhysicalMaterial;
    // The bake is pulled from tomato red toward maroon-brown (a light, red-leaning multiplier, never the dark
    // procedural base colour multiplied into it again).
    expect(m.color.r).toBeGreaterThan(0.75);
    expect(m.color.r).toBeGreaterThan(m.color.g);
    expect(m.color.g).toBeGreaterThan(0.65);
    expect(m.roughness).toBe(1);
    expect(m.metalness).toBe(0);
    expect(m.userData.ct.uniforms.uSaturation?.value ?? 1).toBeGreaterThan(0.6);
  });

  it('keeps the myocardium a soft wet sheen, never lacquer (no white clearcoat streaks)', () => {
    const m = make('myocardium', baked()) as MeshPhysicalMaterial;
    expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.clearcoat).toBeLessThanOrEqual(0.12);
    expect(m.clearcoatRoughness).toBeGreaterThanOrEqual(0.55);
    expect(m.sheen).toBeGreaterThan(0.2);
    expect(m.envMapIntensity).toBeLessThanOrEqual(0.55);
  });

  it('uses the procedural base colour until the bake is uploaded', () => {
    const m = make('myocardium', null);
    expect(`#${m.color.getHexString()}`.toUpperCase()).toBe(REAL.myocardium.toUpperCase());
  });

  it('shades epicardial fat as fat (no territory; its thin edges recede into the wall, never drawn over it)', () => {
    const m = make('fat', baked());
    expect(m.userData.ct.flags.territory).toBeNull();
    // Never pulled toward the camera (its thin edges drew dark hairlines over the wall): its depth recedes,
    // so where fat and wall nearly coincide the wall wins.
    expect(m.polygonOffset).toBe(false);
    expect(m.customProgramCacheKey()).toMatch(/rec/);
    // The ochre bake is greyed toward cream, never shown as the dark myocardium colour.
    expect(m.color.getHexString()).not.toBe(REAL.myocardium.slice(1).toLowerCase());
  });

  it('greys the great vessels and veins so the coronary ramp stays the most saturated thing (V2 §5.15)', () => {
    for (const kind of ['aorta', 'pulmonaryArtery', 'systemicVein', 'cardiacVein'] as const) {
      const m = make(kind, baked());
      expect(m.userData.ct.flags.desaturateMap).toBe(true);
      expect(m.userData.ct.uniforms.uSaturation!.value).toBeLessThanOrEqual(0.4);
    }
  });

  it('drops to a standard material without clearcoat or noise on textured meshes at tier C', () => {
    const m = make('myocardium', baked(), 'realistic', 'C');
    expect(m).toBeInstanceOf(MeshStandardMaterial);
    expect(m).not.toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.userData.ct.flags.detail).toBe(false);
  });
});
