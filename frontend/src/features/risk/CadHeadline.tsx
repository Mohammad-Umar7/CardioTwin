import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Info } from 'lucide-react';
import { useRef } from 'react';
import { BandChip, Probability, RiskTrack, Skeleton, Tooltip } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { usePatientStore } from '@/state/patientStore';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatPercent, formatProbability, formatShownDeltaPts } from '@/lib/format';
import { RISK_BAND_STYLES } from '@/theme/risk';
import { EASE, MOTION } from '@/theme/tokens';
import { Collapse } from './Collapse';
import { useFlipAnnouncement } from './useFlipAnnouncement';
import { useCohortPatient, useRiskView } from './useRiskView';
import { cadReconciliation, cadVerdictDisplay, cathComparison, spokenVerdict, verdictFor } from './verdict';

/**
 * "Model estimate" status tag (§3.2, §5.8): sits beside the numbers it qualifies; replaces the live-canvas
 * watermark and the old "Model estimate, not a diagnosis" microcopy.
 */
function ModelEstimateTag() {
  return (
    <Tooltip
      className="max-w-[300px]"
      content={
        <span className="flex flex-col gap-1">
          <span>A statistical estimate from routine clinical data: decision support, not a diagnosis.</span>
          <span className="text-secondary">
            Shown between ≤5&thinsp;% and ≥95&thinsp;%: on unseen patients the extreme estimates were more extreme
            than the observed rates. The exact value is in Explain › Model.
          </span>
        </span>
      }
    >
      <span
        tabIndex={0}
        className="eyebrow inline-flex h-5 items-center rounded-sm border border-line px-1.5 text-tertiary outline-none focus-visible:shadow-focus"
      >
        Model estimate
      </span>
    </Tooltip>
  );
}

export interface CadHeadlineProps {
  /** id of the overline heading (for the card's `aria-labelledby`). */
  titleId: string;
  /** The Explain drawer covers the numeral: omit `data-prob` (the drawer title is P(CAD)'s home then). */
  covered?: boolean;
  /** Show the threshold track (hidden by the compact variant). */
  showTrack?: boolean;
}

/**
 * The CAD answer (WORKSTATION_V2 §5.8 items 1–4): header with the "Model estimate" tag, the numeral
 * (`data-prob="CAD"`) with its band chip, the "was … · ▼ −7 pts" line while edits exist, the threshold track
 * (its scale lives in a tooltip, not in numerals) and the verdict line in the §3.2 vocabulary. Two encodings
 * of the result (numeral + band chip), the track as their scale. States: skeleton, value, stale ("Updating",
 * achromatic marks), unavailable (never a stale number presented as current).
 */
