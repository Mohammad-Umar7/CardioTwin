import { describe, expect, it } from 'vitest';
import { SYSTOLE_FRACTION } from '@/three/anatomy/heartbeat';
import { ECG_WAVES, displayRate, ecgAt } from './ecg';

const sample = (from: number, to: number, n = 2000) =>
  Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);

describe('schematic ECG on the physiological cardiac phase', () => {
  it('peaks at the R wave, just before mitral closure (φ = 0), at amplitude 1', () => {
    const phases = sample(0, 1, 10000);
    const peak = phases.reduce((best, p) => (ecgAt(p) > ecgAt(best) ? p : best), 0);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1);
    expect(ecgAt(peak)).toBeCloseTo(1, 1);
  });

  it('is periodic over one beat', () => {
    for (const p of sample(0, 1, 50)) expect(ecgAt(p + 1)).toBeCloseTo(ecgAt(p), 9);
    expect(ecgAt(-0.25)).toBeCloseTo(ecgAt(0.75), 9);
  });

  it('is flat in diastasis, between the T wave and the P wave', () => {
    for (const p of sample(0.48, 0.7, 100)) expect(Math.abs(ecgAt(p))).toBeLessThan(0.02);
  });

  it('orders P → QRS → T, with the T wave ending by the end of ejection', () => {
    const [pWave, , rWave, , tWave] = ECG_WAVES;
    expect(pWave!.centre).toBeLessThan(rWave!.centre);
    expect(tWave!.centre + 2 * tWave!.sigma).toBeLessThan(SYSTOLE_FRACTION + 0.05);
    expect(ecgAt(tWave!.centre)).toBeGreaterThan(0.2);
    expect(ecgAt(pWave!.centre)).toBeGreaterThan(0.1);
  });

  it('dips below the baseline for Q and S around the R peak', () => {
    expect(ecgAt(0.957)).toBeLessThan(0);
    expect(ecgAt(0.99)).toBeLessThan(0);
  });
});

describe('displayRate', () => {
  it('rounds a plausible recorded pulse rate', () => {
    expect(displayRate(72)).toBe(72);
    expect(displayRate(79.6)).toBe(80);
  });

  it('shows nothing for missing or implausible input', () => {
    expect(displayRate(undefined)).toBeNull();
    expect(displayRate('72')).toBeNull();
    expect(displayRate(Number.NaN)).toBeNull();
    expect(displayRate(5)).toBeNull();
    expect(displayRate(400)).toBeNull();
  });
});
