/**
 * Risk scale "Ember v2" — the ONLY source of risk colour in CardioTwin (DESIGN_SYSTEM.md §2.2).
 *
 * CSS, SVG, the 3D shaders (via the 256-px LUT) and the legend all read from this file, so every mark
 * that encodes a probability sits on the same ramp. Rules that consumers must follow:
 *   - risk colour is for marks (vessels, bars, pips, band rules, legend), never for text;
 *   - animate p and sample the ramp, never interpolate RGB between two endpoint colours;
 *   - pending / stale state is achromatic `RISK_PENDING`, never a stale risk colour.
 */
import {
  converter,
  formatHex,
  interpolate,
  modeLrgb,
  modeOklab,
  modeRgb,
  useMode as registerColorMode,
  type Color,
} from 'culori/fn';

registerColorMode(modeRgb);
registerColorMode(modeLrgb);
registerColorMode(modeOklab);

/** Anchors at p = 0, .25, .5, .75, 1 (blue → violet → mauve → coral → apricot). */
export const RISK_ANCHORS = ['#386695', '#7374BD', '#BF7DB0', '#FB9167', '#FFCB77'] as const;

const ramp = interpolate([...RISK_ANCHORS], 'oklab');
const toLinearRgb = converter('lrgb');

const clamp01 = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

/** Exact ramp colour for probability p (OKLab interpolation between the anchors). */
export const riskHex = (p: number): string => formatHex(ramp(clamp01(p)) as Color);

/**
 * Unquantised ramp colour in LINEAR sRGB (0–1 per channel) — what three.js expects in
 * `color.setRGB(r, g, b)` with the default linear working colour space.
 */
export function riskLinear(p: number): [number, number, number] {
  const c = toLinearRgb(ramp(clamp01(p)) as Color);
  const f = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));
  return [f(c.r), f(c.g), f(c.b)];
}

/** Number of samples in the lookup table shared by CSS gradients, SVG and the WebGL shaders. */
export const RISK_LUT_SIZE = 256;

/** `RISK_LUT_HEX[i] = riskHex(i / 255)` — precomputed so per-frame consumers never call culori. */
export const RISK_LUT_HEX: readonly string[] = Array.from({ length: RISK_LUT_SIZE }, (_, i) =>
  riskHex(i / (RISK_LUT_SIZE - 1)),
);

/** 256×1 RGBA8 pixels of the LUT (sRGB-encoded), ready for `new THREE.DataTexture(data, 256, 1)`. */
export function riskLutPixels(): Uint8Array {
  const data = new Uint8Array(RISK_LUT_SIZE * 4);
  RISK_LUT_HEX.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    data[i * 4] = (n >> 16) & 0xff;
    data[i * 4 + 1] = (n >> 8) & 0xff;
    data[i * 4 + 2] = n & 0xff;
    data[i * 4 + 3] = 0xff;
  });
  return data;
}

/** Nearest LUT sample — cheap enough for every animation frame. */
export const riskHexFast = (p: number): string =>
  RISK_LUT_HEX[Math.round(clamp01(p) * (RISK_LUT_SIZE - 1))] ?? RISK_LUT_HEX[0]!;

/** The exact 9-step list from the spec (p = 0, .125, …, 1). */
export const RISK_STEPS_9: readonly { p: number; hex: string }[] = Array.from({ length: 9 }, (_, i) => ({
  p: i / 8,
  hex: riskHex(i / 8),
}));

/** CSS `linear-gradient` stops that reproduce the ramp (17 OKLab-exact stops, visually seamless). */
export function riskGradientCss(direction = 'to right', from = 0, to = 1): string {
  const stops = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    return `${riskHex(from + (to - from) * t)} ${(t * 100).toFixed(2)}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

// --------------------------------------------------------------------------------------------- bands

/** Contract ids (docs/CONTRACTS.md §0): low < .25 ≤ moderate < .50 ≤ high < .75 ≤ critical. */
export type RiskBandId = 'low' | 'moderate' | 'high' | 'critical';

export interface RiskBandSpec {
  id: RiskBandId;
  /** Exclusive upper edge (the last band is inclusive of 1). */
  max: number;
}

export const DEFAULT_RISK_BANDS: readonly RiskBandSpec[] = [
  { id: 'low', max: 0.25 },
  { id: 'moderate', max: 0.5 },
  { id: 'high', max: 0.75 },
  { id: 'critical', max: 1.0 },
];

export interface RiskBandStyle {
  id: RiskBandId;
  /** UI label: the contract id `critical` is shown as "Very high", never "Critical". */
  label: string;
  /** Short label for dense rows. */
  short: string;
  /** Meter level 1–4 (▮▯▯▯ … ▮▮▮▮). */
  level: 1 | 2 | 3 | 4;
  /** Chip / pip colour: the ramp at the band midpoint. */
  chip: string;
}

export const RISK_BAND_STYLES: Readonly<Record<RiskBandId, RiskBandStyle>> = {
  low: { id: 'low', label: 'Low', short: 'Low', level: 1, chip: '#576DA9' },
  moderate: { id: 'moderate', label: 'Moderate', short: 'Mod', level: 2, chip: '#9A7AB7' },
  high: { id: 'high', label: 'High', short: 'High', level: 3, chip: '#DC8890' },
  critical: { id: 'critical', label: 'Very high', short: 'V. high', level: 4, chip: '#FEAE6F' },
};

/** Band for probability p. `bands` defaults to the contract edges; pass `schema.risk_bands` to follow the model. */
export function bandFor(p: number, bands: readonly RiskBandSpec[] = DEFAULT_RISK_BANDS): RiskBandId {
  const x = clamp01(p);
  const sorted = [...bands].sort((a, b) => a.max - b.max);
  for (const band of sorted) if (x < band.max) return band.id;
  return sorted[sorted.length - 1]?.id ?? 'critical';
}

// -------------------------------------------------------------------------------------- fixed marks

/** SHAP direction reuses the ramp: raises risk (▶, +) / lowers risk (◀, −). */
export const SHAP_RAISES = '#FB9167';
export const SHAP_LOWERS = '#7374BD';

/** Achromatic pending / stale / error mark, always labelled "updating" or "unavailable". */
export const RISK_PENDING = '#4B5260';
