/**
 * The scene's text equivalent (DESIGN_SYSTEM §10.4) in the V2 vocabulary (WORKSTATION_V2 §3.2): the
 * probability and band of each vessel, and whether it is flagged against its own threshold, the
 * selection and the dissection stage. Pure; tested in labels.test.ts.
 */
import type { PredictResponse } from '@/types/contracts';
import { PEEL_DETENTS } from '../anatomy/explode';

export interface SceneSummaryInput {
  vessels: readonly string[];
  prediction: PredictResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  selected: string | null;
  /** Peel stage name, or null at the rest state (nothing to say). */
  peel: string | null;
  spoken(p: number): string;
  band(id: string): string;
}

/** The dissection stage worth announcing ("Chest closed", "Heart opened"), null at the rest detent. */
export function nearestPeelStage(explode: number): string | null {
  let best: (typeof PEEL_DETENTS)[number] = PEEL_DETENTS[0];
  for (const d of PEEL_DETENTS) if (Math.abs(d.value - explode) < Math.abs(best.value - explode)) best = d;
  if (best.id === 'lungs') return null;
  return best.id === 'heart' ? 'Heart opened' : best.id === 'closed' ? 'Chest closed' : best.label;
}

export function sceneSummaryText(i: SceneSummaryInput): string {
  let text: string;
  if (!i.prediction) {
    text = i.status === 'error' ? 'Vessel estimates are unavailable.' : 'Vessel estimates are loading.';
  } else {
    const parts = i.vessels.map((t) => {
      const p = i.prediction?.predictions[t];
      if (!p) return `${t} unavailable`;
      const verdict = p.probability >= p.threshold ? 'flagged' : 'not flagged';
      return `${t} ${i.spoken(p.probability)}, ${i.band(p.risk_band)} probability, ${verdict}`;
    });
    text = `${parts.join('; ')}; left main not predicted.`;
    if (i.status === 'loading') text += ' Updating.';
  }
  if (i.selected) text += ` Selected: ${i.selected}.`;
  if (i.peel) text += ` ${i.peel}.`;
  return text;
}
