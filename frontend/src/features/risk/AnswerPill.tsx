import { BandChip, Kbd, Probability, StageCard } from '@/design';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';

/**
 * AnswerPill — WORKSTATION_V2 §5.16: `CAD 98 % ▌VERY HIGH · 3 of 3 flagged · Exit \`. The fallback home of
 * P(CAD) while focus mode hides the Risk card. Rendered in StageLayout's `overlay` slot; it positions
 * itself top-right at the stage inset (h 40, r-full, stage-card material). StageLayout moves the right
 * column below it in focus mode.
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent C on creation; A never edits this file again.
 *
 * Contract:
 *   export interface AnswerPillProps { className?: string }
 *   - Renders only while `uiStore.chrome === 'focus'`.
 *   - The CAD numeral renders `data-prob="CAD"` (design `Probability` with `target="CAD"`).
 *   - Clicking the numeral exits focus mode and focuses the Risk card; `[Exit \]` calls `setChrome('workstation')`.
 */
export interface AnswerPillProps {
  className?: string;
}

export function AnswerPill({ className }: AnswerPillProps) {
  const chrome = useUiStore((s) => s.chrome);
  const cad = usePatientStore((s) => selectDisplayedPrediction(s)?.predictions.CAD);
  const stale = usePatientStore((s) => s.status === 'loading');
  if (chrome !== 'focus') return null;
  return (
    <StageCard
      as="div"
      shape="chip"
      region="answer-pill"
      className={`absolute right-[var(--stage-inset)] top-[var(--stage-inset)] h-10 gap-3 pl-4 pr-1.5 ${className ?? ''}`}
    >
      <span className="text-body-s font-semibold text-secondary">CAD</span>
      <Probability p={cad?.probability} target="CAD" size="l" stale={stale} />
      <BandChip band={cad?.risk_band ?? null} pending={stale} size="sm" showMeter={false} />
      <button
        type="button"
        onClick={() => useUiStore.getState().setChrome('workstation')}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-label text-secondary hover:bg-surface-2 hover:text-primary"
      >
        Exit <Kbd>\</Kbd>
      </button>
    </StageCard>
  );
}
