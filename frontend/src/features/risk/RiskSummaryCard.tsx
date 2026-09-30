import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Info } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BandChip, Button, Kbd, Probability, RiskTrack, Skeleton, StageCard, Tooltip } from '@/design';
import { NarrativeSentence } from '@/features/explain/NarrativeSentence';
import { typicalProbability } from '@/features/explain/attribution';
import { usePortableModel, useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion, useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatDeltaPts, formatPercent, formatProbability } from '@/lib/format';
import { SHORTCUT } from '@/state/commandIds';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { RISK_BAND_STYLES } from '@/theme/risk';
import { EASE, MOTION } from '@/theme/tokens';
import { RevealControl } from './RevealControl';
import { useRiskCommands } from './useRiskCommands';
import { useRiskView } from './useRiskView';
import { VesselRows } from './VesselRows';
import { cadVerdictLine, flaggedCount, spokenVerdict, verdictFor } from './verdict';

/**
 * Compact variant (§5.8): at 1280-class widths, or on any stage ≤ 680 px tall (viewport ≤ 756 with the
 * 48 + 28 px chrome), while a vessel is selected — so the right column fits the stage with the inspector.
 */
const COMPACT_QUERY = '(max-width: 1439.98px), (max-height: 756px)';

/** Polite announcement, only when the band or the verdict flips, debounced 1 s (LUMEN §10.4). */
function useFlipAnnouncement(text: string | null, key: string | null): string {
  const [said, setSaid] = useState('');
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!text || !key) return;
    if (last.current === null) {
      last.current = key;
      return;
    }
    if (key === last.current) return;
    const t = window.setTimeout(() => {
      last.current = key;
      setSaid(text);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [text, key]);
  return said;
}

