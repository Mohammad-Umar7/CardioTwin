import { describe, expect, it } from 'vitest';
import type { FeatureSpec } from '@/types/contracts';
import {
  MINUS,
  THIN_SPACE,
  decimalsForStep,
  formatCi,
  formatDeltaPts,
  formatFeatureValue,
  formatNormalRange,
  formatProbability,
  formatShap,
  formatShownDeltaPts,
  printedDifference,
  optionDisplay,
  rangeStatus,
} from './format';
import { cn } from './cn';
import { riskBand, riskColor } from './riskColor';

const numeric = (over: Partial<FeatureSpec> = {}): FeatureSpec => ({
  key: 'BP',
  label: 'Blood pressure',
  group: 'exam',
  type: 'numeric',
  unit: 'mmHg',
  min: 90,
  max: 190,
  step: 1,
  normal: { low: 90, high: 120 },
  ...over,
});

describe('formatProbability', () => {
  it('shows integers with a thin space and caps the display at ≤5 % / ≥95 % (calibration slope < 1)', () => {
    expect(formatProbability(0.719).text).toBe(`72${THIN_SPACE}%`);
    expect(formatProbability(0.719).exact).toBe('p = 0.719');
    expect(formatProbability(0.719).capped).toBe(false);
    expect(formatProbability(0.004).text).toBe(`≤5${THIN_SPACE}%`);
    expect(formatProbability(0.054).text).toBe(`≤5${THIN_SPACE}%`);
    expect(formatProbability(0.056).text).toBe(`6${THIN_SPACE}%`);
    expect(formatProbability(0.944).text).toBe(`94${THIN_SPACE}%`);
    expect(formatProbability(0.946).text).toBe(`≥95${THIN_SPACE}%`);
    expect(formatProbability(0.996).text).toBe(`≥95${THIN_SPACE}%`);
    expect(formatProbability(0.996).spoken).toBe('95 percent or more');
    expect(formatProbability(0.996).exact).toBe('p = 0.996');
    expect(formatProbability(0.99).capped).toBe(true);
    expect(formatProbability(Number.NaN).text).toBe('–');
  });
});

describe('deltas and SHAP', () => {
  it('formats percentage-point deltas with glyphs and the true minus', () => {
    expect(formatDeltaPts(0.12).text).toBe(`+12${THIN_SPACE}pts`);
    expect(formatDeltaPts(0.12).glyph).toBe('▲');
    expect(formatDeltaPts(-0.04).text).toBe(`${MINUS}4${THIN_SPACE}pts`);
    expect(formatDeltaPts(0.001).direction).toBe('none');
  });

  it('signs SHAP values in log-odds with U+2212', () => {
    expect(formatShap(0.941)).toBe('+0.94');
    expect(formatShap(-0.18)).toBe(`${MINUS}0.18`);
    expect(formatShap(0.0004)).toBe('0.00');
  });

  it('formats CIs with an en dash', () => {
    expect(formatCi([0.88, 0.981])).toBe('[0.88–0.98]');
    expect(formatCi(null)).toBe('');
  });
});

describe('feature values', () => {
  it('never shows dataset quirks', () => {
    const bin: FeatureSpec = { key: 'DM', label: 'Diabetes', group: 'risk_factors', type: 'binary' };
    expect(formatFeatureValue(bin, 1)).toBe('Yes');
    expect(formatFeatureValue(bin, 0)).toBe('No');
    const sex: FeatureSpec = {
      key: 'Sex',
      label: 'Sex',
      group: 'demographics',
      type: 'categorical',
      options: [
        { value: 'Male', label: 'Male' },
        { value: 'Female', label: 'Female' },
      ],
    };
    expect(formatFeatureValue(sex, 'Fmale')).toBe('Female');
    const bbb: FeatureSpec = {
      key: 'BBB',
      label: 'Bundle branch block',
      group: 'ecg',
      type: 'categorical',
      options: [
        { value: 'N', label: 'None' },
        { value: 'LBBB', label: 'Left bundle branch block' },
      ],
    };
    expect(optionDisplay(bbb, 'LBBB')).toEqual({ short: 'LBBB', full: 'Left bundle branch block' });
    expect(optionDisplay(bbb, 'N').short).toBe('None');
  });

  it('adds units after a thin space and respects step precision', () => {
    expect(formatFeatureValue(numeric(), 140)).toBe(`140${THIN_SPACE}mmHg`);
    expect(formatFeatureValue(numeric({ unit: 'mg/dl', step: 0.1 }), 1.25)).toBe(`1.3${THIN_SPACE}mg/dL`);
    expect(decimalsForStep(0.05)).toBe(2);
  });

  it('classifies values against the reference range in words, not colour', () => {
    expect(rangeStatus(140, { low: 90, high: 120 })).toBe('above');
    expect(rangeStatus(45, { low: 50, high: 70 })).toBe('below');
    expect(rangeStatus(100, { low: 90, high: 120 })).toBe('within');
    expect(rangeStatus(100, { low: null, high: null })).toBeNull();
    expect(formatNormalRange({ low: 90, high: 120 })).toBe('ref 90–120');
  });
});

describe('cn + risk helpers', () => {
  it('keeps custom font-size tokens next to text colours', () => {
    expect(cn('text-overline text-secondary', 'text-primary')).toBe('text-overline text-primary');
  });

  it('returns hex, sRGB and linear channels for the same p', () => {
    const c = riskColor(0.5);
    expect(c.hex).toBe('#bf7db0');
    expect(c.rgb[0]).toBeCloseTo(0xbf / 255, 5);
    expect(c.linear[0]).toBeLessThan(c.rgb[0]);
  });

  it('labels the critical band "Very high"', () => {
    expect(riskBand(0.87).label).toBe('Very high');
    expect(riskBand(0.3).level).toBe(2);
  });
});

describe('printedDifference', () => {
  it('equals the difference of the two values as printed', () => {
    // 0.915 → 0.941 prints "0.92 → 0.94": the gain beside it must read +0.02, not +0.03.
    expect(printedDifference(0.9154, 0.9412)).toBeCloseTo(0.02, 10);
    // 0.672 → 0.794 prints "0.67 → 0.79": +0.12, not +0.13.
    expect(printedDifference(0.6724, 0.7943)).toBeCloseTo(0.12, 10);
    expect(printedDifference(0.9, 0.9)).toBe(0);
  });
});

describe('formatShownDeltaPts', () => {
  it('is the difference of the two printed percentages', () => {
    expect(formatShownDeltaPts(0.674, 0.786).text).toBe(`+12${THIN_SPACE}pts`);
    expect(formatShownDeltaPts(0.5, 0.5).direction).toBe('none');
  });
  it('reads as a bound, never the exact change, when an end is capped at ≥95 % or ≤5 %', () => {
    const d = formatShownDeltaPts(0.979, 0.62);
    expect(d).toMatchObject({ direction: 'down', glyph: '▼', text: `≥33${THIN_SPACE}pts` });
    expect(formatShownDeltaPts(0.03, 0.3).text).toBe(`≥25${THIN_SPACE}pts`);
  });
});
