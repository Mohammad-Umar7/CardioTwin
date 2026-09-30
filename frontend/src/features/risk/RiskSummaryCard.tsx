import { MessageSquareText } from 'lucide-react';
import { Button, Kbd, StageCard } from '@/design';
import { CADHeroCard } from '@/features/risk/CADHeroCard';
import { GroundTruthReveal } from '@/features/risk/GroundTruthReveal';
import { VesselList } from '@/features/risk/VesselList';
import { useUiStore } from '@/state/uiStore';

/**
 * RiskSummaryCard — WORKSTATION_V2 §5.8. Answers "How likely is CAD, and which vessels are flagged?".
 * Rendered first in StageLayout's `right` column (w var(--card-right-w)), above the VesselInspector.
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent C on creation; A never edits this file again.
 *
 * Contract:
 *   export interface RiskSummaryCardProps { className?: string }
 *   - StageCard, `region="risk-card"`, header overline + (i) + "Model estimate" tag, `enterDelay={0}`.
 *   - Probability numerals via design `Probability` with `target` (renders `data-prob`); the "was" value
 *     uses `baseline` (renders `data-baseline`). Numbers come from `selectDisplayedPrediction`.
 *   - Selected variants: narrative hidden while a vessel is selected; compact at 1280 or stage ≤ 680 px.
 *   - Hidden (unmounted content) in chrome `focus` — StageLayout keeps the column mounted there so the
 *     inspector can come back; render `null` for the card when `uiStore.chrome === 'focus'`.
 *   - Explain: `openDrawer('explain', { tab: 'why' })`.
 * The stub hosts the legacy CAD hero, vessel list and reveal.
 */
export interface RiskSummaryCardProps {
  className?: string;
}

export function RiskSummaryCard({ className }: RiskSummaryCardProps) {
  const chrome = useUiStore((s) => s.chrome);
  const openDrawer = useUiStore((s) => s.openDrawer);
  if (chrome === 'focus') return null;
  return (
    <StageCard
      id="risk-summary"
      tabIndex={-1}
      region="risk-card"
      aria-label="Risk summary"
      className={`flex flex-col gap-4 outline-none ${className ?? ''}`}
    >
      <CADHeroCard />
      <VesselList />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="flex-1 justify-between"
          iconLeft={<MessageSquareText className="stroke-[1.5]" />}
          onClick={() => openDrawer('explain', { tab: 'why' })}
        >
          <span className="flex-1 text-left">Explain</span>
          <Kbd>E</Kbd>
        </Button>
      </div>
      <GroundTruthReveal />
    </StageCard>
  );
}
