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
  it('shows integers with a thin space and clamps the extremes', () => {
    expect(formatProbability(0.719).text).toBe(`72${THIN_SPACE}%`);
    expect(formatProbability(0.719).exact).toBe('p = 0.719');
    expect(formatProbability(0.004).text).toBe(`<1${THIN_SPACE}%`);
    expect(formatProbability(0.996).text).toBe(`>99${THIN_SPACE}%`);
    expect(formatProbability(0.99).value).toBe('99');
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
