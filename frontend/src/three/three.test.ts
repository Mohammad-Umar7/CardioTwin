import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  APEX_AXIS,
  PROCEDURAL_VESSELS,
  buildHeartGeometry,
  buildTaperedTube,
  directionAt,
  surfacePoint,
  vesselCurve,
} from './anatomy/proceduralGeometry';
import { SYSTOLE_SCALE, beatScale, clampHeartRate } from './anatomy/heartbeat';
import { PROJECTIONS, cycleProjection, formatCarm, fromControlsAngles, toControlsAngles } from './camera/presets';
import { getRiskLUT } from './riskLut';

describe('procedural heart follows the scene conventions (CONTRACTS §6.1)', () => {
  it('is centred on the heart-wall bounding box', () => {
    const geo = buildHeartGeometry(48, 32);
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new Vector3());
    expect(c.length()).toBeLessThan(0.02);
    // ~12 cm long heart at 1 unit = 10 cm
    const size = geo.boundingBox!.getSize(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.9);
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.6);
  });

  it('points the apex to the patient left (+X), inferior (−Y) and anterior (+Z)', () => {
    const apex = surfacePoint(APEX_AXIS);
    expect(apex.x).toBeGreaterThan(0);
    expect(apex.y).toBeLessThan(0);
    expect(apex.z).toBeGreaterThan(0);
  });

  it('places the LAD anteriorly and the RCA on the patient right', () => {
    const lad = surfacePoint(directionAt(0.2, -5));
    const rca = surfacePoint(directionAt(-0.5, 84));
    expect(lad.z).toBeGreaterThan(0.2);
    expect(rca.x).toBeLessThan(0);
  });

  it('builds a tapered tube with an _ARCLEN attribute from 0 to 1', () => {
    const lad = PROCEDURAL_VESSELS.find((v) => v.node === 'Coronary_LAD')!;
    const tube = buildTaperedTube(vesselCurve(lad), 0.02, 0.01, 16, 6);
    const arc = tube.getAttribute('_ARCLEN');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < arc.count; i += 1) {
      min = Math.min(min, arc.getX(i));
      max = Math.max(max, arc.getX(i));
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
  });

  it('maps every procedural vessel to a contract target or to "not predicted"', () => {
    for (const v of PROCEDURAL_VESSELS) expect([null, 'LAD', 'LCX', 'RCA']).toContain(v.target);
    expect(PROCEDURAL_VESSELS.find((v) => v.node === 'Coronary_LM')?.target).toBeNull();
  });
});

describe('heartbeat', () => {
  it('contracts to 0.97 at end-systole and relaxes back to 1', () => {
    expect(beatScale(0)).toBeCloseTo(1, 6);
    expect(beatScale(0.35)).toBeCloseTo(SYSTOLE_SCALE, 6);
    expect(beatScale(0.9999)).toBeCloseTo(1, 3);
    for (let x = 0; x < 1; x += 0.01) {
      expect(beatScale(x)).toBeGreaterThanOrEqual(SYSTOLE_SCALE - 1e-9);
      expect(beatScale(x)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('clamps the rate to 40–140 bpm', () => {
    expect(clampHeartRate(20)).toBe(40);
    expect(clampHeartRate(200)).toBe(140);
    expect(clampHeartRate('x')).toBe(72);
  });
});

describe('C-arm projections', () => {
  it('round-trips angles through camera-controls conventions', () => {
    const { azimuth, polar } = toControlsAngles(-30, 25);
    const back = fromControlsAngles(azimuth, polar);
    expect(back.azimuth).toBeCloseTo(-30, 6);
    expect(back.elevation).toBeCloseTo(25, 6);
  });

  it('reads out RAO / LAO and CRA / CAU', () => {
    expect(formatCarm(-30, 25)).toBe('RAO 30° · CRA 25°');
    expect(formatCarm(40, 0)).toBe('LAO 40°');
    expect(formatCarm(0, -20)).toBe('AP · CAU 20°');
  });

  it('cycles projections in both directions', () => {
    expect(cycleProjection(null, 1).id).toBe(PROJECTIONS[0]!.id);
    expect(cycleProjection('AP', -1).id).toBe(PROJECTIONS[PROJECTIONS.length - 1]!.id);
  });
});

describe('risk LUT texture', () => {
  it('is a 256×1 sRGB RGBA8 texture', () => {
    const lut = getRiskLUT();
    expect(lut.image.width).toBe(256);
    expect(lut.image.height).toBe(1);
    expect(lut.colorSpace).toBe('srgb');
  });
});
