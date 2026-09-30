import { useMemo } from 'react';
import { Color, ShaderMaterial, Vector2 } from 'three';
import { ANATOMY } from '@/theme/tokens';

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
const fragment = /* glsl */ `
  uniform vec3 uCentre;
  uniform vec3 uEdge;
  uniform vec2 uResolution;
  varying vec2 vUv;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 d = (vUv - vec2(0.5, 0.6)) * aspect;
    float t = smoothstep(0.0, 0.95, length(d) * 1.15);
    vec3 col = mix(uCentre, uEdge, t);
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
          uResolution: { value: [1, 1] },
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
      }}
    >
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
