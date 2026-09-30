import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { AnatomyManifest } from '@/types/contracts';
import { angleLabel, presetLabel, useCameraState } from './cameraState';
import {
  WORKSTATION_HEART_SHARE,
  easeOutCubic,
  framingDistance,
  freeArea,
  glide,
  heartBox,
  projectedSize,
  viewOffsetFor,
} from './framing';
import { CameraHistory, samePose, type Pose } from './history';
import { PROJECTIONS, toControlsAngles } from './presets';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../../public/anatomy/manifest.json'), 'utf8'),
) as AnatomyManifest;

/** V2 §4.7 at 1440×900: canvas 1440×824; cards 12 + 280 + 12 left, 12 + 352 + 12 right, toolbar 12 + 40 + 12. */
const INSETS_1440 = { left: 304, right: 376, top: 12, bottom: 64 };
/** V2 §4.7 at 1280×720: canvas 1280×656; cards 256 / 320, toolbar 36. */
const INSETS_1280 = { left: 280, right: 344, top: 12, bottom: 60 };

describe('stage view offset (V2 §4.1, §4.7)', () => {
  it('moves the orbit target to the free-area centre: (−36, −26) at 1440×900', () => {
    expect(viewOffsetFor(1440, 824, INSETS_1440)).toEqual({ x: -36, y: -26 });
  });

  it('matches the 1280×720 geometry: (−32, −24)', () => {
    expect(viewOffsetFor(1280, 656, INSETS_1280)).toEqual({ x: -32, y: -24 });
  });

  it('is zero without chrome (focus mode, parked) and for an empty canvas', () => {
    expect(viewOffsetFor(1440, 824, { left: 0, right: 0, top: 0, bottom: 0 })).toEqual({ x: 0, y: 0 });
    expect(viewOffsetFor(0, 0, INSETS_1440)).toEqual({ x: 0, y: 0 });
  });

  it('never inverts the free area on a narrow canvas', () => {
    const free = freeArea(300, 200, { left: 250, right: 250, top: 150, bottom: 150 });
    expect(free.width).toBeGreaterThanOrEqual(1);
    expect(free.height).toBeGreaterThanOrEqual(1);
  });

  it('glides over flyout with a decelerating ease and lands exactly', () => {
    const from = { x: 0, y: 0 };
    const to = { x: -36, y: -26 };
    expect(glide(from, to, 0)).toEqual(from);
    const mid = glide(from, to, 180);
    expect(mid.x).toBeLessThan(-18); // ease-out: past halfway at half time
    expect(glide(from, to, 360)).toEqual(to);
    expect(glide(from, to, 10, 0)).toEqual(to);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
});

describe('heart framing (V2 §4.1: 62 % of the free-area height)', () => {
  const box = heartBox(manifest);
  const target = new Vector3(0, 0, 0);
  const pose = manifest.camera.heart!;
  const direction = new Vector3(...(pose.position as [number, number, number])).sub(target).normalize();

  it('reads the heart walls box from the manifest (origin = heart-wall box centre)', () => {
    const c = box.getCenter(new Vector3());
    expect(c.length()).toBeLessThan(0.05);
    const s = box.getSize(new Vector3());
    expect(s.y).toBeGreaterThan(0.8);
    expect(s.y).toBeLessThan(1.4);
  });

  it('falls back to a heart-sized box without a manifest', () => {
    const fallback = heartBox(null);
    expect(fallback.isEmpty()).toBe(false);
    expect(fallback.getSize(new Vector3()).y).toBeCloseTo(1.04, 2);
  });

  for (const [name, w, h, insets] of [
    ['1440×900', 1440, 824, INSETS_1440],
    ['1280×720', 1280, 656, INSETS_1280],
  ] as const) {
    it(`puts the heart box at 62 % of the free height at ${name}`, () => {
      const free = freeArea(w, h, insets);
      const input = { box, target, direction, fov: 30, width: w, height: h, freeWidth: free.width, freeHeight: free.height, share: WORKSTATION_HEART_SHARE };
      const d = framingDistance(input);
      const size = projectedSize(input, d);
      expect(size.height / free.height).toBeCloseTo(WORKSTATION_HEART_SHARE, 2);
      expect(size.width).toBeLessThan(free.width);
      expect(d).toBeGreaterThan(2.4);
      expect(d).toBeLessThan(7);
    });
  }

  it('keeps the share in every C-arm projection', () => {
    const free = freeArea(1440, 824, INSETS_1440);
    for (const p of PROJECTIONS) {
      const { azimuth, polar } = toControlsAngles(p.azimuth, p.elevation);
      const dir = new Vector3().setFromSphericalCoords(1, polar, azimuth);
      const input = { box, target, direction: dir, fov: 30, width: 1440, height: 824, freeWidth: free.width, freeHeight: free.height, share: 0.62 };
      const size = projectedSize(input, framingDistance(input));
      expect(size.height / free.height).toBeLessThanOrEqual(0.621);
      expect(size.height / free.height).toBeGreaterThan(0.45);
    }
  });

  it('shrinks the heart to fit a narrow free area (never wider than 86 %)', () => {
    const input = { box: new Box3(new Vector3(-1, -0.2, -0.2), new Vector3(1, 0.2, 0.2)), target, direction: new Vector3(0, 0, 1), fov: 30, width: 800, height: 800, freeWidth: 400, freeHeight: 800, share: 0.62 };
    const size = projectedSize(input, framingDistance(input));
    expect(size.width / 400).toBeLessThanOrEqual(0.861);
  });
});

describe('camera history (Back / Forward)', () => {
  const pose = (x: number): Pose => ({ position: [x, 0, 4], target: [0, 0, 0] });

  it('walks back and forward and drops the forward branch on a new move', () => {
    const h = new CameraHistory();
    h.push(pose(0));
    h.push(pose(1));
    h.push(pose(2));
    expect(h.canBack).toBe(true);
    expect(h.back()?.position[0]).toBe(1);
    expect(h.back()?.position[0]).toBe(0);
    expect(h.back()).toBeNull();
    expect(h.forward()?.position[0]).toBe(1);
    h.push(pose(5));
    expect(h.canForward).toBe(false);
    expect(h.back()?.position[0]).toBe(1);
  });

  it('ignores repeats of the current pose and caps its length', () => {
    const h = new CameraHistory(3);
    expect(h.push(pose(0))).toBe(true);
    expect(h.push(pose(0.001))).toBe(false);
    h.push(pose(1));
    h.push(pose(2));
    h.push(pose(3));
    expect(h.size).toBe(3);
    expect(samePose(pose(1), pose(1.5))).toBe(false);
  });
});

describe('camera view state (View menu label)', () => {
  it('names presets, best views and free orbits', () => {
    expect(presetLabel('LAO45')).toBe('LAO 45');
    expect(angleLabel(-30, 25)).toBe('RAO 30 CRA 25');
    const s = useCameraState.getState();
    s.setView('preset', { presetId: 'RAO30CAU25' });
    expect(useCameraState.getState().viewLabel).toBe('RAO 30 / CAU 25');
    s.setView('custom');
    expect(useCameraState.getState().viewLabel).toBe('Custom');
    s.setView('home');
    expect(useCameraState.getState().viewLabel).toBe('Home');
  });
});
