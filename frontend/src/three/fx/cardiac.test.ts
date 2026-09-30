import { describe, expect, it } from 'vitest';
import { SYSTOLE_FRACTION, beatScale } from '../anatomy/heartbeat';
import {
  PULSE_OVERSHOOT,
  PULSE_TRAVEL,
  coronaryFlowSpeed,
  diastolicFlowShare,
  flowAdvance,
  flowIntegral,
  pulseFront,
  wrapPhase,
} from './cardiacCycle';
import { CardiacClock, PLL_DEADBAND } from './cardiacClock';

const integrate = (f: (x: number) => number, n = 20000) => {
  let acc = 0;
  for (let i = 0; i < n; i += 1) acc += f((i + 0.5) / n);
  return acc / n;
};

/** Shortest signed phase distance a − b in (−0.5, 0.5]. */
const phaseError = (a: number, b: number) => wrapPhase(a - b + 0.5) - 0.5;

describe('coronary flow waveform (illustrative, diastole-dominant)', () => {
  it('has a cycle mean of exactly 1 for any phasicity', () => {
    for (const k of [0, 0.6, 1]) expect(integrate((x) => coronaryFlowSpeed(x, k))).toBeCloseTo(1, 4);
  });

  it('nearly stalls in systole and surges early in diastole', () => {
    const midSystole = coronaryFlowSpeed(SYSTOLE_FRACTION * 0.6);
    const earlyDiastole = coronaryFlowSpeed(SYSTOLE_FRACTION + 0.2 * (1 - SYSTOLE_FRACTION));
    expect(midSystole).toBeLessThan(0.3);
    expect(earlyDiastole).toBeGreaterThan(2);
    expect(diastolicFlowShare()).toBeGreaterThan(0.75);
    expect(diastolicFlowShare()).toBeLessThan(0.97);
  });

  it('is continuous across the cycle, including both valve-event boundaries', () => {
    const eps = 1e-7;
    for (const at of [0, SYSTOLE_FRACTION]) {
      expect(coronaryFlowSpeed(at - eps)).toBeCloseTo(coronaryFlowSpeed(at + eps), 4);
    }
    let maxJump = 0;
    for (let i = 0; i < 4000; i += 1) {
      maxJump = Math.max(maxJump, Math.abs(coronaryFlowSpeed((i + 1) / 4000) - coronaryFlowSpeed(i / 4000)));
    }
    expect(maxJump).toBeLessThan(0.01);
  });

  it('never runs backwards', () => {
    for (let i = 0; i < 1000; i += 1) expect(coronaryFlowSpeed(i / 1000)).toBeGreaterThan(0);
  });

  it('a flatter RCA pattern (phasicity 0.6) keeps more systolic flow than the left tree', () => {
    expect(coronaryFlowSpeed(0.2, 0.6)).toBeGreaterThan(coronaryFlowSpeed(0.2, 1));
  });
});

