/** Pixel ratio per render tier (DESIGN_SYSTEM §7.7). Pure; unit tested in three.test.ts. */
import type { RenderTier } from '@/state/viewerStore';

const DPR: Record<RenderTier, number | [number, number]> = { A: [1, 1.5], B: [1, 1.25], C: 1, D: 1 };

/**
 * On an integrated GPU the full-bleed Realistic stage keeps tier B at DPR 1.0 (V2 §9.3 D accept: "cap the
 * workstation's DPR at 1.0 and let PerformanceMonitor drop to C") — 35 % fewer pixels than 1.25.
 */
export const dprFor = (tier: RenderTier, integrated: boolean) => (integrated && tier === 'B' ? 1 : DPR[tier]);

/** The pixel ratio a tier resolves to on this screen (a [min, max] range clamps devicePixelRatio). */
export function resolvedDpr(dpr: number | [number, number], device = typeof window !== 'undefined' ? window.devicePixelRatio : 1): number {
  return Array.isArray(dpr) ? Math.min(Math.max(device || 1, dpr[0]), dpr[1]) : dpr;
}
