import { describe, expect, it } from 'vitest';
import { samplePrediction, sampleSchema } from '@/test/fixtures';
import type { PredictResponse } from '@/types/contracts';
import { outsideRange, physiologyTitle, whatIfTitle } from './explainTitles';
import { predictionId } from './explainUi';
import { formatContribution } from './useExplainData';

const withCad = (p: number): PredictResponse => ({
  ...samplePrediction,
  predictions: { ...samplePrediction.predictions, CAD: { ...samplePrediction.predictions.CAD!, probability: p } },
});

describe('Explain drawer takeaway titles (§5.10)', () => {
  it('states what the edits did, in points, never as a probability', () => {
    expect(whatIfTitle('CAD', 2, withCad(0.8), withCad(0.73))).toBe('2 changes lowered CAD by 7 points');
    // A capped end (≥95 %): the same lower bound as the Risk card's "▼ ≥4 pts", never the raw difference.
    expect(whatIfTitle('CAD', 2, withCad(0.98), withCad(0.91))).toBe('2 changes lowered CAD by ≥4 points');
    expect(whatIfTitle('CAD', 1, withCad(0.97), withCad(0.99))).toBe('1 change left CAD at the top of the shown range');
    expect(whatIfTitle('CAD', 1, withCad(0.5), withCad(0.51))).toBe('1 change raised CAD by 1 point');
    expect(whatIfTitle('CAD', 1, withCad(0.5), withCad(0.502))).toBe('1 change left CAD unchanged');
    expect(whatIfTitle('CAD', 0, null, withCad(0.5))).toMatch(/^No changes yet/);
    expect(whatIfTitle('CAD', 3, withCad(0.98), withCad(0.4))).not.toMatch(/%/);
  });

  it('counts measured values outside their reference range', () => {
    const features = { BP: 150, PR: 70, 'EF-TTE': 40, Age: 80, 'Typical Chest Pain': 1 };
    expect(outsideRange(features, sampleSchema.features).map((s) => s.key)).toEqual(['BP', 'EF-TTE']);
    expect(physiologyTitle(2)).toBe('2 values outside the normal range');
    expect(physiologyTitle(1)).toBe('1 value outside the normal range');
    expect(physiologyTitle(0)).toMatch(/^All measured values within/);
  });
});

describe('contribution formatting', () => {
  const scale = { typical: 0.5, probability: 0.75, perLogOdds: 0.1 };

  it('writes points as signed integers and small ones as "<1"', () => {
    expect(formatContribution(1.26, 'points', scale).text).toBe('+13');
    expect(formatContribution(-0.52, 'points', scale).text).toBe('−5');
    expect(formatContribution(0.02, 'points', scale).text).toBe('<1');
    expect(formatContribution(0.94, 'points', scale).spoken).toBe('plus 9 points');
  });

  it('falls back to exact log-odds without a points scale', () => {
    expect(formatContribution(1.26, 'points', null).text).toBe('+1.26');
    expect(formatContribution(-0.5, 'logodds', scale)).toEqual({ text: '−0.50', spoken: 'minus 0.50 log-odds' });
  });
});

describe('prediction id', () => {
  it('is stable under key order and changes with any input', () => {
    expect(predictionId({ a: 1, b: 'x' })).toBe(predictionId({ b: 'x', a: 1 }));
    expect(predictionId({ a: 1, b: 'x' })).not.toBe(predictionId({ a: 2, b: 'x' }));
    expect(predictionId({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
  });
});
