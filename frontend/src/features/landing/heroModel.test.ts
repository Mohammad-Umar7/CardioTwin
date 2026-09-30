import { describe, expect, it } from 'vitest';
import { indexSchema } from '@/hooks/useData';
import { samplePrediction, sampleSchema } from '@/test/fixtures';
import { flaggedCount, highestRiskVessel, stepsForShare, topDrivers, vesselMarks } from './heroModel';

const byKey = indexSchema(sampleSchema).byKey;
const VESSELS = ['LAD', 'LCX', 'RCA'];

describe('topDrivers', () => {
  it('returns the largest contributions with human labels, direction and 3-step length', () => {
    const d = topDrivers(samplePrediction, byKey, 'CAD', 3);
    expect(d.map((x) => x.key)).toEqual(['Typical Chest Pain', 'Age', 'Region RWMA']);
    expect(d[0]).toMatchObject({ label: 'Typical chest pain', direction: 'up', share: 1, steps: 3 });
    expect(d[1]!.steps).toBe(2);
    expect(d[2]!.label).toBe('Regional wall motion abnormality');
  });

  it('marks lowering contributions as down and drops negligible ones', () => {
    const d = topDrivers(samplePrediction, byKey, 'CAD', 8);
    expect(d.find((x) => x.key === 'Sex')?.direction).toBe('down');
    expect(d.some((x) => x.key === 'PR' || x.key === 'BBB')).toBe(false);
  });

  it('is empty without a prediction', () => {
    expect(topDrivers(null, byKey)).toEqual([]);
  });
});

describe('vessel helpers', () => {
  it('maps each vessel to its probability and flag', () => {
    expect(vesselMarks(samplePrediction, VESSELS)).toEqual([
      { id: 'LAD', p: 0.72, flagged: true },
      { id: 'LCX', p: 0.38, flagged: false },
      { id: 'RCA', p: 0.61, flagged: true },
    ]);
    expect(vesselMarks(null, VESSELS)[0]).toEqual({ id: 'LAD', p: null, flagged: null });
  });

  it('finds the highest-risk vessel and counts flags from the contract labels', () => {
    expect(highestRiskVessel(samplePrediction, VESSELS)).toBe('LAD');
    expect(flaggedCount(samplePrediction, VESSELS)).toBe(2);
    expect(flaggedCount(null, VESSELS)).toBeNull();
  });

  it('steps grow with share', () => {
    expect([0.1, 0.4, 0.9].map(stepsForShare)).toEqual([1, 2, 3]);
  });
});
