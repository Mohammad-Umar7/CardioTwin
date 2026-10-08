import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest } from '@/types/contracts';
import {
  FALLBACK_TORSO,
  HERO_OVERHANG,
  cubicBezier,
  dollyAt,
  easeDolly,
  heroPose,
  heroSway,
  orbitDirection,
  torsoFrame,
  type DollyPose,
} from './heroCamera';

const FOV = 30;
const NONE = { left: 0, right: 0, top: 0, bottom: 0 };
const T = Math.tan((FOV * Math.PI) / 360);

/** Scene units per CSS px at the target's depth for a camera `distance` away from it. */
const pxPerUnit = (height: number, distance: number) => height / (2 * T * distance);

const MANIFEST = {
  targets: { CAD: ['Heart_Wall_Anterior'] },
  structures: [
    { node: 'Skin_Torso', bbox: { min: [-2.1, -2.6, -1.5], max: [1.7, 1.6, 1.0] } },
    { node: 'Heart_Wall_Anterior', bbox: { min: [-0.55, -0.52, -0.3], max: [0.55, 0.5, 0.55] } },
  ],
} as unknown as AnatomyManifest;

describe('hero framing', () => {
  it('frames the torso from just above the shoulders to the lower rib cage', () => {
    const frame = torsoFrame(MANIFEST);
    expect(frame.left).toBeCloseTo(-2.1, 6);
    expect(frame.right).toBeCloseTo(1.7, 6);
    expect(frame.top).toBeGreaterThan(1.6);
    // Below the heart walls, above the skin's own crop.
    expect(frame.bottom).toBeLessThan(-0.52);
    expect(frame.bottom).toBeGreaterThan(-2.6);
    expect(torsoFrame(null)).toEqual(FALLBACK_TORSO);
  });

  it('fills the free height with the torso span on a wide stage, centred on the torso', () => {
    const frame = FALLBACK_TORSO;
    const pose = heroPose({ frame, fov: FOV, width: 2400, height: 800, insets: { ...NONE, left: 800 } });
    expect(pose.target.x).toBeCloseTo((frame.left + frame.right) / 2, 6);
    expect(pose.target.y).toBeCloseTo((frame.top + frame.bottom) / 2, 6);
    expect(pxPerUnit(800, pose.distance) * (frame.top - frame.bottom)).toBeCloseTo(800, 3);
  });

  it('fits the shoulders to a narrow free area instead, and lets phones crop at the shoulders', () => {
    const frame = FALLBACK_TORSO;
    const across = frame.right - frame.left;
    const desk = heroPose({ frame, fov: FOV, width: 1440, height: 824, insets: { ...NONE, left: 700 } });
    expect(pxPerUnit(824, desk.distance) * across).toBeCloseTo((1440 - 700) * HERO_OVERHANG.wide, 3);
    const phone = heroPose({ frame, fov: FOV, width: 390, height: 640, insets: NONE });
    expect(pxPerUnit(640, phone.distance) * across).toBeCloseTo(390 * HERO_OVERHANG.narrow, 3);
  });

  it('never returns a broken pose for an unmeasured canvas', () => {
    const pose = heroPose({ frame: FALLBACK_TORSO, fov: FOV, width: 0, height: 0, insets: NONE });
    expect(Number.isFinite(pose.distance)).toBe(true);
    expect(pose.distance).toBeGreaterThan(0);
  });
});

describe('hero idle motion', () => {
  it('sways a few degrees around the rest pose, starting from it', () => {
    expect(heroSway(0)).toEqual({ azimuth: 0, elevation: 0 });
    for (let t = 0; t < 120; t += 0.7) {
      const s = heroSway(t);
      expect(Math.abs(s.azimuth)).toBeLessThanOrEqual((3 * Math.PI) / 180 + 1e-9);
      expect(Math.abs(s.elevation)).toBeLessThanOrEqual((0.8 * Math.PI) / 180 + 1e-9);
    }
  });

  it('orbits a direction about +Y and lifts it, keeping it a unit vector', () => {
    const base = new Vector3(0, 0.12, 1).normalize();
    expect(orbitDirection(base, 0, 0).distanceTo(base)).toBeLessThan(1e-9);
    const turned = orbitDirection(base, 0.1, 0);
    expect(turned.length()).toBeCloseTo(1, 9);
    expect(turned.y).toBeCloseTo(base.y, 9);
    expect(turned.x).toBeGreaterThan(0);
    expect(orbitDirection(base, 0, 0.1).y).toBeGreaterThan(base.y);
  });
});

describe('hero dolly', () => {
  it('eases from 0 to 1 monotonically, under way early and landing softly', () => {
    expect(easeDolly(0)).toBe(0);
    expect(easeDolly(1)).toBe(1);
    let last = 0;
    for (let u = 0.01; u <= 1; u += 0.01) {
      const k = easeDolly(u);
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      last = k;
    }
    expect(easeDolly(0.2)).toBeGreaterThan(0.04);
    expect(easeDolly(0.2)).toBeLessThan(0.2);
    // The last fifth moves less than a twentieth of the way: a soft landing, no snap.
    expect(1 - easeDolly(0.8)).toBeLessThan(0.05);
  });

  it('solves CSS cubic-bezier curves (linear and ease)', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 5);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });

  const from: DollyPose = { target: new Vector3(-0.2, -0.1, 0), direction: new Vector3(0, 0.12, 1).normalize(), distance: 7, offset: { x: 320, y: 0 } };
  const to: DollyPose = { target: new Vector3(0, 0, 0), direction: new Vector3(0.24, 0.19, 0.95).normalize(), distance: 3.5, offset: { x: -36, y: -26 } };

  it('starts on the live pose and lands exactly on the workstation pose', () => {
    const start = dollyAt(from, to, 0);
    expect(start.target.distanceTo(from.target)).toBeLessThan(1e-9);
    expect(start.direction.distanceTo(from.direction)).toBeLessThan(1e-9);
    expect(start.distance).toBeCloseTo(7, 9);
    expect(start.offset).toEqual({ x: 320, y: 0 });
    const end = dollyAt(from, to, 1);
    expect(end.target.distanceTo(to.target)).toBeLessThan(1e-9);
    expect(end.direction.distanceTo(to.direction)).toBeLessThan(1e-9);
    expect(end.distance).toBeCloseTo(3.5, 9);
    expect(end.offset.x).toBeCloseTo(-36, 9);
    expect(end.offset.y).toBeCloseTo(-26, 9);
  });

  it('zooms at a constant rate (log-linear distance) on a unit direction', () => {
    const mid = dollyAt(from, to, 0.5);
    expect(mid.distance).toBeCloseTo(Math.sqrt(7 * 3.5), 9);
    expect(mid.direction.length()).toBeCloseTo(1, 9);
    // The direction turns by half the angle at the midpoint (slerp).
    const angle = (a: Vector3, b: Vector3) => Math.acos(Math.min(1, a.dot(b)));
    expect(angle(from.direction, mid.direction)).toBeCloseTo(angle(from.direction, to.direction) / 2, 6);
  });
});
