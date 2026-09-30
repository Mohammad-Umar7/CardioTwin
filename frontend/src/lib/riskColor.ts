/**
 * Risk colour + band helpers for components. Thin, typed wrapper over src/theme/risk.ts (the single
 * source of the Ember v2 ramp) so UI and 3D code share one call:
 *
 *   const { hex, rgb, linear } = riskColor(p);   // CSS/SVG → hex; THREE.Color#setRGB → linear
 *   const band = riskBand(p, schema.risk_bands); // { id, label: 'Very high', level: 4, chip }
 */
import {
  DEFAULT_RISK_BANDS,
  RISK_BAND_STYLES,
  RISK_PENDING,
  bandFor,
  riskHex,
  riskLinear,
  type RiskBandId,
  type RiskBandSpec,
  type RiskBandStyle,
} from '@/theme/risk';
import { hexToRgb } from './colorScience';

export interface RiskColor {
  /** "#bf7db0" — for CSS and SVG. */
  hex: string;
  /** sRGB-encoded channels in 0–1. */
  rgb: [number, number, number];
  /** Linear-sRGB channels in 0–1 — pass to `THREE.Color#setRGB` (linear working space). */
  linear: [number, number, number];
}

export function riskColor(p: number): RiskColor {
  const hex = riskHex(p);
  const [r, g, b] = hexToRgb(hex);
  return { hex, rgb: [r, g, b], linear: riskLinear(p) };
}

/** Pending / stale / error mark colour (achromatic, never a stale risk colour). */
export const pendingColor: RiskColor = (() => {
  const [r, g, b] = hexToRgb(RISK_PENDING);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return { hex: RISK_PENDING, rgb: [r, g, b], linear: [lin(r), lin(g), lin(b)] };
})();

/** Band for p using the model's band edges (falls back to the contract edges). */
export function riskBand(p: number, bands?: readonly RiskBandSpec[] | null): RiskBandStyle {
  return RISK_BAND_STYLES[bandFor(p, bands && bands.length > 0 ? bands : DEFAULT_RISK_BANDS)];
}

/** Style for a band id coming straight from the API (`predictions[t].risk_band`). */
export function bandStyle(id: RiskBandId): RiskBandStyle {
  return RISK_BAND_STYLES[id] ?? RISK_BAND_STYLES.low;
}

export { RISK_BAND_STYLES, RISK_PENDING, riskHex };
export type { RiskBandId, RiskBandStyle };
