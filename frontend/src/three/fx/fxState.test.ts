import { describe, expect, it } from 'vitest';
import {
  IGNITE_DONE,
  IGNITE_END,
  IGNITE_SETTLE_S,
  IGNITE_SWEEP_S,
  IgnitionTrigger,
  MIN_DENSITY,
  MIN_SPEED,
  createFxFrameState,
  ignitionAt,
  phasicityOf,
  riskFlowParams,
  slotOf,
} from './fxState';

describe('risk-coded flow parameters', () => {
  it('leaves low-risk vessels at full density and speed', () => {
    const low = riskFlowParams(0.05);
    expect(low.density).toBe(1);
    expect(low.speed).toBe(1);
  });

  it('makes higher risk sparser, slower and warmer, monotonically', () => {
    let prev = riskFlowParams(0);
    for (let i = 1; i <= 20; i += 1) {
      const cur = riskFlowParams(i / 20);
      expect(cur.density).toBeLessThanOrEqual(prev.density);
      expect(cur.speed).toBeLessThanOrEqual(prev.speed);
      expect(cur.tintMix).toBeGreaterThan(prev.tintMix);
      prev = cur;
    }
    expect(riskFlowParams(1).density).toBeCloseTo(MIN_DENSITY, 6);
    expect(riskFlowParams(1).speed).toBeCloseTo(MIN_SPEED, 6);
  });

  it('never codes risk while no estimate is shown, or when coding is switched off', () => {
    for (const params of [riskFlowParams(0.9, 0), riskFlowParams(0.9, 1, 0)]) {
      expect(params.density).toBe(1);
      expect(params.speed).toBe(1);
      expect(params.tintMix).toBe(0);
    }
  });

  it('keeps every particle visible and moving (no zero density or speed)', () => {
    const worst = riskFlowParams(1);
    expect(worst.density).toBeGreaterThan(0.3);
    expect(worst.speed).toBeGreaterThan(0.3);
  });

  it('uses the flatter right-coronary pattern for the RCA only', () => {
    expect(phasicityOf('RCA')).toBeLessThan(1);
    expect(phasicityOf('LAD')).toBe(1);
    expect(phasicityOf(null)).toBe(1);
  });
});

describe('ignition envelope', () => {
  it('sweeps from the ostia past the tips, then settles to dark', () => {
    expect(ignitionAt(0)).toEqual({ front: 0, amp: 1, active: true });
    let prev = -1;
    for (let i = 0; i <= 50; i += 1) {
      const { front } = ignitionAt((IGNITE_SWEEP_S * i) / 50 - 1e-9);
      expect(front).toBeGreaterThanOrEqual(prev);
      prev = front;
    }
    expect(prev).toBeCloseTo(IGNITE_END, 3);
    const settling = ignitionAt(IGNITE_SWEEP_S + IGNITE_SETTLE_S / 2);
    expect(settling.front).toBe(IGNITE_DONE);
    expect(settling.amp).toBeGreaterThan(0);
    expect(settling.amp).toBeLessThan(1);
    expect(ignitionAt(IGNITE_SWEEP_S + IGNITE_SETTLE_S + 0.01)).toEqual({ front: IGNITE_DONE, amp: 0, active: false });
  });
});

describe('ignition trigger', () => {
  it('fires when a prediction lands for a new case, not on what-if edits of the same case', () => {
    const trigger = new IgnitionTrigger();
    expect(trigger.update(0, true, 'cohort:P-011', false)).toBe(false); // waiting for an estimate
    expect(trigger.update(0.2, true, 'cohort:P-011', true)).toBe(true);
    expect(trigger.update(0.3, true, 'cohort:P-011', true)).toBe(false);
    expect(trigger.update(5, true, 'cohort:P-011', true)).toBe(false);
    expect(trigger.update(6, true, 'cohort:P-042', true)).toBe(true);
  });

  it('waits for the anatomy', () => {
    const trigger = new IgnitionTrigger();
    expect(trigger.update(0, false, 'cohort:P-011', true)).toBe(false);
    expect(trigger.update(1, true, 'cohort:P-011', true)).toBe(true);
  });

  it('ignites anyway (neutral flow) when no estimate arrives in time', () => {
    const trigger = new IgnitionTrigger(1.5);
    expect(trigger.update(0, true, null, false)).toBe(false);
    expect(trigger.update(1.4, true, null, false)).toBe(false);
    expect(trigger.update(1.6, true, null, false)).toBe(true);
    expect(trigger.update(3, true, null, false)).toBe(false);
    // the first real estimate for a case still gets its sweep
    expect(trigger.update(4, true, 'custom', true)).toBe(true);
  });

  it('replays after a reset', () => {
    const trigger = new IgnitionTrigger();
    expect(trigger.update(0, true, 'a', true)).toBe(true);
    trigger.reset();
    expect(trigger.update(1, true, 'a', true)).toBe(true);
  });
});

describe('frame state', () => {
  it('starts neutral: full density, no tint, nothing in flight', () => {
    const state = createFxFrameState();
    expect(Array.from(state.density).every((d) => d === 1)).toBe(true);
    expect(Array.from(state.tintMix).every((d) => d === 0)).toBe(true);
    expect(state.pulseFront).toBe(-1);
    expect(state.flowOpacity).toBe(0);
  });

  it('maps unknown and not-predicted targets to slot 0', () => {
    const targets = ['', 'LAD', 'LCX', 'RCA'];
    expect(slotOf(targets, 'LCX')).toBe(2);
    expect(slotOf(targets, null)).toBe(0);
    expect(slotOf(targets, 'LM')).toBe(0);
    expect(slotOf(targets, '')).toBe(0);
  });
});
