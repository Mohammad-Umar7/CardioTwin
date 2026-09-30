/**
 * Hex mirrors of the LUMEN tokens for canvas, SVG and WebGL consumers (DESIGN_SYSTEM.md §2.1, §2.3).
 * DOM styling must use the CSS variables / Tailwind classes instead; these constants exist because
 * three.js materials and exported images cannot read CSS custom properties.
 */

export const UI = {
  bgVoid: '#07090C',
  bgApp: '#0B0E12',
  bgPanel: '#10141A',
  surface1: '#151A21',
  surface2: '#1B212A',
  surface3: '#232A35',
  borderHairline: '#1C222B',
  borderDefault: '#262E39',
  borderStrong: '#36404D',
  textPrimary: '#EDF1F5',
  textSecondary: '#A3ADBA',
  textTertiary: '#8792A1',
  textDisabled: '#4D5663',
  accent: '#56C2E6',
  accentHover: '#7FD3EE',
  accentPressed: '#3E9FC2',
  accentInk: '#07090C',
  success: '#3FB68B',
  warn: '#E3C35A',
  danger: '#FF5F6D',
} as const;

/** 3D palette — anatomy is achromatic by rule; only vessels carry (risk) colour. */
export const ANATOMY = {
  clay: '#62574F',
  clayWrap: '#C98B80',
  flesh: '#6A302C',
  fleshWrap: '#D06A5A',
  cutFace: '#3A2A2A',
  greatVessel: '#6B5E57',
  valvePapillary: '#9A8F86',
  vein: '#4F4542',
  leftMain: '#8A7D76',
  vesselPending: '#4B5260',
  vesselTrace: '#E3DCCF',
  vesselHullRim: '#07090C',
  bone: '#B8B0A3',
  boneGhost: '#9FB4C8',
  lung: '#C7A9A6',
  skin: '#A9B8C8',
  muscle: '#8B5E58',
  diaphragm: '#6B5F5A',
  sceneBgCentre: '#11161C',
  sceneBgEdge: '#06080A',
  flowParticle: '#F2F5F8',
  outlineHover: '#EDF1F5',
  fresnelRim: '#8CB8FF',
  vesselRim: '#E8ECF1',
} as const;

/** Lighting rig (§7.2). Key and fill are parented to the camera. */
export const LIGHTS = {
  hemisphere: { sky: '#DDE7F2', ground: '#2A2220', intensity: 0.6 },
  key: { color: '#FFF1E6', intensity: 2.2, position: [-3, 4, 5] as const },
  rim: { color: '#8CB8FF', intensity: 1.6, position: [2.5, 2, -4] as const },
  fill: { color: '#FFFFFF', intensity: 0.4, position: [4, -1, 3] as const },
  envMapIntensity: 0.35,
} as const;

/** Motion tokens (§6), in milliseconds, plus the matching cubic-bezier control points. */
export const MOTION = {
  instant: 90,
  fast: 160,
  base: 240,
  data: 420,
  dataDragging: 120,
  flyout: 360,
  peelForward: 1400,
  peelAssemble: 1100,
} as const;

export const EASE = {
  instant: [0.2, 0, 0, 1],
  out: [0.22, 1, 0.36, 1],
  data: [0.16, 1, 0.3, 1],
  peel: [0.65, 0, 0.35, 1],
  exit: [0.55, 0, 1, 0.45],
} as const satisfies Record<string, readonly [number, number, number, number]>;
