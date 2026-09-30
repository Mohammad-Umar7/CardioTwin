/**
 * Render quality from ⋯ › Quality (WORKSTATION_V2 §5.11): Auto lets the performance monitor move between
 * tiers A–C; a named tier locks it. Tier D (the 2D schematic) is never offered: it is chosen by the
 * browser's capabilities, not by the user.
 */
import { useViewerStore, type RenderTier } from '@/state/viewerStore';
import { probeWebGL } from '@/three/webgl';

export type QualityValue = 'auto' | Exclude<RenderTier, 'D'>;

export const QUALITY_OPTIONS: readonly { value: QualityValue; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: '' },
  { value: 'A', label: 'High', hint: 'tier A' },
  { value: 'B', label: 'Balanced', hint: 'tier B' },
  { value: 'C', label: 'Lite', hint: 'tier C' },
];

export const qualityValue = (tier: RenderTier, locked: boolean): QualityValue | null =>
  tier === 'D' ? null : locked ? tier : 'auto';

/** "tier B · 60 fps" — the Auto row's live hint. */
export const tierSummary = (tier: RenderTier, fps: number | null): string =>
  `tier ${tier}${fps !== null && Number.isFinite(fps) ? ` · ${Math.round(fps)} fps` : ''}`;

/** Tiers A and B need half-float render targets for the post chain; without them only C is offered. */
export const qualityAvailable = (value: QualityValue): boolean => value === 'auto' || value === 'C' || probeWebGL().halfFloat;

export function setQuality(value: QualityValue): void {
  const viewer = useViewerStore.getState();
  if (viewer.tier === 'D' || !qualityAvailable(value)) return;
  if (value === 'auto' && !probeWebGL().halfFloat) return;
  // Auto clears the lock so the monitor may move again.
  if (value === 'auto') viewer.unlockTier();
  else viewer.setTier(value, true);
}
