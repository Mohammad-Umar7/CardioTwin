import { useMemo } from 'react';
import { Color, ShaderMaterial, Vector2 } from 'three';
import { ANATOMY } from '@/theme/tokens';
import { heroRuntime } from './heroIntro';
import { sceneRuntime } from './sceneRuntime';

const tmp = new Vector2();

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Radial gradient centred at 50 % width / 40 % from the top, dithered ±1/255 with interleaved gradient
// noise (a low-discrepancy pattern computed in the shader: no texture, no banding).
// LUMEN 2 adds light, never colour on anatomy: a soft cool halo behind the heart, two faint light leaks from
// opposite corners and a low horizon glow under it, all in linear light below the anatomy (renderOrder −1).
// On the landing hero the light centre follows the torso into the free area beside the copy (`uShift`, a share of
// the width; 0 everywhere else) and the coloured light is turned down (`uGlow`, 1 everywhere else).
const fragment = /* glsl */ `
  uniform vec3 uCentre;
  uniform vec3 uEdge;
  uniform vec3 uGlowA;
  uniform vec3 uGlowB;
  uniform vec2 uResolution;
  uniform float uBeat;
  uniform float uShift;
  uniform float uGlow;
  varying vec2 vUv;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float blob(vec2 p, float k) { return exp(-dot(p, p) * k); }
  void main() {
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 d = (vUv - vec2(0.5 + uShift, 0.6)) * aspect;
    float t = smoothstep(0.0, 0.95, length(d) * 1.15);
    vec3 col = mix(uCentre, uEdge, t);
    // The halo breathes with the ventricles (uBeat = enveloped activation, 0 when the beat is off or calm).
    col += uGlowA * blob(d - vec2(0.0, -0.04), 3.4) * (0.026 + 0.016 * uBeat) * uGlow;
    col += uGlowB * blob((vUv - vec2(1.02, 1.04)) * aspect, 2.4) * 0.05 * uGlow;
    col += uGlowA * blob((vUv - vec2(-0.04, -0.06)) * aspect, 2.8) * 0.03 * uGlow;
    float horizon = exp(-pow((vUv.y - 0.1) * 7.0, 2.0)) * exp(-pow(d.x * 1.5, 2.0));
    col += uGlowA * horizon * 0.018 * uGlow;
    col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Stage background (DESIGN_SYSTEM §7.1): a full-screen quad drawn first (renderOrder −1, no depth
 * write). No floor, grid or HDRI.
 */
export function Background() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        uniforms: {
          uCentre: { value: new Color(ANATOMY.sceneBgCentre) },
          uEdge: { value: new Color(ANATOMY.sceneBgEdge) },
          uGlowA: { value: new Color(ANATOMY.sceneGlowCool) },
          uGlowB: { value: new Color(ANATOMY.sceneGlowIndigo) },
          uResolution: { value: [1, 1] },
          uBeat: { value: 0 },
          uShift: { value: 0 },
          uGlow: { value: 1 },
        },
      }),
    [],
  );
  return (
    <mesh
      renderOrder={-1}
      frustumCulled={false}
      material={material}
      raycast={() => null}
      onBeforeRender={(gl) => {
        const size = gl.getDrawingBufferSize(tmp);
        (material.uniforms.uResolution!.value as number[])[0] = size.x;
        (material.uniforms.uResolution!.value as number[])[1] = size.y;
        material.uniforms.uBeat!.value = Math.min(1, Math.max(0, sceneRuntime.beat.v));
        material.uniforms.uShift!.value = heroRuntime.backdropShift;
        material.uniforms.uGlow!.value = heroRuntime.backdropGlow;
      }}
    >
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
