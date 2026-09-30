import { describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { samplePrediction, sampleSchema } from '@/test/fixtures';
import {
  buildNarrative,
  groupAttribution,
  inversePlatt,
  narrativeText,
  platt,
  shareSegments,
  sortedContributions,
} from './explain';

const idx = indexSchema(sampleSchema);
const specOf = (k: string) => idx.byKey.get(k);

describe('explanations', () => {
  it('keeps the additive identity base + Σ shap ≈ output for the sample (sanity of fixtures)', () => {
    const e = samplePrediction.explanations.CAD!;
    expect(sortedContributions(e)[0]?.feature).toBe('Typical Chest Pain');
  });

  it('sums SHAP per group with shares that add to 1', () => {
    const g = groupAttribution(samplePrediction.explanations.LAD, (f) => idx.byKey.get(f)?.group);
    const total = [...g.values()].reduce((a, r) => a + r.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(g.get('symptoms')?.sum).toBeCloseTo(0.94, 6);
  });

  it('maps shares to 0–4 meter segments', () => {
    expect(shareSegments(0.01)).toBe(0);
    expect(shareSegments(0.1)).toBe(1);
    expect(shareSegments(0.5)).toBe(2);
    expect(shareSegments(0.95)).toBe(4);
  });

  it('inverts Platt calibration exactly', () => {
    const a = 1.84;
    const b = -0.61;
    const m = 0.73;
    expect(inversePlatt(platt(m, a, b), a, b)).toBeCloseTo(m, 10);
  });

  it('builds the template "why" sentence with linked phrases', () => {
    const parts = buildNarrative('LAD', 0.72, 'high', samplePrediction.explanations.LAD, specOf);
    const text = narrativeText(parts);
    expect(text).toBe('LAD 72 %, high. Typical chest pain and age 62 y push it up; male sex pulls it down.');
    expect(parts.filter((p) => p.kind === 'phrase').map((p) => p.feature)).toEqual(['Typical Chest Pain', 'Age', 'Sex']);
  });

  it('handles explanations without meaningful drivers', () => {
    const parts = buildNarrative('RCA', 0.1, 'low', { space: 'log-odds', base_value: 0, output_value: 0, contributions: [] }, specOf);
    expect(narrativeText(parts)).toContain('No single input');
  });
});
