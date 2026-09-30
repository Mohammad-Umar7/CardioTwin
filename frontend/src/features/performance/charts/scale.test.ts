import { describe, expect, it } from 'vitest';
import { formatTick, labelWidth, niceAxis, stepDecimals } from './scale';

const isRound = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-9;

describe('niceAxis', () => {
  it('gives the unit interval five quarter ticks', () => {
    expect(niceAxis(0, 1)).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], step: 0.25 });
  });

  it('never produces the odd ticks the audit found (0.71, 0.42, −0.17)', () => {
    const cases: [number, number][] = [
      [-0.17, 0.71],
      [-0.5, 0.71],
      [0.42, 0.97],
      [0.62, 0.95],
      [0.0021, 0.183],
      [-1.2, 3.4],
    ];
    for (const [lo, hi] of cases) {
      const a = niceAxis(lo, hi);
      expect(a.ticks.length).toBeGreaterThanOrEqual(3);
      expect(a.ticks.length).toBeLessThanOrEqual(6);
      expect(a.domain[0]).toBeLessThanOrEqual(lo);
      expect(a.domain[1]).toBeGreaterThanOrEqual(hi);
      for (const t of a.ticks) expect(isRound(t, a.step)).toBe(true);
      expect([1, 2, 2.5, 5]).toContain(Number((a.step / 10 ** Math.floor(Math.log10(a.step))).toFixed(6)));
    }
  });

  it('prefers four or five ticks', () => {
    for (const [lo, hi] of [
      [0, 1],
      [0.5, 1],
      [-0.1, 0.7],
      [0, 0.25],
    ] as [number, number][]) {
      const n = niceAxis(lo, hi).ticks.length;
      expect(n === 4 || n === 5).toBe(true);
    }
  });

  it('respects a clamp and degenerate input', () => {
    const a = niceAxis(0.02, 0.99, [0, 1]);
    expect(a.domain[0]).toBeGreaterThanOrEqual(0);
    expect(a.domain[1]).toBeLessThanOrEqual(1);
    expect(niceAxis(0.5, 0.5).ticks.length).toBeGreaterThanOrEqual(3);
    const dca = niceAxis(-0.05, 0.72, [-0.05, 1]);
    expect(dca.domain).toEqual([-0.05, 0.75]);
    expect(dca.ticks).toEqual([0, 0.25, 0.5, 0.75]);
    expect(niceAxis(Number.NaN, 1).domain).toEqual([0, 1]);
  });
});

describe('tick labels', () => {
  it('uses only the decimals the step needs, with a true minus', () => {
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals(0.2)).toBe(1);
    expect(stepDecimals(5)).toBe(0);
    expect([0, 0.25, 0.5, 1].map((v) => formatTick(v, 0.25))).toEqual(['0', '0.25', '0.5', '1']);
    expect(formatTick(-0.2, 0.2)).toBe('−0.2');
    expect(formatTick(-0, 0.1)).toBe('0');
  });

  it('estimates label widths monotonically', () => {
    expect(labelWidth('0.25')).toBeGreaterThan(labelWidth('0.5'));
    expect(labelWidth('1')).toBeGreaterThan(0);
  });
});
