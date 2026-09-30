/**
 * C-arm projections (DESIGN_SYSTEM §7.5). Angles in degrees: positive azimuth = LAO (camera moves toward
 * +X, the patient's left), positive elevation = cranial (camera moves toward +Y, the head).
 */
import type { BestView, TargetId } from '@/types/contracts';

export interface Projection {
  id: string;
  label: string;
  azimuth: number;
  elevation: number;
}

export const PROJECTIONS: readonly Projection[] = [
  { id: 'AP', label: 'AP', azimuth: 0, elevation: 0 },
  { id: 'LAO45', label: 'LAO 45', azimuth: 45, elevation: 0 },
  { id: 'RAO30', label: 'RAO 30', azimuth: -30, elevation: 0 },
  { id: 'LAO45CRA20', label: 'LAO 45 / CRA 20', azimuth: 45, elevation: 20 },
  { id: 'RAO30CAU25', label: 'RAO 30 / CAU 25', azimuth: -30, elevation: -25 },
  { id: 'POST', label: 'Posterior', azimuth: 180, elevation: 0 },
];

/** Default best views when the manifest has none: LAD RAO30/CRA25, LCX RAO30/CAU25, RCA LAO40. */
export const DEFAULT_BEST_VIEWS: Readonly<Record<string, BestView>> = {
  LAD: { azimuth: -30, elevation: 25, distance: 5.2 },
  LCX: { azimuth: -30, elevation: -25, distance: 5.2 },
  RCA: { azimuth: 40, elevation: 0, distance: 5.2 },
};

export const HOME_DISTANCE = 6;

export function bestViewFor(target: TargetId, manifestView?: BestView | null): BestView {
  return manifestView ?? DEFAULT_BEST_VIEWS[target] ?? { azimuth: 0, elevation: 0, distance: HOME_DISTANCE };
}

const DEG = Math.PI / 180;

/** camera-controls angles: azimuthAngle = θ around +Y (0 = on +Z), polarAngle = φ from +Y. */
export function toControlsAngles(azimuthDeg: number, elevationDeg: number): { azimuth: number; polar: number } {
  return { azimuth: azimuthDeg * DEG, polar: (90 - elevationDeg) * DEG };
}

/** Inverse of toControlsAngles, normalised to azimuth ∈ (−180, 180]. */
export function fromControlsAngles(azimuth: number, polar: number): { azimuth: number; elevation: number } {
  let az = (azimuth / DEG) % 360;
  if (az > 180) az -= 360;
  if (az <= -180) az += 360;
  return { azimuth: az, elevation: 90 - polar / DEG };
}

/** "RAO 30° · CRA 25°" — the live C-arm readout. */
export function formatCarm(azimuth: number, elevation: number): string {
  const az = Math.round(azimuth);
  const el = Math.round(elevation);
  const side = az === 0 ? 'AP' : Math.abs(az) >= 180 ? 'PA' : az > 0 ? `LAO ${Math.abs(az)}°` : `RAO ${Math.abs(az)}°`;
  const tilt = el === 0 ? '' : el > 0 ? ` · CRA ${el}°` : ` · CAU ${Math.abs(el)}°`;
  return `${side}${tilt}`;
}

/** Next / previous projection for the [ and ] shortcuts. */
export function cycleProjection(currentId: string | null, delta: 1 | -1): Projection {
  const i = PROJECTIONS.findIndex((p) => p.id === currentId);
  const n = PROJECTIONS.length;
  return PROJECTIONS[(((i < 0 ? (delta > 0 ? -1 : 0) : i) + delta) % n + n) % n]!;
}
