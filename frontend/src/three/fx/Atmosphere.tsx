import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import type { RenderTier } from '@/state/viewerStore';
import { ANATOMY, UI } from '@/theme/tokens';
import { mulberry32 } from './particles';
import { isAttached } from './sceneNodes';

/**
 * Atmosphere (DESIGN_SYSTEM §7.1 stage, kept deliberately faint — "the only light in the room is the
 * data"):
 *
 * - BACKLIGHT: a camera-facing radial glow parked behind the heart in the cool rim-light hue
 *   (`#8CB8FF`), lifting the LUMEN backdrop gradient just enough to separate the silhouette in depth.
 *   One quad, depth-tested, additive, dithered (interleaved gradient noise) so it never bands.
 * - DUST: a few hundred sub-pixel-to-2 px motes drifting in the air around the heart, depth-faded,
 *   faded near the camera and at the volume edges, at 3–12 % opacity. One Points draw call, all motion
 *   in the vertex shader. Tiers A/B only; hidden under reduced motion.
 *
 * Neither reads or encodes risk; both are achromatic-cool so they can never be confused with Ember.
 */

/** Peak additive radiance of the backlight (linear; ≈ +6 sRGB levels on the #11161C backdrop). */
export const BACKLIGHT_PEAK = 0.006;
export const DUST_COUNT = { A: 320, B: 200 } as const;
/** Half-extents of the dust volume around the heart (scene units). */
const DUST_BOX = new Vector3(2.4, 1.9, 1.8);

const backlightVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backlightFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPeak;
  varying vec2 vUv;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = exp(-3.2 * r * r) * (1.0 - smoothstep(0.85, 1.0, r));
    vec3 col = uColor * (uPeak * glow);
    col += (ign(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0) * glow; // dither: no banding in the dark
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3 uCentre;
  uniform vec3 uBox;
  attribute vec4 aSeed; // phase, speed, size, brightness
  varying float vAlpha;
  void main() {
    // slow rise with a gentle Lissajous sway, wrapped inside the box
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.012 + 0.02 * aSeed.y) + uBox.y, 2.0 * uBox.y) - uBox.y;
    p.x += 0.05 * sin(uTime * (0.11 + 0.07 * aSeed.y) + aSeed.x * 6.2831);
    p.z += 0.05 * cos(uTime * (0.09 + 0.05 * aSeed.y) + aSeed.x * 4.1);
    vec4 mv = modelViewMatrix * vec4(p + uCentre, 1.0);
    float dist = -mv.z;
    float edge = (1.0 - smoothstep(0.75, 1.0, abs(p.y) / uBox.y)) * (1.0 - smoothstep(0.8, 1.0, length(p.xz / uBox.xz)));
    float near = smoothstep(1.2, 2.6, dist); // never a big blob in front of the lens
    float far = 1.0 - smoothstep(7.0, 12.0, dist);
    vAlpha = uOpacity * (0.03 + 0.09 * aSeed.w) * edge * near * far;
    gl_PointSize = (0.8 + 1.4 * aSeed.z) * uPixelRatio * clamp(4.0 / dist, 0.6, 1.6);
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = vAlpha * (1.0 - smoothstep(0.15, 0.5, length(d)));
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function useHeartCentre(): () => Vector3 {
  const scene = useThree((s) => s.scene);
  const node = useRef<Object3D | null>(null);
  const centre = useMemo(() => new Vector3(), []);
  const countdown = useRef(0);
  return () => {
    if (!node.current || !isAttached(node.current, scene)) {
      node.current = null;
      if (countdown.current-- <= 0) {
        node.current = scene.getObjectByName('Layer_Heart') ?? scene.getObjectByName('Layer_Heart_Procedural') ?? null;
        countdown.current = 60;
      }
    }
    if (node.current) node.current.getWorldPosition(centre);
    else centre.set(0, 0, 0);
    return centre;
  };
}

export function Atmosphere({ tier }: { tier: RenderTier }) {
  const reduced = useReducedMotion();
  const camera = useThree((s) => s.camera);
  const heartCentre = useHeartCentre();
  const dustCount = tier === 'A' ? DUST_COUNT.A : tier === 'B' ? DUST_COUNT.B : 0;
  const showDust = dustCount > 0 && !reduced;

  const backlight = useMemo(() => {
    const material = new ShaderMaterial({
      vertexShader: backlightVertex,
      fragmentShader: backlightFragment,
      uniforms: { uColor: { value: new Color(ANATOMY.fresnelRim) }, uPeak: { value: BACKLIGHT_PEAK } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(new PlaneGeometry(4.6, 4.6), material);
    mesh.name = 'FX_Backlight';
    mesh.renderOrder = -0.5;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.userData.ctFx = true;
    return mesh;
  }, []);

  const dust = useMemo(() => {
    const random = mulberry32(0xd057);
    const n = DUST_COUNT.A;
    const positions: number[] = [];
    const seeds: number[] = [];
    for (let i = 0; i < n; i += 1) {
      positions.push((random() * 2 - 1) * DUST_BOX.x, (random() * 2 - 1) * DUST_BOX.y, (random() * 2 - 1) * DUST_BOX.z);
      seeds.push(random(), random(), random() ** 2, random() ** 1.5);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 4));
    const material = new ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 0 },
        uCentre: { value: new Vector3() },
        uBox: { value: DUST_BOX.clone() },
        uColor: { value: new Color(UI.textSecondary) }, // a cool neutral token, never a risk hue
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.name = 'FX_Dust';
    points.frustumCulled = false;
    points.raycast = () => {};
    points.userData.ctFx = true;
    return points;
  }, []);

  useEffect(
    () => () => {
      backlight.geometry.dispose();
      (backlight.material as ShaderMaterial).dispose();
      dust.geometry.dispose();
      (dust.material as ShaderMaterial).dispose();
    },
    [backlight, dust],
  );

  useEffect(() => {
    dust.geometry.setDrawRange(0, dustCount);
  }, [dust, dustCount]);

  const time = useRef(0);
  const back = useMemo(() => new Vector3(), []);
  useFrame((state, delta) => {
    const centre = heartCentre();
    // Park the glow 1.4 units behind the heart along the view ray, facing the camera.
    back.copy(centre).sub(camera.position).normalize().multiplyScalar(1.4).add(centre);
    backlight.position.copy(back);
    backlight.quaternion.copy(camera.quaternion);

    const u = (dust.material as ShaderMaterial).uniforms;
    time.current += Math.min(delta, 0.1);
    u.uTime!.value = time.current;
    u.uPixelRatio!.value = state.gl.getPixelRatio();
    (u.uCentre!.value as Vector3).copy(centre);
    const goal = showDust ? 1 : 0;
    u.uOpacity!.value += (goal - (u.uOpacity!.value as number)) * Math.min(1, delta * 3);
    dust.visible = (u.uOpacity!.value as number) > 0.002;
  });

  return (
    <>
      <primitive object={backlight} />
      <primitive object={dust} />
    </>
  );
}
