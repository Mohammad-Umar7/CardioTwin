/**
 * Additive light overlay drawn on top of a coronary mesh (sharing its geometry, never touching its
 * material). One shader, three effects, all addressed by the mesh's `_ARCLEN` attribute (0 at the tree's
 * ostium → 1 at its most distal tip):
 *
 * - PULSE: once per beat a luminous wavefront runs root → tip with the diastolic inflow surge (sharp
 *   leading edge, exponential tail), in the vessel's own ramp hue so every frame stays on the legend.
 * - IGNITION: when a new case's estimate lands, a bright `vessel/trace` band sweeps ostia → tips and
 *   leaves a short afterglow that settles to nothing (DESIGN_SYSTEM §6 draw-in / ignition, as light).
 * - DASHES (tier C only, where particles are off): `fract(arc·L/period − phase)` dashes moving at the
 *   integrated flow speed, including the diastolic surge (§7.7 "flow becomes an arc-length dash shader").
 *
 * The overlay is inflated a hair beyond the vessel's own display inflation and depth-tested without
 * writing depth, so it can only ever brighten the vessel it belongs to.
 */
import { AdditiveBlending, Color, ShaderMaterial, Vector3, type Texture } from 'three';
import { BEAT_MODE, BEAT_UNIFORMS, BEAT_VERTEX, BEAT_VERTEX_PARS } from '../anatomy/beatDeform';
import { FLOW_WHITE, TRACE } from './fxState';

/** Extra outward offset over the vessel's display inflation (scene units ≈ 0.12 mm). */
export const OVERLAY_EPSILON = 0.0012;
/** Tier-C bead period along the vessel (scene units; 9 mm). */
export const DASH_PERIOD = 0.09;

export interface OverlayShared {
  [name: string]: { value: unknown };
  uRiskLUT: { value: Texture };
  uTrace: { value: Color };
  uFlowWhite: { value: Color };
  uPulseFront: { value: number };
  uPulseAmp: { value: number };
  uIgnite: { value: number };
  uIgniteAmp: { value: number };
  uDashAmp: { value: number };
  uInflate: { value: number };
}

export interface OverlayOwn {
  [name: string]: { value: unknown };
  uP: { value: number };
  uAvail: { value: number };
  uDim: { value: number };
  uTintMix: { value: number };
  uDensity: { value: number };
  uTreeLength: { value: number };
  uDashPhase: { value: number };
  uRestOffset: { value: Vector3 };
  uBeatMode: { value: number };
  /** The anatomy's solid factor for this node (isolate / ghost / assembly), 0..1. */
  uSolid: { value: number };
}

export type OverlayMaterial = ShaderMaterial & { uniforms: OverlayShared & OverlayOwn };

export function createOverlayShared(riskLut: Texture, inflate: number): OverlayShared {
  return {
    uRiskLUT: { value: riskLut },
    uTrace: { value: new Color().setRGB(...TRACE) },
    uFlowWhite: { value: new Color().setRGB(...FLOW_WHITE) },
    uPulseFront: { value: -1 },
    uPulseAmp: { value: 0 },
    uIgnite: { value: 0 },
    uIgniteAmp: { value: 0 },
    uDashAmp: { value: 0 },
    uInflate: { value: inflate + OVERLAY_EPSILON },
  };
}

/**
 * `arclenAttribute` is the geometry's attribute name: GLTFLoader lower-cases custom glTF attributes
 * (`_arclen`), the procedural heart sets `_ARCLEN` itself.
 */
export function createOverlayMaterial(shared: OverlayShared, arclenAttribute: string, beatMode: number = BEAT_MODE.none): OverlayMaterial {
  const own: OverlayOwn = {
    uP: { value: 0 },
    uAvail: { value: 0 },
    uDim: { value: 0 },
    uTintMix: { value: 0 },
    uDensity: { value: 1 },
    uTreeLength: { value: 1 },
    uDashPhase: { value: 0 },
    uRestOffset: { value: new Vector3() },
    uBeatMode: { value: beatMode },
    uSolid: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms: { ...shared, ...own, ...BEAT_UNIFORMS },
    vertexShader: /* glsl */ `
      attribute float ${arclenAttribute};
      uniform float uInflate;
      varying float vArc;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      ${BEAT_VERTEX_PARS}
      #include <clipping_planes_pars_vertex>
      void main() {
        vec3 transformed = position;
        ${BEAT_VERTEX}
        transformed += normalize(normal) * uInflate;
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vec4 mvPosition = mv;
        #include <clipping_planes_vertex>
        vArc = ${arclenAttribute};
        vNormalV = normalize(normalMatrix * normal);
        vViewV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRiskLUT;
      uniform vec3 uTrace;
      uniform vec3 uFlowWhite;
      uniform float uPulseFront;
      uniform float uPulseAmp;
      uniform float uIgnite;
      uniform float uIgniteAmp;
      uniform float uDashAmp;
      uniform float uP;
      uniform float uAvail;
      uniform float uDim;
      uniform float uTintMix;
      uniform float uDensity;
      uniform float uTreeLength;
      uniform float uDashPhase;
      uniform float uSolid;
      varying float vArc;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float facing = clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0);
        float core = 0.3 + 0.7 * facing; // light "inside" the tube: brightest along its axis
        vec3 ramp = texture2D(uRiskLUT, vec2(clamp(uP, 0.0, 1.0), 0.5)).rgb;
        vec3 hue = mix(uTrace, ramp, uAvail); // no estimate → neutral light, never an invented colour
        vec3 col = vec3(0.0);

        // Pulse: sharp leading edge, exponential wake, fading distally.
        if (uPulseAmp > 0.0) {
          float x = uPulseFront - vArc;
          // a bright crest AT the front (it must survive Neutral tone mapping on an already lit vessel and
          // reach the bloom threshold) plus a softer wake behind it
          float crest = exp(-(x * x) / (0.035 * 0.035));
          float wake = x > 0.0 ? exp(-x / 0.14) : 0.0;
          float band = 1.3 * crest + 0.4 * wake;
          col += mix(hue, vec3(1.0), 0.4) * (uPulseAmp * band * (1.0 - 0.4 * clamp(vArc, 0.0, 1.0)));
        }

        // Ignition: bright trace band at the front plus a short afterglow behind it.
        if (uIgniteAmp > 0.0) {
          float y = uIgnite - vArc;
          float front = exp(-(y * y) / (0.035 * 0.035));
          float glow = y > 0.0 ? 0.45 * exp(-y / 0.22) : 0.0;
          col += uTrace * (uIgniteAmp * (1.6 * front + glow));
        }

        // Tier-C flow beads, moving distally at the integrated flow speed: short, soft, only along the
        // tube's axis (facing³), so they read as particles rather than stripes.
        if (uDashAmp > 0.0) {
          float u = fract(vArc * uTreeLength / ${DASH_PERIOD.toFixed(4)} - uDashPhase);
          float bead = smoothstep(0.72, 0.9, u) * (1.0 - smoothstep(0.9, 1.0, u));
          col += mix(uFlowWhite, ramp, uTintMix) * (0.7 * uDashAmp * uDensity * bead * facing * facing);
        }

        col *= core * (1.0 - 0.7 * uDim) * uSolid;
        if (dot(col, vec3(1.0)) < 1e-4) discard;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    clipping: true,
  }) as OverlayMaterial;
  return material;
}
