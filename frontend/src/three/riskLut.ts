import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { RISK_LUT_SIZE, riskLutPixels } from '@/theme/risk';

let lut: DataTexture | null = null;

/**
 * The shared 256×1 Ember LUT (DESIGN_SYSTEM §2.2): sRGB-encoded RGBA8, linear filtering, clamp to edge.
 * Shaders sample `texture2D(uRiskLUT, vec2(p, 0.5))` and get linear colour (hardware sRGB decode), so
 * every surface that encodes risk sits on exactly the same ramp as the CSS legend.
 */
export function getRiskLUT(): DataTexture {
  if (lut) return lut;
  lut = new DataTexture(riskLutPixels(), RISK_LUT_SIZE, 1, RGBAFormat, UnsignedByteType);
  lut.colorSpace = SRGBColorSpace;
  lut.magFilter = LinearFilter;
  lut.minFilter = LinearFilter;
  lut.wrapS = ClampToEdgeWrapping;
  lut.wrapT = ClampToEdgeWrapping;
  lut.generateMipmaps = false;
  lut.needsUpdate = true;
  return lut;
}
