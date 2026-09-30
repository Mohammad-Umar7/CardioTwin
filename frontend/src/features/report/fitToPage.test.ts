import { describe, expect, it } from 'vitest';
import { MIN_FIT, fitScale, mmToPx } from './fitToPage';

describe('fitScale', () => {
  it('leaves content that fits at full size', () => {
    expect(fitScale(900, 1000)).toBe(1);
    expect(fitScale(1000, 1000)).toBe(1);
  });

  it('scales overflowing content down to the page, rounding down', () => {
    expect(fitScale(1100, 1000)).toBe(0.909);
    expect(1100 * fitScale(1100, 1000)).toBeLessThanOrEqual(1000);
  });

  it('never goes below the legibility floor (the sheet flows onto another page instead)', () => {
    expect(fitScale(3000, 1000)).toBe(MIN_FIT);
  });

  it('ignores unmeasured layouts', () => {
    expect(fitScale(0, 1000)).toBe(1);
    expect(fitScale(Number.NaN, 1000)).toBe(1);
  });

  it('converts millimetres to CSS pixels at 96 dpi', () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 9);
    expect(mmToPx(297)).toBeCloseTo(1122.5, 1);
  });
});
