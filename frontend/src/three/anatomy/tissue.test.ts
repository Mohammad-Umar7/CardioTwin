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
  it('lets a baked albedo carry the colour: white factor, roughness from the ORM map, no desaturation', () => {
    const m = make('myocardium', baked()) as MeshPhysicalMaterial;
    expect(m.color.getHexString()).toBe('ffffff');
    expect(m.roughness).toBe(1);
    expect(m.metalness).toBe(0);
    expect(m.userData.ct.uniforms.uSaturation?.value ?? 1).toBeGreaterThan(0.9);
  });

  it('keeps the myocardium a soft wet sheen, never lacquer', () => {
    const m = make('myocardium', baked()) as MeshPhysicalMaterial;
    expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.clearcoat).toBeLessThanOrEqual(0.3);
    expect(m.clearcoatRoughness).toBeGreaterThanOrEqual(0.35);
    expect(m.envMapIntensity).toBeLessThanOrEqual(0.55);
  });

  it('uses the procedural base colour until the bake is uploaded', () => {
    const m = make('myocardium', null);
    expect(`#${m.color.getHexString()}`.toUpperCase()).toBe(REAL.myocardium.toUpperCase());
  });

  it('shades epicardial fat as fat (no territory, biased over the wall it covers)', () => {
    const m = make('fat', baked());
    expect(m.userData.ct.flags.territory).toBeNull();
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBeLessThan(0);
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
