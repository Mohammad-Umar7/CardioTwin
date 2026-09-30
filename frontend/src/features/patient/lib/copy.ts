/**
 * Short what-if copy shared by the chips, the palette and the pill: rounded percentage points with the
 * true minus sign, and the counterfactual tooltip of a finding chip (V2 §5.6).
 */
import { formatDeltaPts, formatProbability, MINUS, THIN_SPACE } from '@/lib/format';
import type { TargetId } from '@/types/contracts';
import type { TargetProbabilities } from './whatIfEngine';

/** "▲ +1 pt", "▼ −7 pts", "no change" (rounded percentage points). */
export function deltaCopy(delta: number): string {
  const d = formatDeltaPts(delta);
  if (d.direction === 'none') return 'no change';
  const abs = Math.abs(Math.round(delta * 100));
  return `${d.glyph} ${d.direction === 'up' ? '+' : MINUS}${abs}${THIN_SPACE}${abs === 1 ? 'pt' : 'pts'}`;
}

/** "If present: CAD 99 % (▲ +1 pt)". */
export function counterfactualCopy(
  present: boolean,
  target: TargetId,
  base: TargetProbabilities,
  flippedP: TargetProbabilities,
): string | null {
  const now = base[target];
  const next = flippedP[target];
  if (now === undefined || next === undefined) return null;
  return `If ${present ? 'absent' : 'present'}: ${target} ${formatProbability(next).text} (${deltaCopy(next - now)})`;
}

