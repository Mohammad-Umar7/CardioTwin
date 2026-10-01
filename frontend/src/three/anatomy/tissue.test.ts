import { DataTexture, MeshPhysicalMaterial, MeshStandardMaterial, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import type { TissueKind } from './classify';
import { REAL } from './palette';
import { createSharedUniforms, createTissueMaterial, type BakedMaps, type QualityTier, type SceneLookId } from './tissue';

const tex = () => new DataTexture(new Uint8Array(4), 1, 1);
const baked = (): BakedMaps => {
  const orm = tex();
  return { map: tex(), normalMap: tex(), roughnessMap: orm, aoMap: orm };
};

function make(kind: TissueKind, maps: BakedMaps | null, look: SceneLookId = 'realistic', tier: QualityTier = 'B', extra = {}) {
  return createTissueMaterial({ kind, look, tier, restOffset: new Vector3(), beatMode: 0, shared: createSharedUniforms(null), maps, ...extra });
}

/** The shader a material compiles to (its onBeforeCompile applied to three's physical shader). */
function compiled(m: MeshStandardMaterial | MeshPhysicalMaterial) {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} };
  m.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, undefined as never);
  return shader;
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

describe('specimen cuts on the great vessels', () => {
  const make = (kind: TissueKind, along: boolean) =>
    createTissueMaterial({ kind, look: 'realistic', tier: 'B', restOffset: new Vector3(), beatMode: 1, shared: createSharedUniforms(null), along });

  it('cuts the descending aorta with a plane and keeps the sphere round the ascending aorta', () => {
    const { flags, uniforms } = make('aorta', true).userData.ct;
    expect(flags.clipAlong).toBe(true);
    expect(flags.clipSphere).toBe(true);
    expect(uniforms.uAlongStart).toBeDefined();
    expect(uniforms.uClipRadius).toBeDefined();
  });

  it('cuts the pulmonary trunk along its wall only (the sphere left its anterior half glassy)', () => {
    const { flags } = make('pulmonaryArtery', true).userData.ct;
    expect(flags.clipAlong).toBe(true);
    expect(flags.clipSphere).toBe(false);
  });

  it('keeps the sphere for a great vessel without an along-the-wall value', () => {
    const { flags } = make('systemicVein', false).userData.ct;
    expect(flags.clipAlong).toBe(false);
    expect(flags.clipSphere).toBe(true);
  });
});

describe('cut great vessels and the fat seam', () => {
  it('shows a cut vessel`s lumen and its wall in section, also in the transparent two-pass draw', () => {
    const m = make('aorta', baked());
    expect(m.userData.ct.flags.cutRim).toBe(true);
    expect(m.userData.ct.uniforms.uCutRim?.value).toBeGreaterThan(0);
    const fs = compiled(m).fragmentShader;
    // three.js draws a transparent double-sided material's back faces in a FLIP_SIDED pass with the front-face
    // winding flipped: the inner side then reports gl_FrontFacing, and must still take the lumen colour.
    expect(fs).toMatch(/#ifdef FLIP_SIDED\s*bool ctInner = gl_FrontFacing;\s*#else\s*bool ctInner = !gl_FrontFacing;/);
    expect(fs).toContain('if (ctInner) diffuseColor.rgb = uInteriorColor');
    expect(fs).toContain('ctCutDist = min(ctCutDist, ctCutAt - ctClipD);');
    expect(make('coronary', baked()).userData.ct.flags.cutRim).toBe(false);
  });

  it('makes a cut vessel`s lumen a dark tunnel beyond its lit rim', () => {
    const fs = compiled(make('systemicVein', baked())).fragmentShader;
    expect(fs).toContain('if (ctInner) {');
    expect(fs).toMatch(/float ctTunnel = mix\(0\.05, 1\.0, exp\(-max\(ctCutDist - uCutRim, 0\.0\)/);
  });

  it('keeps the closed heart`s chambers dark until it opens (one shared uHeartOpen)', () => {
    const shared = createSharedUniforms(null);
    const m = createTissueMaterial({ kind: 'myocardium', look: 'realistic', tier: 'B', restOffset: new Vector3(), beatMode: 0, shared, maps: baked(), enclosure: true });
    expect(m.userData.ct.flags.enclosure).toBe(true);
    expect(m.userData.ct.uniforms.uHeartOpen).toBe(shared.interior.uHeartOpen);
    const { vertexShader, fragmentShader } = compiled(m);
    expect(vertexShader).toContain('attribute float _enclosure;');
    expect(fragmentShader).toContain('float ctShut = smoothstep(0.55, 0.9, vCtEnclosure) * (1.0 - uHeartOpen);');
    expect(make('myocardium', baked()).userData.ct.flags.enclosure).toBe(false);
  });

  it('pulls the fat in along its seam-safe field when the rig computed one', () => {
    const vs = compiled(make('fat', baked(), 'realistic', 'B', { deflateField: true })).vertexShader;
    expect(vs).toContain('attribute vec3 aDeflate;');
    expect(vs).toContain('transformed += aDeflate * uInflate;');
    expect(compiled(make('fat', baked())).vertexShader).toContain('normalize(objectNormal) * uInflate');
  });
});
