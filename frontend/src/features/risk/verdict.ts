/**
 * Decision vocabulary (WORKSTATION_V2 §3): one answer per question.
 *
 *   probability p   "how likely?"          numeral, Ember colour, track position
 *   band            magnitude bucket        Low · Moderate · High · Very high (25/50/75, same for every target)
 *   decision        p ≥ threshold[target]  the VERDICT: "Flagged" / "Not flagged"
 *
 * The verdict is read from the contract's `label` (1 when probability ≥ threshold, CONTRACTS §3.2), so the
 * UI can never disagree with the model output; `p ≥ threshold` is only the fallback for a payload without
 * a label. Never "likely", "positive", "diseased", "negative", "healthy" or "diagnosis" (§3.2).
 */
import { THIN_SPACE, formatPercent } from '@/lib/format';
import { RISK_BAND_STYLES, type RiskBandId } from '@/theme/risk';
import type { PredictResponse, TargetId, TargetPrediction } from '@/types/contracts';

export const FLAGGED = 'Flagged';
export const NOT_FLAGGED = 'Not flagged';

/** Decision for one target: the contract `label`, else `p ≥ threshold`. */
export function isFlagged(p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null }): boolean {
  if (p.label === 0 || p.label === 1) return p.label === 1;
  return p.probability >= p.threshold;
}

export interface Verdict {
  flagged: boolean;
  /** "Flagged" | "Not flagged". */
  word: typeof FLAGGED | typeof NOT_FLAGGED;
  /** ● (flagged) or ○ (not flagged): shape, never colour, carries the decision. */
  glyph: '●' | '○';
  /**
   * True when p and the threshold round to the same integer percent ("33 %" vs "33 %"), so the copy says
   * "just above" / "just below" instead of a comparison the numbers on screen cannot show.
   */
  marginal: boolean;
}

export function verdictFor(p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null }): Verdict {
  const flagged = isFlagged(p);
  return {
    flagged,
    word: flagged ? FLAGGED : NOT_FLAGGED,
    glyph: flagged ? '●' : '○',
    marginal: Math.round(p.probability * 100) === Math.round(p.threshold * 100),
  };
}

const side = (v: Verdict) => `${v.marginal ? 'just ' : ''}${v.flagged ? 'above' : 'below'}`;

/** CAD verdict line (§3.2): "Flagged — above the 75 % threshold" / "Not flagged — below the 75 % threshold". */
export function cadVerdictLine(p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null }): string {
  const v = verdictFor(p);
  return `${v.word} — ${side(v)} the ${formatPercent(p.threshold)} threshold`;
}

/** Inspector clause: "Flagged: above LAD's 55 % threshold." */
export function vesselDecisionSentence(target: TargetId, p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null }): string {
  const v = verdictFor(p);
  return `${v.word}: ${side(v)} ${target}'s ${formatPercent(p.threshold)} threshold.`;
}

/** Band range in words: "25–50 %", "under 25 %", "75 % or more". */
export function bandRange(band: RiskBandId): string {
  switch (band) {
    case 'low':
      return `under 25${THIN_SPACE}%`;
    case 'moderate':
      return `25–50${THIN_SPACE}%`;
    case 'high':
      return `50–75${THIN_SPACE}%`;
    default:
      return `75${THIN_SPACE}% or more`;
  }
}

/** "High probability band (50–75 %)." — the band word is "Very high" for the contract id `critical`. */
export function bandSentence(band: RiskBandId): string {
  return `${RISK_BAND_STYLES[band].label} probability band (${bandRange(band)}).`;
}

/**
 * The inspector's reconciling sentence (§3.1): a vessel can sit in the Moderate band and still be flagged,
 * because its threshold is tuned per target, far from the band edges.
 */
export function reconcilingSentence(target: TargetId, p: TargetPrediction): string {
  return `${bandSentence(p.risk_band)} ${vesselDecisionSentence(target, p)}`;
}

const listIds = (ids: readonly string[]) =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;