/** Height + fade collapse for the parts the selected / compact variants hide (`base`; instant when reduced). */
function Collapse({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const reduced = useIsReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : MOTION.base / 1000, ease: EASE.out }}
          className={cn('overflow-clip', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

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
 * Two encodings of the CAD result (numeral + band chip, with the track as its scale), one verdict line,
 * one "why" sentence. Every probability numeral carries `data-prob` (not while the Explain drawer covers the
 * card: then the drawer title is P(CAD)'s home). Six type styles: overline, numeral-xl, numeral-l, body-s
 * 400 / 600 and label 400. Selected variant: narrative and context line hidden; compact variant (1280 or
 * a short stage): also the track, vessels header and footer.
 */
export function RiskSummaryCard({ className }: RiskSummaryCardProps) {
  useRiskCommands();
  const chrome = useUiStore((s) => s.chrome);
  const covered = useUiStore((s) => s.drawer === 'explain');
  const openDrawer = useUiStore((s) => s.openDrawer);
  const selected = useViewerStore((s) => s.selectedStructure);
  const compactViewport = useMediaQuery(COMPACT_QUERY);
  const reduced = useIsReducedMotion();
  const index = useSchemaIndex();
  const model = usePortableModel();
  const view = useRiskView();

  const cad = view.prediction?.predictions.CAD;
  const base = view.baseline?.predictions.CAD;
  const spec = index?.targetById.get('CAD');
  const verdict = cad ? verdictFor(cad) : null;
  const verdictText = cad ? cadVerdictLine(cad) : null;
  const count = flaggedCount(view.prediction, (index?.vessels ?? []).map((v) => v.id));
  const typical = typicalProbability(view.prediction?.explanations.CAD, model.data?.models.CAD?.calibration);
  const delta = cad && base ? formatDeltaPts(cad.probability - base.probability) : null;

  const band = cad ? RISK_BAND_STYLES[cad.risk_band] : null;
  const announcement = useFlipAnnouncement(
    cad && band ? `CAD ${formatProbability(cad.probability).spoken}, ${band.label}. ${spokenVerdict(cad)}.` : null,
    cad ? `${cad.risk_band}-${verdict?.flagged}` : null,
  );

  if (chrome === 'focus') return null;

  const isSelected = selected !== null;
  const compact = isSelected && compactViewport;
  const probTarget = covered ? undefined : 'CAD';

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
      {/* 1 · Header */}
      <header className="flex h-6 items-center gap-1">
        <h2 id="risk-card-title" className="eyebrow truncate text-secondary">
          {spec?.label ?? 'Coronary artery disease'}
        </h2>
        <Tooltip
          content={
            spec?.description ??
            'Probability that angiography would show at least one major coronary artery narrowed by 50 % or more.'
          }
        >
          <button
            type="button"
            aria-label="About this estimate"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-tertiary outline-none hover:text-primary focus-visible:shadow-focus"
          >
            <Info aria-hidden className="size-4 stroke-[1.5]" />
          </button>
        </Tooltip>
        <Tooltip content="A statistical estimate from routine clinical data: decision support, not a diagnosis.">
          <span
            tabIndex={0}
            className="eyebrow ml-auto inline-flex h-5 shrink-0 items-center rounded-sm border border-line px-1.5 text-tertiary outline-none focus-visible:shadow-focus"
          >
            Model estimate
          </span>
        </Tooltip>
      </header>

      {view.unavailable ? (
        <div role="status" className="mt-2 flex items-start gap-2 rounded-md border border-line bg-surface-1 p-3">
          <AlertCircle aria-hidden className="mt-px size-4 shrink-0 stroke-[1.5] text-danger" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-s font-semibold text-primary">Estimate unavailable</span>
            <span className="text-label font-normal text-secondary">{view.error ?? 'No prediction engine is reachable.'}</span>
            <span className="text-label font-normal text-tertiary">
              Start the API (<span className="mono">uvicorn app.main:app --app-dir backend</span>) or reload to use the in-browser model.
            </span>
          </div>
        </div>
      ) : !cad || !verdict ? (
        <div aria-busy="true" aria-label="Computing the estimate" className="flex flex-col">
          <div className="mt-2 flex h-14 items-end justify-between pb-1">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="mb-1 h-[18px] w-20" />
          </div>
          <Skeleton className="mt-2 h-4" />
          <Skeleton className="mt-2 h-5 w-56" />
        </div>
      ) : (
        <>
          {/* 2 · Headline */}
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <Probability
                p={cad.probability}
                target={probTarget}
                size="xl"
                stale={view.stale}
                className="[&_.pct-sign]:ml-0.5 [&_.pct-sign]:text-numeral-l"
              />
              {view.edits > 0 && (
                <span className="mt-1 h-4 whitespace-nowrap text-label font-normal text-secondary">
                  {view.comparing || !base ? (
                    'Showing the recorded inputs'
                  ) : (
                    <>
                      was{' '}
                      <span className="num" data-baseline="CAD" title={formatProbability(base.probability).exact}>
                        {formatProbability(base.probability).text}
                      </span>
                      {delta && delta.direction !== 'none' ? ` · ${delta.glyph} ${delta.text}` : ' · no change'}
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="relative mb-1.5 h-[18px] shrink-0">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={view.stale ? 'pending' : cad.risk_band}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : MOTION.fast / 1000, ease: EASE.out }}
                  className="block"
                >
                  <BandChip band={cad.risk_band} pending={view.stale} size="sm" showMeter={false} />
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          {/* 3 · Track (its scale is in the tooltip, not in numerals) */}
          <Collapse show={!compact}>
            <Tooltip content={`0 · 25 · 50 · 75 · 100 % · threshold ${formatPercent(cad.threshold)}`}>
              <div
                tabIndex={0}
                role="img"
                aria-label={`Probability scale from 0 to 100 percent; decision threshold ${Math.round(cad.threshold * 100)} percent`}
                className="mt-2 rounded-xs outline-none focus-visible:shadow-focus"
              >
                <RiskTrack p={cad.probability} threshold={cad.threshold} ghost={base?.probability ?? null} pending={view.stale} />
              </div>
            </Tooltip>
          </Collapse>

          {/* 4 · Verdict */}
          <div className="relative mt-2 h-5 overflow-clip">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.p
                key={view.stale ? 'updating' : verdictText}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduced ? 0 : MOTION.fast / 1000, ease: EASE.out }}
                className={cn('text-body-s font-semibold', view.stale ? 'text-tertiary' : 'text-primary')}
              >
                {view.stale ? (
                  'Updating'
                ) : (
                  <>
                    <span aria-hidden className="mr-1.5">
                      {verdict.glyph}
                    </span>
                    {verdictText}
                  </>
                )}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* 5–6 · Narrative and context line (hidden while a vessel is selected: the inspector explains) */}
          <Collapse show={!isSelected}>
            <NarrativeSentence target="CAD" className="mt-2" />
            {typical !== null && (
              <p className="mt-1 text-label font-normal text-tertiary">
                A typical patient in this cohort scores {formatProbability(typical).text}.
              </p>
            )}
          </Collapse>
        </>
      )}

      {/* 7 · Hairline */}
      <div aria-hidden className={cn('h-px bg-hairline transition-[margin] duration-base', compact ? 'my-2' : 'my-4')} />

      {/* 8 · Vessels header */}
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

      {/* 9 · Vessel rows */}
      <VesselRows covered={covered} className={compact ? '' : 'mt-1'} />

      {/* 10 · Footer */}
      <Collapse show={!compact}>
        <div className="mt-3 flex h-8 items-center gap-2">
          <Button
            variant="secondary"
            className="flex-1 justify-between"
            onClick={() => openDrawer('explain', { tab: 'why' })}
            aria-keyshortcuts={SHORTCUT.explain}
          >
            <span>Explain</span>
            <Kbd className="font-semibold">{SHORTCUT.explain}</Kbd>
          </Button>
          <RevealControl />
        </div>
      </Collapse>

      <p className="sr-only text-body-s" aria-live="polite">
        {announcement}
      </p>
    </StageCard>
  );
}
