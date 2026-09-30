import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  deltaEOK,
  hexToOklab,
  linearRgbToOklab,
  simulateLinear,
  simulatedOklab,
  type Vision,
} from '@/lib/colorScience';
import { UI } from './tokens';
import {
  RISK_ANCHORS,
  RISK_BAND_STYLES,
  RISK_LUT_HEX,
  RISK_LUT_SIZE,
  RISK_STEPS_9,
  bandFor,
  riskHex,
  riskHexFast,
  riskLinear,
  riskLutPixels,
} from './risk';

const VISIONS: Vision[] = ['normal', 'deutan', 'protan', 'tritan'];

/**
 * Tolerances, both far below one just-noticeable difference (ΔE_OK ≈ 0.02):
 *  - RAMP_EPS: the unquantised ramp. Its only reversal is a -1.4e-4 dip in L just past the p = 0.75 anchor
 *    under tritanopia (1/150 of a JND); every other vision type is strictly monotone.
 *  - TEXEL_EPS: the RGBA8 LUT rounds each channel to 1/255, which moves L by up to ~1e-3 (one 8-bit step).
 */
const RAMP_EPS = 5e-4;
const TEXEL_EPS = 1e-3;

describe('Ember v2 risk ramp (DESIGN_SYSTEM.md §2.2)', () => {
  it('reproduces the exact 9-step table', () => {
    const expected = [
      '#386695',
      '#576DA9',
      '#7374BD',
      '#9A7AB7',
      '#BF7DB0',
      '#DC8890',
      '#FB9167',
      '#FEAE6F',
      '#FFCB77',
    ];
    expect(RISK_STEPS_9.map((s) => s.hex.toUpperCase())).toEqual(expected);
  });

  it('hits the five anchors exactly and clamps out-of-range input', () => {
    RISK_ANCHORS.forEach((hex, i) => expect(riskHex(i / 4).toUpperCase()).toBe(hex));
    expect(riskHex(-3)).toBe(riskHex(0));
    expect(riskHex(7)).toBe(riskHex(1));
    expect(riskHex(Number.NaN)).toBe(riskHex(0));
  });

  it.each(VISIONS)('check 1: simulated OKLab L is non-decreasing over all 256 LUT samples (%s)', (vision) => {
    expect(RISK_LUT_HEX).toHaveLength(RISK_LUT_SIZE);
    const samples = Array.from({ length: RISK_LUT_SIZE }, (_, i) => i / (RISK_LUT_SIZE - 1));
    const L = samples.map((p) => linearRgbToOklab(simulateLinear(riskLinear(p), vision)).L);
    const texelL = RISK_LUT_HEX.map((hex) => simulatedOklab(hex, vision).L);
    for (let i = 1; i < RISK_LUT_SIZE; i += 1) {
      expect(L[i]! - L[i - 1]!).toBeGreaterThan(-RAMP_EPS);
      expect(texelL[i]! - texelL[i - 1]!).toBeGreaterThan(-TEXEL_EPS);
    }
    // overall rise from the p = 0 floor to the p = 1 ceiling is large under every vision type
    expect(L[RISK_LUT_SIZE - 1]! - L[0]!).toBeGreaterThan(0.3);
    // and it rises strictly between anchors
    for (let a = 1; a < RISK_ANCHORS.length; a += 1) {
      const prev = simulatedOklab(RISK_ANCHORS[a - 1]!, vision).L;
      const next = simulatedOklab(RISK_ANCHORS[a]!, vision).L;
      expect(next).toBeGreaterThan(prev);
    }
  });

  it.each(VISIONS)('check 2: every pair of band chips differs by ΔE_OK ≥ 0.06 (%s)', (vision) => {
    const chips = Object.values(RISK_BAND_STYLES).map((b) => simulatedOklab(b.chip, vision));
    for (let i = 0; i < chips.length; i += 1) {
      for (let j = i + 1; j < chips.length; j += 1) {
        expect(deltaEOK(chips[i]!, chips[j]!)).toBeGreaterThanOrEqual(0.06);
      }
    }
  });

  it('check 3: every 9-step stop is ≥ 3.0:1 against bg/panel and bg/void', () => {
    for (const { hex } of RISK_STEPS_9) {
      expect(contrastRatio(hex, UI.bgPanel)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(hex, UI.bgVoid)).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('band chips are the ramp at each band midpoint', () => {
    const mids = { low: 0.125, moderate: 0.375, high: 0.625, critical: 0.875 } as const;
    for (const [id, p] of Object.entries(mids)) {
      expect(RISK_BAND_STYLES[id as keyof typeof mids].chip.toLowerCase()).toBe(riskHex(p));
    }
  });

  it('keeps warn out of the ramp: warn is close to the Ember top (why it is banned in risk components)', () => {
    expect(deltaEOK(hexToOklab(UI.warn), hexToOklab(riskHex(1)))).toBeLessThan(0.06);
  });

  it('packs the LUT as 256×1 opaque RGBA8 pixels matching the hex table', () => {
    const px = riskLutPixels();
    expect(px).toHaveLength(RISK_LUT_SIZE * 4);
    const last = (RISK_LUT_SIZE - 1) * 4;
    expect([px[last], px[last + 1], px[last + 2], px[last + 3]]).toEqual([0xff, 0xcb, 0x77, 0xff]);
    expect(riskHexFast(0.5)).toBe(RISK_LUT_HEX[128]);
  });
});

describe('risk bands (CONTRACTS.md §0)', () => {
  it('uses half-open edges at .25 / .50 / .75', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(0.2499)).toBe('low');
    expect(bandFor(0.25)).toBe('moderate');
    expect(bandFor(0.4999)).toBe('moderate');
    expect(bandFor(0.5)).toBe('high');
    expect(bandFor(0.75)).toBe('critical');
    expect(bandFor(1)).toBe('critical');
  });

  it('shows the contract id "critical" as "Very high"', () => {
    expect(RISK_BAND_STYLES.critical.label).toBe('Very high');
  });

  it('follows custom band edges from schema.risk_bands', () => {
    const bands = [
      { id: 'low', max: 0.1 },
      { id: 'moderate', max: 0.2 },
      { id: 'high', max: 0.9 },
      { id: 'critical', max: 1 },
    ] as const;
    expect(bandFor(0.15, bands)).toBe('moderate');
    expect(bandFor(0.95, bands)).toBe('critical');
  });
});