export function CadHeadline({ titleId, covered = false, showTrack = true }: CadHeadlineProps) {
  const index = useSchemaIndex();
  const view = useRiskView();
  const reduced = useIsReducedMotion();
  const cad = view.prediction?.predictions.CAD;
  const base = view.baseline?.predictions.CAD;
  const spec = index?.targetById.get('CAD');
  const verdict = cad ? verdictFor(cad) : null;
  const delta = cad && base ? formatShownDeltaPts(base.probability, cad.probability) : null;
  const band = cad ? RISK_BAND_STYLES[cad.risk_band] : null;
  const vesselPs = (index?.vessels ?? []).flatMap((v) => {
    const vp = view.prediction?.predictions[v.id];
    return vp ? [{ id: v.id, p: vp }] : [];
  });
  const display = cad ? cadVerdictDisplay(cad, vesselPs) : null;
  // After "Reveal cath result": the angiogram's CAD answer against the RECORDED estimate, like the vessel rows.
  const revealed = usePatientStore((s) => s.revealed);
  const patient = useCohortPatient();
  const truth = revealed ? cathComparison('CAD', patient?.labels.CAD, view.recorded?.predictions.CAD) : null;
  const verdictText = display?.text ?? null;
  // While an update is pending the sentence stays (dimmed like the numerals) instead of collapsing and
  // re-opening on every edit; it follows the numbers it reconciles.
  const reconcile = cad ? cadReconciliation(cad, vesselPs) : null;
  // While inputs are edited the sentence keeps a fixed two-line slot, so it can come and go with the
  // numbers without the card growing and shrinking under the pointer (no layout shift, V2 §8.6).
  const reserveReconcile = view.edits > 0;
  // Keep the last sentence while the line collapses, so it never empties before it closes.
  const lastReconcile = useRef<string | null>(null);
  if (reconcile) lastReconcile.current = reconcile;
  const announcement = useFlipAnnouncement(
    cad && band
      ? `CAD ${formatProbability(cad.probability).spoken}, ${band.label}. ${display?.glyph === null ? display.text : spokenVerdict(cad)}.`
      : null,
    cad ? `${cad.risk_band}-${verdict?.flagged}` : null,
  );

  return (
    <>
      <header className="flex h-6 items-center gap-1">
        <h2 id={titleId} className="eyebrow min-w-0 truncate text-secondary">
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
      </header>

      {view.unavailable ? (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-line bg-surface-1 p-3"
        >
          <AlertCircle aria-hidden className="mt-px size-4 shrink-0 stroke-[1.5] text-danger" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-s font-semibold text-primary">Estimate unavailable</span>
            <span className="text-label font-normal text-secondary">
              {view.error ?? 'No prediction engine is reachable.'}
            </span>
            <span className="text-label font-normal text-tertiary">
              Start the API (<span className="mono">uvicorn app.main:app --app-dir backend</span>) or reload
              to use the in-browser model.
            </span>
          </div>
        </div>
      ) : !cad || !verdict ? (
        <div aria-busy="true" aria-label="Computing the estimate" className="flex flex-col">
          <div className="mt-2 flex h-14 items-end justify-between pb-1">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="mb-1 h-[18px] w-20" />
          </div>
          {showTrack && <Skeleton className="mt-2 h-4" />}
          <Skeleton className="mt-2 h-5 w-56" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <Probability
                p={cad.probability}
                target={covered ? undefined : 'CAD'}
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
                      <span
                        className="num"
                        data-baseline="CAD"
                        title={formatProbability(base.probability).exact}
                      >
                        {formatProbability(base.probability).text}
                      </span>
                      {delta && delta.direction !== 'none'
                        ? ` · ${delta.glyph} ${delta.text}`
                        : ' · no change'}
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="mb-1.5 flex shrink-0 flex-col items-end gap-2">
              <ModelEstimateTag />
              <div className="relative h-[18px]">
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
          </div>

          <Collapse show={showTrack}>
            {/* Below the scale: above it, the tooltip would cover the numeral it explains. */}
            <Tooltip content={`0 · 25 · 50 · 75 · 100 % · threshold ${formatPercent(cad.threshold)}`} placement="bottom">
              <div
                tabIndex={0}
                role="img"
                aria-label={`Probability scale from 0 to 100 percent; decision threshold ${Math.round(cad.threshold * 100)} percent`}
                className="mt-2 rounded-xs outline-none focus-visible:shadow-focus"
              >
                <RiskTrack
                  p={cad.probability}
                  threshold={cad.threshold}
                  ghost={base?.probability ?? null}
                  pending={view.stale}
                />
              </div>
            </Tooltip>
          </Collapse>

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
                    {display?.glyph && (
                      <span aria-hidden className="mr-1.5">
                        {display.glyph}
                      </span>
                    )}
                    {verdictText}
                  </>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
          <Collapse show={truth !== null}>
            {truth && (
              <p className="mt-1 flex items-center gap-1.5 text-label font-normal text-secondary" data-cath="CAD">
                {truth.truthText}
                <span aria-hidden className="text-primary">
                  {truth.truth === 1 ? '●' : '○'}
                </span>
                <span aria-hidden>·</span>
                <span className={truth.agrees ? 'text-success' : 'text-primary'}>{truth.agreementText}</span>
                {view.edits > 0 && <span className="text-tertiary">(recorded inputs)</span>}
              </p>
            )}
          </Collapse>
          {/* CAD and the arteries are judged against their own thresholds: say so when they seem to disagree. */}
          <Collapse show={showTrack && (reconcile !== null || reserveReconcile)}>
            <p
              className={cn(
                'mt-1 text-label font-normal text-secondary transition-opacity duration-fast',
                reserveReconcile && 'line-clamp-2 h-8',
                view.stale && 'opacity-50',
              )}
              data-reconcile="CAD"
            >
              {reconcile ?? (reserveReconcile ? null : lastReconcile.current)}
            </p>
          </Collapse>
        </>
      )}
      <p className="sr-only text-body-s" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
