import { Button, Kbd, StageCard } from '@/design';
import { NarrativeSentence } from '@/features/explain/NarrativeSentence';
import { typicalProbability } from '@/features/explain/attribution';
import { usePortableModel, useSchemaIndex } from '@/hooks/useData';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { SHORTCUT } from '@/state/commandIds';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { CadHeadline } from './CadHeadline';
import { Collapse } from './Collapse';
import { RevealControl } from './RevealControl';
import { useRiskCommands } from './useRiskCommands';
import { useRiskView } from './useRiskView';
import { VesselRows } from './VesselRows';
import { flaggedCount } from './verdict';

/**
 * Compact variant (§5.8): at 1280-class widths, or on any stage ≤ 680 px tall (viewport ≤ 756 with the
 * 48 + 28 px chrome), while a vessel is selected — so the right column fits the stage with the inspector.
 */
const COMPACT_QUERY = '(max-width: 1439.98px), (max-height: 756px)';

export interface RiskSummaryCardProps {
  className?: string;
}

/**
 * RiskSummaryCard — WORKSTATION_V2 §5.8. Answers "How likely is CAD, and which vessels are flagged?"
 *
 *   CORONARY ARTERY DISEASE (i)            MODEL ESTIMATE
 *   98 %                                     ▌VERY HIGH
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃━●━━━━
 *   ● Flagged — above the 75 % threshold
 *   Driven mostly by typical angina and hypertension; normal wall motion pulls it down.
 *   A typical patient in this cohort scores 83 %.
 *   ───────────────────────────────────────
 *   VESSELS                                3 of 3 flagged
 *   ● LAD  65 %  ━━━━━━┃━●━━━━   ● Flagged           × 3
 *   [ Explain  E ]                 [ Reveal cath result ]
 *
 * One verdict line, one "why" sentence. Every probability numeral carries `data-prob` (not while the Explain
 * drawer covers the card: then the drawer title is its home). Six type styles: overline, numeral-xl,
 * numeral-l, body-s 400 / 600 and label 400. Selected variant: narrative and context line hidden; compact
 * variant (1280 or a short stage, with a selection): also the track, vessels header and footer.
 */
export function RiskSummaryCard({ className }: RiskSummaryCardProps) {
  useRiskCommands();
  const chrome = useUiStore((s) => s.chrome);
  const covered = useUiStore((s) => s.drawer === 'explain');
  const openDrawer = useUiStore((s) => s.openDrawer);
  const selected = useViewerStore((s) => s.selectedStructure);
  const compactViewport = useMediaQuery(COMPACT_QUERY);
  const index = useSchemaIndex();
  const model = usePortableModel();
  const view = useRiskView();

  if (chrome === 'focus') return null;

  const count = flaggedCount(view.prediction, (index?.vessels ?? []).map((v) => v.id));
  const typical = typicalProbability(view.prediction?.explanations.CAD, model.data?.models.CAD?.calibration);
  const isSelected = selected !== null;
  const compact = isSelected && compactViewport;
  const answered = !!view.prediction?.predictions.CAD;

  return (
    <StageCard
      id="risk-summary"
      tabIndex={-1}
      region="risk-card"
      data-tour="cad-card"
      data-variant={compact ? 'compact' : isSelected ? 'selected' : 'rest'}
      aria-labelledby="risk-card-title"
      className={cn('flex flex-col outline-none', className)}
    >
      <CadHeadline titleId="risk-card-title" covered={covered} showTrack={!compact} />

      {/* Narrative and context line: hidden while a vessel is selected (the inspector explains then). */}
      {answered && (
        <Collapse show={!isSelected}>
          <NarrativeSentence target="CAD" className="mt-2" />
          {typical !== null && (
            <p className="mt-1 text-label font-normal text-tertiary">
              A typical patient in this cohort scores {formatProbability(typical).text}.
            </p>
          )}
        </Collapse>
      )}

      <div aria-hidden className={cn('h-px bg-hairline transition-[margin] duration-base', compact ? 'my-2' : 'my-4')} />

      <Collapse show={!compact}>
        <div className="flex h-6 items-center justify-between">
          <h3 className="eyebrow text-secondary">Vessels</h3>
          {count && (
            <span className="text-label font-normal text-secondary" aria-live="polite">
              {view.stale ? 'Updating' : count.text}
            </span>
          )}
        </div>
      </Collapse>

      <VesselRows covered={covered} className={compact ? '' : 'mt-1'} />

      <Collapse show={!compact}>
        <div className="mt-3 flex h-8 items-center gap-2">
          <Button
            variant="secondary"
            className="flex-1 justify-between"
            onClick={() => openDrawer('explain', { tab: 'why' })}
            aria-keyshortcuts={SHORTCUT.explain}
            data-drawer-opener="explain"
          >
            <span>Explain</span>
            <Kbd className="font-semibold">{SHORTCUT.explain}</Kbd>
          </Button>
          <RevealControl />
        </div>
      </Collapse>
    </StageCard>
  );
}
