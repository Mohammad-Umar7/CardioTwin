import { DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_NODES, MAX_TARGET_SLOTS } from './fxState';
import { QUAD_SCALE, createFlowMaterial } from './flowMaterial';
import { createOverlayMaterial, createOverlayShared } from './overlayMaterial';

const lut = new DataTexture(new Uint8Array(4), 1, 1);

/** Unresolved `${…}` in a GLSL template would compile-fail only on the GPU; catch it here. */
const noTemplateLeftovers = (glsl: string) => expect(glsl).not.toMatch(/\$\{|\}'/);

describe('flow particle material', () => {
  const material = createFlowMaterial(lut, 0.005);

  it('sizes its uniform arrays to the node and slot tables', () => {
    expect(material.uniforms.uNode.value).toHaveLength(MAX_NODES);
    expect(material.uniforms.uNodeAlpha.value).toHaveLength(MAX_NODES);
    expect(material.uniforms.uFlowDist.value).toHaveLength(MAX_TARGET_SLOTS);
    expect(material.uniforms.uDensity.value).toHaveLength(MAX_TARGET_SLOTS);
  });

  it('shares the anatomy beat uniforms and clips with the section planes', () => {
    expect(material.uniforms.uBeatMatrix).toBeDefined();
    expect(material.uniforms.uBeatMode.value).toBe(1);
    expect(material.clipping).toBe(true);
    expect(material.vertexShader).toContain('ctBeat(');
    expect(material.vertexShader).toContain('clipping_planes_pars_vertex');
    expect(material.fragmentShader).toContain('clipping_planes_fragment');
  });

  it('addresses the centreline texture by texel and undoes the stored quad scale', () => {
    expect(material.vertexShader).toContain('texelFetch(uCentre');
    expect(material.vertexShader).toContain(`position.xy * ${(1 / QUAD_SCALE).toFixed(1)}`);
    noTemplateLeftovers(material.vertexShader);
    noTemplateLeftovers(material.fragmentShader);
  });

  it('never writes depth (light over the anatomy, occluded by it)', () => {
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.transparent).toBe(true);
  });
});

describe('vessel overlay material', () => {
  it('reads the arc-length attribute under the name the geometry uses', () => {
    const shared = createOverlayShared(lut, 0.005);
    const glb = createOverlayMaterial(shared, '_arclen', 1);
    const procedural = createOverlayMaterial(shared, '_ARCLEN', 0);
    expect(glb.vertexShader).toContain('attribute float _arclen;');
    expect(procedural.vertexShader).toContain('attribute float _ARCLEN;');
    expect(glb.uniforms.uBeatMode.value).toBe(1);
    expect(procedural.uniforms.uBeatMode.value).toBe(0);
    noTemplateLeftovers(glb.vertexShader);
    noTemplateLeftovers(glb.fragmentShader);
  });

  it('shares the per-frame uniforms between every vessel and keeps its own risk state', () => {
    const shared = createOverlayShared(lut, 0.005);
    const a = createOverlayMaterial(shared, '_arclen');
    const b = createOverlayMaterial(shared, '_arclen');
    shared.uPulseFront.value = 0.4;
    expect(a.uniforms.uPulseFront.value).toBe(0.4);
    expect(b.uniforms.uPulseFront.value).toBe(0.4);
    a.uniforms.uP.value = 0.9;
    expect(b.uniforms.uP.value).toBe(0);
    expect(a.uniforms.uInflate.value).toBeGreaterThan(0.005);
  });
});
