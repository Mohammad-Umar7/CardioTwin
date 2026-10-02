import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_HEIGHT,
  BEAT_VERTEX_PARS,
  atrialWeight,
  beatDisplace,
  heightOf,
  longitudinalProfile,
  lvContractedRadius,
  lvRadii,
  twistProfile,
} from './beatDeform';
import { LV_ENDO_SAMPLES, heartFrameFrom } from './explode';
import {
  ATRIAL_SHARE,
  BEAT_AMPLITUDE,
  DEFAULT_PROFILE,
  DIASTASIS_SHARE,
  PHASES,
  PHASE_INTERVALS,
  SYSTOLE_FRACTION,
  SYSTOLE_SCALE,
  atrial,
  beatProfileFrom,
  beatScale,
  beatState,
  clampHeartRate,
  diastasisShareFor,
  inDiastole,
  phaseDurations,
  twist,
  ventricular,
} from './heartbeat';

const samples = (n = 2000) => Array.from({ length: n }, (_, i) => i / n);
/** Largest change of the slope across x (a kink), from one-sided differences of step h. */
const kink = (f: (x: number) => number, x: number, h = 1e-5) => Math.abs((f(x + h) - f(x)) / h - (f(x) - f(x - h)) / h);

describe('physiological heartbeat curves', () => {
  it('is at end-diastole at the onset of systole and fully contracted at end-systole', () => {
    expect(ventricular(0)).toBeCloseTo(0, 9);
    expect(ventricular(SYSTOLE_FRACTION)).toBeCloseTo(1, 9);
    for (const x of samples()) {
      expect(ventricular(x)).toBeLessThanOrEqual(1 + 1e-12);
      expect(ventricular(x)).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('peaks exactly at end-systole (ventricular systole ≈ a third of the cycle)', () => {
    let best = -Infinity;
    let at = 0;
    for (const x of samples(10000)) {
      const v = ventricular(x);
      if (v > best) {
        best = v;
        at = x;
      }
    }
    expect(at).toBeCloseTo(SYSTOLE_FRACTION, 3);
    expect(SYSTOLE_FRACTION).toBeGreaterThan(0.3);
    expect(SYSTOLE_FRACTION).toBeLessThan(0.4);
  });

  it('empties through ejection and only refills through diastole: the ventricles never shrink before systole', () => {
    let prev = -Infinity;
    for (let x = 0; x <= SYSTOLE_FRACTION; x += 0.0005) {
      const v = ventricular(x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    prev = Infinity;
    for (let x = SYSTOLE_FRACTION; x < 1; x += 0.0005) {
      const v = ventricular(x);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    // end-diastole (the fullest) is reached at mitral closure, at the very end of the atrial kick
    expect(ventricular(1 - 1e-9)).toBeCloseTo(0, 6);
  });

  it('refills most in rapid filling, little in diastasis and the rest in the atrial kick', () => {
    const drop = (a: number, b: number, share = ATRIAL_SHARE) => ventricular(a, share) - ventricular(b, share);
    expect(drop(PHASES.mitralOpening, PHASES.endRapidFilling)).toBeGreaterThan(0.55);
    expect(drop(PHASES.endRapidFilling, PHASES.atrialOnset)).toBeCloseTo(DIASTASIS_SHARE, 9);
    expect(drop(PHASES.atrialOnset, 1 - 1e-12)).toBeCloseTo(ATRIAL_SHARE, 6);
    // an older heart leans on its atria: a larger atrial share leaves less for the E wave
    expect(drop(PHASES.atrialOnset, 1 - 1e-12, 0.4)).toBeCloseTo(0.4, 6);
    expect(drop(PHASES.mitralOpening, PHASES.endRapidFilling, 0.4)).toBeLessThan(drop(PHASES.mitralOpening, PHASES.endRapidFilling));
  });

  it('ejects and fills fast early (peak rate in the first half of each), and holds its volume isovolumically', () => {
    const rateAt = (x: number) => (ventricular(x + 1e-5) - ventricular(x)) / 1e-5;
    const peakOf = (a: number, b: number) => {
      let best = 0;
      let at = a;
      for (let x = a; x < b; x += (b - a) / 400) {
        const r = Math.abs(rateAt(x));
        if (r > best) {
          best = r;
          at = x;
        }
      }
      return (at - a) / (b - a);
    };
    expect(peakOf(PHASES.isovolumicContraction, PHASES.endSystole)).toBeLessThan(0.45);
    expect(peakOf(PHASES.mitralOpening, PHASES.endRapidFilling)).toBeLessThan(0.45);
    expect(ventricular(PHASES.isovolumicContraction)).toBeLessThan(0.06);
    expect(1 - ventricular(PHASES.mitralOpening)).toBeLessThan(0.05);
  });

  it('contracts the atria through the A wave, holds to mitral closure and lets go early in systole', () => {
    for (const x of samples()) {
      expect(atrial(x)).toBeGreaterThanOrEqual(0);
      expect(atrial(x)).toBeLessThanOrEqual(1);
      if (x > 0.13 && x < PHASES.atrialOnset) expect(atrial(x)).toBe(0);
    }
    expect(atrial(PHASES.atrialPeak)).toBeCloseTo(1, 9);
    expect(atrial(0.999)).toBe(1);
    expect(atrial(0)).toBeCloseTo(1, 9);
    expect(atrial(0.06)).toBeGreaterThan(0.2);
    expect(atrial(0.06)).toBeLessThan(0.8);
  });

  it('twists with ejection and untwists well ahead of the volume (~40 % within isovolumic relaxation)', () => {
    expect(twist(SYSTOLE_FRACTION)).toBeCloseTo(1, 9);
    expect(twist(0.2)).toBeCloseTo(ventricular(0.2), 9);
    const ivr = 1 - twist(PHASES.mitralOpening);
    expect(ivr).toBeGreaterThan(0.3);
    expect(ivr).toBeLessThan(0.55);
    expect(twist(0.5)).toBeLessThan(0.1);
    expect(twist(0.56)).toBe(0);
    for (const x of samples()) if (x > SYSTOLE_FRACTION) expect(twist(x)).toBeLessThanOrEqual(ventricular(x) + 1e-12);
  });

  it('is continuous and smooth (no kink) everywhere, including across the wrap from one beat to the next', () => {
    const eps = 1e-6;
    for (const x of [...samples(400), 0.999999]) {
      expect(Math.abs(ventricular(x + eps) - ventricular(x))).toBeLessThan(1e-3);
      expect(Math.abs(atrial(x + eps) - atrial(x))).toBeLessThan(1e-3);
      expect(Math.abs(twist(x + eps) - twist(x))).toBeLessThan(1e-3);
    }
    for (const x of [1, ...PHASE_INTERVALS.map(([a]) => a).slice(1), PHASES.atrialPeak, 0.12, 0.55]) {
      expect(kink(ventricular, x)).toBeLessThan(0.05);
      expect(kink(atrial, x)).toBeLessThan(0.05);
      expect(kink(twist, x)).toBeLessThan(0.05);
    }
    expect(ventricular(2.35)).toBeCloseTo(ventricular(0.35), 9);
  });

  it('keeps the legacy scalar within 0.97–1 for the procedural heart and the fx phase lock', () => {
    expect(beatScale(0)).toBeCloseTo(1, 6);
    expect(beatScale(SYSTOLE_FRACTION)).toBeCloseTo(SYSTOLE_SCALE, 6);
    for (const x of samples()) {
      expect(beatScale(x)).toBeGreaterThanOrEqual(SYSTOLE_SCALE - 1e-9);
      expect(beatScale(x)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(inDiastole(0.2)).toBe(false);
    expect(inDiastole(0.5)).toBe(true);
  });

  it('settles to the resting shape when the envelope is off, and scales the contraction by the patient', () => {
    expect(beatState(0.3, 0)).toEqual({ v: 0, a: 0, t: 0 });
    expect(beatState(0.3, 1).v).toBeCloseTo(ventricular(0.3), 12);
    const weak = beatState(0.3, 1, { atrialShare: ATRIAL_SHARE, contractility: 0.5 });
    expect(weak.v).toBeCloseTo(0.5 * ventricular(0.3), 12);
    expect(weak.t).toBeCloseTo(0.5 * twist(0.3), 12);
    expect(weak.a).toBeCloseTo(atrial(0.3), 12);
  });

  it('clamps the rate to 40–140 bpm', () => {
    expect(clampHeartRate(20)).toBe(40);
    expect(clampHeartRate(200)).toBe(140);
    expect(clampHeartRate('x')).toBe(72);
  });
});

describe("the beat at the patient's rate (real interval durations)", () => {
  const at = (bpm: number) => phaseDurations({ ...DEFAULT_PROFILE, bpm });
  const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);

  it('fills exactly one RR interval at any rate, every interval non-negative', () => {
    for (const bpm of [40, 55, 72, 90, 110, 140]) {
      const d = at(bpm);
      expect(d).toHaveLength(PHASE_INTERVALS.length);
      expect(sum(d)).toBeCloseTo(60 / bpm, 9);
      for (const x of d) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps systole near its resting length while diastole absorbs the rate (Weissler LVET)', () => {
    const systole = (bpm: number) => at(bpm)[0]! + at(bpm)[1]!;
    expect(systole(72)).toBeGreaterThan(0.31);
    expect(systole(72)).toBeLessThan(0.36);
    // from 60 to 120 bpm the RR halves; systole loses only ~a third, diastole far more
    const s60 = systole(60);
    const s120 = systole(120);
    expect(s120 / s60).toBeGreaterThan(0.6);
    const d60 = 1 - s60;
    const d120 = 0.5 - s120;
    expect(d120 / d60).toBeLessThan(0.45);
    // the systolic share of the cycle grows with the rate
    expect(systole(120) / 0.5).toBeGreaterThan(systole(60) / 1);
  });

  it('runs out of diastasis first, then shortens the E and A waves together (fusion at high rates)', () => {
    const [, , , e72, dia72, a72] = at(72);
    expect(dia72).toBeGreaterThan(0.05);
    const [, , , e140, dia140, a140] = at(140);
    expect(dia140).toBeLessThan(0.015);
    expect(e140! / e72!).toBeCloseTo(a140! / a72!, 6);
    expect(e140).toBeLessThan(e72!);
  });

  it('scales the slow filling with the diastasis, so fast rates do not jump it', () => {
    expect(diastasisShareFor(at(50)[4]!)).toBeCloseTo(DIASTASIS_SHARE, 9);
    expect(diastasisShareFor(at(140)[4]!)).toBeLessThan(0.006);
    expect(diastasisShareFor(0)).toBe(0);
    // with no slow filling the E wave hands straight over to the atrial kick
    expect(ventricular(PHASES.endRapidFilling, ATRIAL_SHARE, 0)).toBeCloseTo(ventricular(PHASES.atrialOnset, ATRIAL_SHARE, 0), 9);
  });

  it('lengthens isovolumic relaxation with age and hypertension', () => {
    const ivrt = (age: number, hypertension: boolean) => phaseDurations({ bpm: 70, age, hypertension, female: false })[2]!;
    expect(ivrt(30, false)).toBeGreaterThan(0.06);
    expect(ivrt(70, false)).toBeGreaterThan(ivrt(30, false));
    expect(ivrt(58, true)).toBeGreaterThan(ivrt(58, false));
    expect(ivrt(58, true)).toBeLessThan(0.12);
  });

  it('reads the profile from the cohort inputs, with safe defaults', () => {
    const p = beatProfileFrom({ Age: 58, HTN: 1, Sex: 'Male', PR: 70, 'EF-TTE': 50 });
    expect(p.bpm).toBe(70);
    expect(p.hypertension).toBe(true);
    expect(p.female).toBe(false);
    expect(p.contractility).toBeCloseTo(50 / 58, 9);
    expect(p.atrialShare).toBeGreaterThan(beatProfileFrom({ Age: 30 }).atrialShare);
    expect(beatProfileFrom({ 'EF-TTE': 20 }).contractility).toBeCloseTo(0.35, 9);
    expect(beatProfileFrom({ Sex: 'Female' }).female).toBe(true);
    const d = beatProfileFrom(null);
    expect(d.bpm).toBe(72);
    expect(d.contractility).toBe(1);
  });
});

describe('beat deformation (one field in the rest frame)', () => {
  const frame = heartFrameFrom({ apex: [0.47, -0.42, 0.36], base_center: [-0.09, -0.13, 0] });
  const L = frame.length;
  const side = new Vector3(0, 0, 1).cross(frame.axis).normalize();
  const side2 = new Vector3().crossVectors(frame.axis, side).normalize();
  /** Rest-frame point at normalised height h, radius r (fraction of L) and angle θ about the long axis. */
  const at = (h: number, r = 0, theta = 0) =>
    frame.apex
      .clone()
      .addScaledVector(frame.axis, h * L)
      .addScaledVector(side, Math.cos(theta) * r * L)
      .addScaledVector(side2, Math.sin(theta) * r * L);
  const move = (p: Vector3, v: number, a = 0, w = 1, t = v) => beatDisplace(frame, v, a, p, new Vector3(), w, t);

  it('is the identity at rest and for meshes that stay still', () => {
    for (const p of [at(0.5, 0.3), at(1.4, 0.2, 1), at(2.2, 0.4, 2)]) {
      expect(move(p, 0, 0).distanceTo(p)).toBeLessThan(1e-12);
      expect(move(p, 1, 0, 0).distanceTo(p)).toBeLessThan(1e-12);
    }
  });

  it('moves the AV plane toward a still apex in systole (MAPSE), along the long axis', () => {
    const base = move(frame.base, 1);
    const shift = base.distanceTo(frame.base);
    // 13 % of the apex-to-base length (the atrial swell adds a little at the plane's centre): 9–10 mm here.
    expect(shift / (BEAT_AMPLITUDE.longitudinal * L)).toBeGreaterThan(0.99);
    expect(shift / (BEAT_AMPLITUDE.longitudinal * L)).toBeLessThan(1.06);
    expect(base.clone().sub(frame.base).normalize().dot(frame.axis)).toBeCloseTo(-1, 9);
    expect(move(frame.apex, 1).distanceTo(frame.apex)).toBeLessThan(1e-12);
  });

  it('stretches the atria between the descending AV plane and their still roof and venous entries', () => {
    const roof = at(ANCHOR_HEIGHT + 0.05, 0.1);
    expect(move(roof, 1).distanceTo(roof)).toBeLessThan(1e-12);
    const plane = at(1);
    const mid = at(1.45);
    expect(move(mid, 1).distanceTo(move(plane, 1))).toBeGreaterThan(mid.distanceTo(plane));
    expect(longitudinalProfile(0)).toBe(0);
    expect(longitudinalProfile(1)).toBe(1);
    expect(longitudinalProfile(ANCHOR_HEIGHT)).toBe(0);
  });

  it('pulls the ventricular wall in toward the long axis while the atria swell', () => {
    const p = at(0.5, 0.35);
    const c = at(0.5);
    const ratio = move(p, 1).sub(move(c, 1)).length() / p.distanceTo(c);
    expect(ratio).toBeCloseTo(1 - BEAT_AMPLITUDE.radial, 9);
    const pa = at(1.3, 0.3);
    const ca = at(1.3);
    expect(move(pa, 1).sub(move(ca, 1)).length()).toBeGreaterThan(pa.distanceTo(ca));
  });

  it('twists the apex counter-clockwise and the base clockwise, viewed from the apex', () => {
    const turn = (h: number) => {
      const p = at(h, 0.3, 0.7);
      const c = at(h);
      const r0 = p.clone().sub(c);
      const r1 = move(p, 1).sub(move(c, 1));
      // Right-handed about apex → base; looking from the apex (along +axis) a negative turn is counter-clockwise.
      return Math.atan2(frame.axis.dot(r0.clone().cross(r1)), r0.dot(r1));
    };
    expect(turn(0.1)).toBeLessThan(0);
    expect(turn(0.95)).toBeGreaterThan(0);
    const net = BEAT_AMPLITUDE.twistApexDeg + BEAT_AMPLITUDE.twistBaseDeg;
    expect(net).toBeGreaterThanOrEqual(10);
    expect(net).toBeLessThanOrEqual(16);
    expect(twistProfile(2)).toBe(0);
  });

  it('is continuous everywhere, so meshes that touch at rest still touch through the whole beat', () => {
    const eps = 1e-4 * L;
    let worst = 0;
    for (let i = 0; i < 4000; i += 1) {
      const h = -0.2 + (2.6 * i) / 4000;
      const p = at(h, 0.05 + ((i * 37) % 100) / 200, i * 0.61);
      const d = new Vector3(Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 2.1)).normalize().multiplyScalar(eps);
      const q = p.clone().add(d);
      for (const [v, a, t] of [
        [1, 0, 1],
        [0.5, 0, 0.5],
        [0.97, 0, 0.55],
        [0, 1, 0],
      ] as const) {
        worst = Math.max(worst, move(q, v, a, 1, t).sub(move(p, v, a, 1, t)).sub(d).length() / eps);
      }
    }
    // Two points eps apart drift apart by less than eps anywhere (apex, AV plane, atria, anchors): no tearing.
    expect(worst).toBeLessThan(1);
  });

  it('blends linearly with a vessel weight, so a junction at weight 1 moves exactly with its chamber', () => {
    const p = at(1.6, 0.25, 0.3);
    expect(move(p, 1, 0, 0.5).distanceTo(p.clone().lerp(move(p, 1), 0.5))).toBeLessThan(1e-12);
  });

  it('squeezes the atria in the kick while the AV plane rises back to end-diastole (the A wave)', () => {
    const p = at(1.3, 0.3);
    const c = at(1.22);
    expect(move(p, 0, 1).distanceTo(move(c, 0, 1))).toBeLessThan(p.distanceTo(c));
    // diastasis (the atrial share of the filling still to come) -> end-diastole: the base moves back up the axis
    const before = move(frame.base, ATRIAL_SHARE, 0).sub(frame.base).dot(frame.axis);
    const after = move(frame.base, 0, 1).sub(frame.base).dot(frame.axis);
    expect(after).toBeGreaterThan(before);
  });

  it('turns with its own twist activation: untwisted, the base still descends', () => {
    const p = at(0.2, 0.3, 0.7);
    const c = at(0.2);
    const r0 = p.clone().sub(c);
    const turned = move(p, 0.97, 0, 1, 1).sub(move(c, 0.97, 0, 1, 1));
    const recoiled = move(p, 0.97, 0, 1, 0).sub(move(c, 0.97, 0, 1, 0));
    const angle = (r1: Vector3) => Math.atan2(frame.axis.dot(r0.clone().cross(r1)), r0.dot(r1));
    expect(Math.abs(angle(turned))).toBeGreaterThan(0.05);
    expect(Math.abs(angle(recoiled))).toBeLessThan(1e-9);
    expect(move(frame.base, 0.97, 0, 1, 0).distanceTo(frame.base)).toBeGreaterThan(0);
  });

  it('weights the atrial terms to the atria only', () => {
    expect(atrialWeight(0.2)).toBe(0);
    expect(atrialWeight(1.3)).toBeCloseTo(1, 6);
    expect(atrialWeight(2.2)).toBe(0);
    expect(heightOf(frame, frame.base)).toBeCloseTo(1, 9);
    expect(heightOf(frame, frame.apex)).toBeCloseTo(0, 9);
  });

  it('compiles the same constants into the shader as the CPU twin uses', () => {
    expect(BEAT_VERTEX_PARS).toContain(`CT_LONG = ${BEAT_AMPLITUDE.longitudinal}`);
    expect(BEAT_VERTEX_PARS).toContain(`CT_RAD = ${BEAT_AMPLITUDE.radial}`);
    expect(BEAT_VERTEX_PARS).toContain(`CT_LV_AREA = ${BEAT_AMPLITUDE.lvArea}`);
    expect(BEAT_VERTEX_PARS).toContain(`uLvEndo[${LV_ENDO_SAMPLES}]`);
    expect(BEAT_VERTEX_PARS).toContain(`CT_ANCHOR = ${ANCHOR_HEIGHT}`);
    expect(BEAT_VERTEX_PARS).not.toMatch(/\$\{/);
  });
});

describe('LV wall thickening (the LV frame)', () => {
  // A cavity along the heart's own axis (so twist and AV-plane descent move a radial line rigidly): 24 mm across at
  // the base, narrowing to the apex, in a 9 mm wall.
  const n = LV_ENDO_SAMPLES - 1;
  const endo = Array.from({ length: LV_ENDO_SAMPLES }, (_, i) => 0.24 * Math.sqrt(i / n));
  const epi = endo.map((r) => r + 0.09);
  const apex = [0.47, -0.42, 0.36];
  const base = [-0.09, -0.13, 0];
  const lvOf = (e: unknown, o: unknown) => ({ apex, mitral_center: base, endo_radius: e, epi_radius: o });
  const frame = heartFrameFrom({ apex, base_center: base, lv: lvOf(endo, epi) });
  const L = frame.length;
  const side = new Vector3(0, 0, 1).cross(frame.axis).normalize();
  const side2 = new Vector3().crossVectors(frame.axis, side).normalize();
  const at = (h: number, r = 0, theta = 0) =>
    frame.apex
      .clone()
      .addScaledVector(frame.axis, h * L)
      .addScaledVector(side, Math.cos(theta) * r)
      .addScaledVector(side2, Math.sin(theta) * r);
  const move = (p: Vector3, v: number, a = 0, w = 1, t = v) => beatDisplace(frame, v, a, p, new Vector3(), w, t);
  /** Distance of a moved point from the moved axis at the same height. */
  const radius = (h: number, r: number, v: number, theta = 0.4) => move(at(h, r, theta), v).distanceTo(move(at(h), v));
  const outer = 1 - BEAT_AMPLITUDE.radial; // the whole heart's own inward motion at mid-ventricle
  const k = BEAT_AMPLITUDE.lvArea;

  it('reads the LV frame from the manifest, and ignores a malformed one', () => {
    expect(frame.lv?.endo).toHaveLength(LV_ENDO_SAMPLES);
    expect(frame.lv?.axis.dot(frame.axis)).toBeCloseTo(1, 9);
    expect(heartFrameFrom({ apex, base_center: base, lv: lvOf([0.1, 0.2], epi) }).lv).toBeUndefined();
    expect(heartFrameFrom({ apex, base_center: base, lv: lvOf(endo, undefined) }).lv).toBeUndefined();
    expect(heartFrameFrom({ apex, base_center: base }).lv).toBeUndefined();
    const [re, ro] = lvRadii(frame.lv!, 0.5);
    expect(re).toBeCloseTo(0.24 * Math.sqrt(0.5), 2);
    expect(ro - re).toBeCloseTo(0.09, 9);
  });

  it('shrinks the cavity far more than the heart and thickens the wall, keeping the outer surface', () => {
    const h = 0.5;
    const [re, ro] = lvRadii(frame.lv!, h);
    const ri = radius(h, re, 1);
    const rw = radius(h, ro, 1);
    expect((ri * ri) / (re * re)).toBeCloseTo((1 - k) * outer * outer, 6);
    expect(rw / ro).toBeCloseTo(outer, 6);
    // the endocardium moves in several times farther than the epicardium, and the wall thickens 30–50 %
    expect(re - ri).toBeGreaterThan(2.5 * (ro - rw));
    expect((rw - ri) / (ro - re)).toBeGreaterThan(1.3);
    expect((rw - ri) / (ro - re)).toBeLessThan(1.5);
    // through the wall every ring keeps its share of the (grown) wall
    const mid = radius(h, (re + ro) / 2, 1);
    expect(mid).toBeGreaterThan(ri);
    expect(mid).toBeLessThan(rw);
  });

  it('scales what lies inside the cavity (papillary muscles, chordae) evenly toward the axis', () => {
    const h = 0.6;
    const [re, ro] = lvRadii(frame.lv!, h);
    for (const f of [0.2, 0.5, 0.9]) expect(radius(h, f * re, 1) / (f * re)).toBeCloseTo(Math.sqrt(1 - k) * outer, 6);
    // continuous at both surfaces of the wall
    expect(lvContractedRadius(re + 1e-9, re, ro, k)).toBeCloseTo(re * Math.sqrt(1 - k), 6);
    expect(lvContractedRadius(ro - 1e-9, re, ro, k)).toBeCloseTo(ro, 6);
  });

  it('moves everything outside the LV wall (the RV, the fat) only with the whole heart', () => {
    const h = 0.55;
    const [, ro] = lvRadii(frame.lv!, h);
    expect(radius(h, ro + 0.06, 1) / (ro + 0.06)).toBeCloseTo(outer, 6);
  });

  it('leaves the apex still and the atria to the atrial terms', () => {
    expect(move(frame.apex, 1).distanceTo(frame.apex)).toBeLessThan(1e-12);
    const r0 = at(1.4, 0.2).distanceTo(at(1.4));
    expect(radius(1.4, 0.2, 1)).toBeCloseTo(r0 * (1 + BEAT_AMPLITUDE.atrialReservoir * atrialWeight(1.4)), 6);
  });

  it('is continuous everywhere, so meshes that touch at rest still touch through the whole beat', () => {
    const eps = 1e-4 * L;
    let worst = 0;
    for (let i = 0; i < 4000; i += 1) {
      const h = -0.2 + (2.6 * i) / 4000;
      const p = at(h, (0.05 + ((i * 37) % 100) / 200) * L, i * 0.61);
      const d = new Vector3(Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 2.1)).normalize().multiplyScalar(eps);
      const q = p.clone().add(d);
      for (const [v, a, t] of [
        [1, 0, 1],
        [0.5, 0, 0.5],
        [0.97, 0, 0.55],
        [0, 1, 0],
      ] as const) {
        worst = Math.max(worst, move(q, v, a, 1, t).sub(move(p, v, a, 1, t)).sub(d).length() / eps);
      }
    }
    expect(worst).toBeLessThan(1);
  });
});
