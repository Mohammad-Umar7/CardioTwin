import { describe, expect, it } from 'vitest';
import { isIntegratedGpu } from './webgl';

describe('GPU class probe', () => {
  it('recognises integrated GPUs by their renderer string', () => {
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU Direct3D11)')).toBe(false);
    expect(isIntegratedGpu('Apple M2')).toBe(false);
    expect(isIntegratedGpu('')).toBe(false);
  });
});
