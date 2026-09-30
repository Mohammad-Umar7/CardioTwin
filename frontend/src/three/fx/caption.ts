/** Wording and placement of the illustrative-flow caption (pure; tested in caption.test.ts). */
import type { StageInsets } from '@/state/uiStore';

export const FLOW_CAPTION = 'Illustrative flow — not a haemodynamic simulation';
export const FLOW_CAPTION_DETAIL =
  'Particles show the direction of coronary blood flow (ostium → distal) and its timing: coronary inflow is ' +
  'mostly diastolic, so it surges as the heart relaxes and nearly stalls while it contracts; the light wave ' +
  'marks that surge once per beat. Density, speed and warmth echo each vessel’s predicted stenosis ' +
  'probability. Nothing here is measured or simulated flow, pressure or FFR.';

/** Gap between the caption and the chrome it sits against (px). */
const GAP = 12;

/**
 * Where the caption goes. With a published free area (WORKSTATION_V2 `stageInsets`: cards and toolbar
 * overlay a full-bleed canvas) it sits in the free area's bottom-right corner, just above the toolbar row;
 * without one (legacy HUD: the canvas is the centre column) it sits top-right under the HUD watermark.
 */
export function captionPlacement(insets: StageInsets): Partial<Record<'left' | 'right' | 'top' | 'bottom', string>> {
  const none = insets.left === 0 && insets.right === 0 && insets.top === 0 && insets.bottom === 0;
  if (none) return { right: `${GAP}px`, top: '62px', left: '', bottom: '' };
  return { right: `${insets.right + GAP}px`, bottom: `${insets.bottom + 8}px`, left: '', top: '' };
}
