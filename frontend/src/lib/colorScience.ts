/**
 * Small, dependency-free colour science used to verify the risk ramp (theme/risk.test.ts) and to compute
 * contrast at runtime (e.g. exported chart watermarks). Formulas:
 *   - sRGB transfer function: IEC 61966-2-1;
 *   - OKLab: Björn Ottosson (2020), linear sRGB → LMS → cube root → Lab;
 *   - colour-vision deficiency: Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB;
 *   - contrast: WCAG 2.x relative luminance ratio.
 */

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export const toLinear = (rgb: Rgb): Rgb => [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export function linearRgbToOklab([r, g, b]: Rgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export const hexToOklab = (hex: string): Oklab => linearRgbToOklab(toLinear(hexToRgb(hex)));

/** ΔE_OK: Euclidean distance in OKLab (≈ 0.02 is one just-noticeable difference). */
export function deltaEOK(x: Oklab, y: Oklab): number {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

// ------------------------------------------------------------------------ colour-vision deficiency

export type Vision = 'normal' | 'deutan' | 'protan' | 'tritan';

type Matrix3 = readonly [Rgb, Rgb, Rgb];

/** Machado et al. 2009, severity 1.0 (dichromacy). */
export const MACHADO_2009: Readonly<Record<Exclude<Vision, 'normal'>, Matrix3>> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Simulated linear RGB as seen with the given vision type. */
export function simulateLinear(linear: Rgb, vision: Vision): Rgb {
  if (vision === 'normal') return linear;
  const m = MACHADO_2009[vision];
  const [r, g, b] = linear;
  return [
    clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ];
}

export const simulatedOklab = (hex: string, vision: Vision): Oklab =>
  linearRgbToOklab(simulateLinear(toLinear(hexToRgb(hex)), vision));

// ---------------------------------------------------------------------------------- WCAG contrast

export function relativeLuminance(hex: string): number {
  const [r, g, b] = toLinear(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