describe('flow integral and frame-rate independent advance', () => {
  it('integrates from 0 to 1 over one cycle and is monotone', () => {
    expect(flowIntegral(0)).toBe(0);
    expect(flowIntegral(1)).toBeCloseTo(1, 12);
    let prev = -1;
    for (let i = 0; i <= 512; i += 1) {
      const v = flowIntegral(i / 512);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('matches a direct numerical integral of the speed', () => {
    for (const phase of [0.1, 0.35, 0.5, 0.8]) {
      const direct = integrate((x) => coronaryFlowSpeed(x * phase)) * phase;
      expect(flowIntegral(phase)).toBeCloseTo(direct, 4);
    }
  });

  it('advances by exactly the number of whole beats, whatever the phasicity', () => {
    for (const k of [0, 0.6, 1]) {
      expect(flowAdvance(0.3, 3.3, k)).toBeCloseTo(3, 9);
      expect(flowAdvance(1.7, 2.7, k)).toBeCloseTo(1, 9);
    }
  });

  it('is additive, so summing per-frame steps at any frame rate gives the same distance', () => {
    const from = 0.12;
    const to = 2.87;
    for (const frames of [7, 60, 144]) {
      let acc = 0;
      for (let i = 0; i < frames; i += 1) {
        const a = from + ((to - from) * i) / frames;
        const b = from + ((to - from) * (i + 1)) / frames;
        acc += flowAdvance(a, b);
      }
      expect(acc).toBeCloseTo(flowAdvance(from, to), 9);
    }
  });

  it('moves little in systole and a lot in the same span of diastole', () => {
    const span = 0.2;
    const systolic = flowAdvance(0.05, 0.05 + span);
    const diastolic = flowAdvance(SYSTOLE_FRACTION + 0.02, SYSTOLE_FRACTION + 0.02 + span);
    expect(diastolic / systolic).toBeGreaterThan(4);
  });
});

describe('pulse wavefront', () => {
  it('is launched at the start of diastole and absent during systole', () => {
    expect(pulseFront(0.1)).toBeNull();
    expect(pulseFront(SYSTOLE_FRACTION - 1e-6)).toBeNull();
    expect(pulseFront(SYSTOLE_FRACTION)).toBeCloseTo(0, 9);
  });

  it('runs monotonically from the ostia past the distal tips within its travel window', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const f = pulseFront(SYSTOLE_FRACTION + (PULSE_TRAVEL * i) / 100)!;
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(prev).toBeCloseTo(PULSE_OVERSHOOT, 9);
    expect(pulseFront(SYSTOLE_FRACTION + PULSE_TRAVEL + 0.01)).toBeNull();
  });
});

describe('CardiacClock', () => {
  it('advances at the requested rate and only once per frame key', () => {
    const clock = new CardiacClock();
    clock.reset(0, 60);
    clock.tick(0.05, 1);
    clock.tick(0.05, 1); // same frame: ignored
    expect(clock.beats).toBeCloseTo(0.05, 9);
    for (let i = 2; i <= 25; i += 1) clock.tick(0.05, i);
    expect(clock.beats).toBeCloseTo(1.25, 9);
    expect(clock.phase).toBeCloseTo(0.25, 9);
  });

  it('clamps huge frame gaps (background tab) to 0.1 s', () => {
    const clock = new CardiacClock();
    clock.reset(0, 60);
    clock.tick(5, 1);
    expect(clock.beats).toBeCloseTo(0.1, 9);
  });

  it('switches to a new rate only at the next beat boundary, clamped to 40–140 bpm', () => {
    const clock = new CardiacClock();
    clock.reset(0, 60);
    clock.setRate(300);
    clock.tick(0.1, 1);
    expect(clock.bpm).toBe(60);
    for (let i = 2; i < 12; i += 1) clock.tick(0.1, i);
    expect(clock.beats).toBeGreaterThanOrEqual(1);
    expect(clock.bpm).toBe(140);
  });

  it('reports diastole from the shared systole fraction', () => {
    const clock = new CardiacClock();
    clock.reset(SYSTOLE_FRACTION - 0.01);
    expect(clock.inDiastole).toBe(false);
    clock.reset(SYSTOLE_FRACTION + 0.01);
    expect(clock.inDiastole).toBe(true);
  });

  /** Simulates the anatomy's own heartbeat (a separate phase) and the fx clock observing its scale. */
  function simulateLock(offset: number, fps: number, bpm: number, seconds: number) {
    const clock = new CardiacClock();
    clock.reset(0, bpm);
    let heart = offset;
    let lastScale = beatScale(heart);
    const dt = 1 / fps;
    for (let i = 1; i <= seconds * fps; i += 1) {
      clock.tick(dt, i); // priority −1: before the heart's own useFrame
      clock.observeHeartScale(lastScale); // reads the scale the heart set last frame
      heart += (dt * bpm) / 60; // the heart's useFrame
      lastScale = beatScale(heart);
    }
    return phaseError(clock.phase, wrapPhase(heart));
  }

  it('phase-locks onto an independently running heartbeat', () => {
    for (const offset of [0.12, 0.27, 0.45, 0.8]) {
      for (const [fps, bpm] of [
        [60, 72],
        [30, 110],
        [144, 50],
      ] as const) {
        expect(Math.abs(simulateLock(offset, fps, bpm, 12))).toBeLessThan(PLL_DEADBAND + (1.5 * bpm) / 60 / fps);
      }
    }
  });

  it('stays put when it already drives the heart (no jitter once locked)', () => {
    const clock = new CardiacClock();
    clock.reset(0, 72);
    let expected = 0;
    let lastScale = beatScale(0);
    for (let i = 1; i <= 600; i += 1) {
      clock.tick(1 / 60, i);
      expected += 72 / 60 / 60;
      clock.observeHeartScale(lastScale);
      lastScale = beatScale(clock.beats); // the heart reads the clock
    }
    expect(clock.beats).toBeCloseTo(expected, 9);
  });

  it('free-runs when the heart does not beat', () => {
    const clock = new CardiacClock();
    clock.reset(0, 60);
    for (let i = 1; i <= 120; i += 1) {
      clock.tick(1 / 60, i);
      clock.observeHeartScale(1);
    }
    expect(clock.beats).toBeCloseTo(2, 9);
  });
});