/**
 * One plain sentence when the CAD answer and the per-vessel verdicts (or CAD's band and its verdict) seem to
 * disagree, e.g. "CAD 66 % · High · Not flagged" next to "LAD · Flagged". Each target has its own model and
 * its own threshold (§3.1), so both can be right; the sentence says so without repeating any number (the
 * thresholds' homes are the verdict line and the inspector, §3.3). Null when nothing needs reconciling.
 */
export function cadReconciliation(
  cad: Pick<TargetPrediction, 'probability' | 'threshold' | 'risk_band'> & { label?: number | null },
  vessels: readonly { id: TargetId; p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null } }[],
): string | null {
  const cadFlagged = isFlagged(cad);
  const flagged = vessels.filter((v) => isFlagged(v.p));
  const band = RISK_BAND_STYLES[cad.risk_band]?.label ?? 'High';
  const bandHigh = cad.risk_band === 'high' || cad.risk_band === 'critical';
  if (!cadFlagged && flagged.length > 0) {
    const one = flagged.length === 1;
    const lower = flagged.every((v) => v.p.threshold < cad.threshold);
    const lead = bandHigh ? `${band} probability, but below CAD’s threshold` : 'Below CAD’s threshold';
    return (
      `${lead}; ${listIds(flagged.map((v) => v.id))} ${one ? 'is' : 'are'} flagged at ${one ? 'its' : 'their'} own` +
      `${lower ? ', lower' : ''} threshold${one ? '' : 's'}. Each target is judged separately.`
    );
  }
  if (cadFlagged && vessels.length > 0 && flagged.length === 0) {
    return 'Flagged for CAD, yet no single artery reaches its own threshold. Each target is judged separately.';
  }
  if (!cadFlagged && bandHigh) return `${band} probability, yet below CAD’s decision threshold, so not flagged.`;
  if (cadFlagged && !bandHigh) return `${band} probability, yet above CAD’s decision threshold, so flagged.`;
  return null;
}

export interface FlaggedCount {
  /** Flagged vessels (count of `label` = 1). */
  k: number;
  /** Vessels with an estimate. */
  n: number;
  /** "3 of 3 flagged". */
  text: string;
}

/** "k of 3 flagged": k counts the vessels' `label` fields (§3.2), never a sum of probabilities. */
export function flaggedCount(prediction: PredictResponse | null | undefined, vessels: readonly TargetId[]): FlaggedCount | null {
  if (!prediction) return null;
  const present = vessels.filter((v) => prediction.predictions[v]);
  if (present.length === 0) return null;
  const k = present.filter((v) => isFlagged(prediction.predictions[v]!)).length;
  return { k, n: present.length, text: `${k} of ${present.length} flagged` };
}

/** Screen-reader form of a verdict: "flagged, above the 55 percent threshold". */
export function spokenVerdict(p: Pick<TargetPrediction, 'probability' | 'threshold'> & { label?: number | null }): string {
  const v = verdictFor(p);
  return `${v.word.toLowerCase()}, ${side(v)} the ${Math.round(p.threshold * 100)} percent threshold`;
}

// ------------------------------------------------------------------------------------ cath truth

export interface CathComparison {
  /** 1 = stenotic / CAD at catheterisation. */
  truth: 0 | 1;
  agrees: boolean;
  /** "Stenotic at cath" / "Not stenotic at cath" (CAD: "CAD at cath" / "No CAD at cath"). */
  truthText: string;
  /** "agrees ✓" / "disagrees ✕". */
  agreementText: string;
}

export function cathComparison(target: TargetId, truth: 0 | 1 | undefined | null, p: TargetPrediction | undefined): CathComparison | null {
  if ((truth !== 0 && truth !== 1) || !p) return null;
  const agrees = truth === (isFlagged(p) ? 1 : 0);
  const truthText =
    target === 'CAD' ? (truth === 1 ? 'CAD at cath' : 'No CAD at cath') : truth === 1 ? 'Stenotic at cath' : 'Not stenotic at cath';
  return { truth, agrees, truthText, agreementText: agrees ? 'agrees ✓' : 'disagrees ✕' };
}
