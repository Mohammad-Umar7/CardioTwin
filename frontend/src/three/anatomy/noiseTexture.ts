/**
 * A tileable 3D value-noise volume with its analytic gradient, baked once into a 32³ RGBA8 texture
 * (128 KB). The tissue shader samples it instead of evaluating hash-based noise per pixel: one trilinear
 * fetch per octave instead of ~120 ALU operations — the difference between 60 fps and 25 fps on an
 * integrated GPU at full-bleed resolution (§7.9 performance). Pure data generation; unit tested.
 *
 * Layout: R = value, G/B/A = ∂value/∂x, ∂y, ∂z, in LATTICE units, encoded as 0.5 + v / (2·GRADIENT_RANGE).
 * The texture spans `NOISE_PERIOD` lattice cells per axis and wraps seamlessly (REPEAT).
 */
import { Data3DTexture, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

export const NOISE_SIZE = 32;
/** Lattice cells across the texture (so 4 texels per cell). */
export const NOISE_PERIOD = 8;
/** |gradient| in lattice units never exceeds 2 · 1.875 for quintic value noise in [−1, 1]; keep headroom. */
export const GRADIENT_RANGE = 4;

function lattice(seed: number): Float32Array {
  const n = NOISE_PERIOD;
  const out = new Float32Array(n * n * n);
  let a = seed >>> 0;
  for (let i = 0; i < out.length; i += 1) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const dfade = (t: number) => 30 * t * t * (t * (t - 2) + 1);

/** Value and gradient of the periodic noise at p (lattice units). */
export function noiseAt(values: Float32Array, x: number, y: number, z: number): [number, number, number, number] {
  const n = NOISE_PERIOD;
  const wrap = (i: number) => ((i % n) + n) % n;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const v = (dx: number, dy: number, dz: number) => values[wrap(ix + dx) + n * (wrap(iy + dy) + n * wrap(iz + dz))]!;
  const a = v(0, 0, 0);
  const b = v(1, 0, 0);
  const c = v(0, 1, 0);
  const d = v(1, 1, 0);
  const e = v(0, 0, 1);
  const f = v(1, 0, 1);
  const g = v(0, 1, 1);
  const h = v(1, 1, 1);
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const k1 = b - a;
  const k2 = c - a;
  const k3 = e - a;
  const k4 = a - b - c + d;
  const k5 = a - c - e + g;
  const k6 = a - b - e + f;
  const k7 = -a + b + c - d + e - f - g + h;
  const value = a + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz;
  return [
    value,
    dfade(fx) * (k1 + k4 * uy + k6 * uz + k7 * uy * uz),
    dfade(fy) * (k2 + k5 * uz + k4 * ux + k7 * uz * ux),
    dfade(fz) * (k3 + k6 * ux + k5 * uy + k7 * ux * uy),
  ];
}

/** RGBA8 voxels of the volume (see the layout above). */
export function bakeNoiseVolume(seed = 1337): Uint8Array {
  const values = lattice(seed);
  const s = NOISE_SIZE;
  const out = new Uint8Array(s * s * s * 4);
  const scale = NOISE_PERIOD / s;
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round((0.5 + v / (2 * GRADIENT_RANGE)) * 255)));
  for (let z = 0; z < s; z += 1)
    for (let y = 0; y < s; y += 1)
      for (let x = 0; x < s; x += 1) {
        // Sample at the texel centre so trilinear filtering reconstructs the field between them.
        const [v, gx, gy, gz] = noiseAt(values, (x + 0.5) * scale, (y + 0.5) * scale, (z + 0.5) * scale);
        const i = (x + s * (y + s * z)) * 4;
        out[i] = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
        out[i + 1] = enc(gx);
        out[i + 2] = enc(gy);
        out[i + 3] = enc(gz);
      }
  return out;
}

let texture: Data3DTexture | null = null;

/** The shared noise volume (created once, never disposed: 128 KB). */
export function getNoiseTexture(): Data3DTexture {
  if (texture) return texture;
  texture = new Data3DTexture(bakeNoiseVolume(), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.wrapR = RepeatWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
