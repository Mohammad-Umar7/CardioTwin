import { describe, expect, it } from 'vitest';
import { GRADIENT_RANGE, NOISE_PERIOD, NOISE_SIZE, bakeNoiseVolume, noiseAt } from './noiseTexture';

// Rebuild the lattice the same way the module does, through its public sampling function.
const values = (() => {
  // noiseAt only needs a lattice; derive one deterministic lattice for the maths checks.
  const n = NOISE_PERIOD;
  const v = new Float32Array(n * n * n);
  for (let i = 0; i < v.length; i += 1) v[i] = Math.sin(i * 12.9898) * 0.9;
  return v;
})();

describe('baked 3D noise volume', () => {
  it('is periodic over the lattice (tiles seamlessly)', () => {
    for (const [x, y, z] of [
      [0.3, 1.7, 2.2],
      [5.9, 0.1, 7.4],
    ]) {
      const a = noiseAt(values, x!, y!, z!);
      const b = noiseAt(values, x! + NOISE_PERIOD, y! - NOISE_PERIOD, z! + 2 * NOISE_PERIOD);
      for (let k = 0; k < 4; k += 1) expect(b[k]).toBeCloseTo(a[k]!, 6);
    }
  });

  it('stores the analytic gradient of the value channel', () => {
    const h = 1e-4;
    for (const [x, y, z] of [
      [0.37, 1.21, 2.9],
      [4.44, 6.1, 0.73],
    ]) {
      const [, gx, gy, gz] = noiseAt(values, x!, y!, z!);
      const fd = (dx: number, dy: number, dz: number) =>
        (noiseAt(values, x! + dx, y! + dy, z! + dz)[0] - noiseAt(values, x! - dx, y! - dy, z! - dz)[0]) / (2 * h);
      expect(gx).toBeCloseTo(fd(h, 0, 0), 3);
      expect(gy).toBeCloseTo(fd(0, h, 0), 3);
      expect(gz).toBeCloseTo(fd(0, 0, h), 3);
      expect(Math.max(Math.abs(gx), Math.abs(gy), Math.abs(gz))).toBeLessThan(GRADIENT_RANGE);
    }
  });

  it('bakes a 32³ RGBA8 volume that uses the full value range and wraps without a seam', () => {
    const vol = bakeNoiseVolume(7);
    expect(vol.length).toBe(NOISE_SIZE ** 3 * 4);
    let min = 255;
    let max = 0;
    for (let i = 0; i < vol.length; i += 4) {
      min = Math.min(min, vol[i]!);
      max = Math.max(max, vol[i]!);
    }
    expect(max - min).toBeGreaterThan(150);
    // Neighbours across the wrap differ no more than neighbours inside the volume.
    const at = (x: number, y: number, z: number) => vol[(x + NOISE_SIZE * (y + NOISE_SIZE * z)) * 4]!;
    let inside = 0;
    let across = 0;
    for (let y = 0; y < NOISE_SIZE; y += 1) {
      inside = Math.max(inside, Math.abs(at(1, y, 5) - at(0, y, 5)));
      across = Math.max(across, Math.abs(at(0, y, 5) - at(NOISE_SIZE - 1, y, 5)));
    }
    expect(across).toBeLessThanOrEqual(inside + 40);
  });
});
