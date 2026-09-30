import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button, DirectionMark, IconButton, Kbd, RiskPip, StageCard, Tooltip } from '@/design';
import { NarrativeSentence } from '@/features/explain/NarrativeSentence';
import { useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion, useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { sortedContributions } from '@/lib/explain';
import { formatFeatureValue, formatPercent } from '@/lib/format';
import { SHORTCUT } from '@/state/commandIds';
import { usePatientStore } from '@/state/patientStore';
import { selectPatientCardExpanded, useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { riskHex } from '@/theme/risk';
import { EASE, MOTION } from '@/theme/tokens';
import type { TargetId } from '@/types/contracts';
import { RevealControl } from './RevealControl';
import { percentileBelow, useCohortScores } from './useCohortScores';
import { useCohortPatient, useRiskView } from './useRiskView';
import { bandSentence, cathComparison, verdictFor } from './verdict';

const COMPACT_QUERY = '(max-width: 1439.98px), (max-height: 756px)';

function ActionButton({
  pressed,
  onClick,
  label,
  shortLabel,
  shortcut,
  short,
}: {
  pressed?: boolean;
  onClick(): void;
  label: string;
  shortLabel: string;
  shortcut: string;
  short: boolean;
}) {
  return (
    <Tooltip content={`${label} · ${shortcut}`}>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        onClick={onClick}
        className={cn('gap-1.5 px-2', pressed && 'bg-surface-2 text-accent hover:text-accent')}
      >
        {short ? shortLabel : label}
        {!short && <Kbd className="ml-0.5">{shortcut}</Kbd>}
      </Button>
    </Tooltip>
  );
}

/** Top drivers (fallback home of the values while the patient card is collapsed, §3.3). */
function TopDrivers({ target }: { target: TargetId }) {
  const index = useSchemaIndex();
  const explanation = useRiskView().prediction?.explanations[target];
  const highlight = useUiStore((s) => s.highlightFeature);
  const rows = sortedContributions(explanation).slice(0, 3);
  if (!index || rows.length === 0) return null;
  return (
    <section aria-label={`Top drivers of ${target}`} className="flex flex-col">
      <h3 className="eyebrow flex h-6 items-center text-tertiary">Top drivers</h3>
      <ul className="-mx-1 flex flex-col">
        {rows.map((c) => {
          const spec = index.byKey.get(c.feature);
          const up = c.shap > 0;
          return (
            <li key={c.feature}>
              <button
                type="button"
                onClick={() => useUiStore.getState().openDrawer('inputs', { field: c.feature })}
                onMouseEnter={() => highlight(c.feature)}
                onMouseLeave={() => highlight(null)}
                aria-label={`${spec?.label ?? c.feature}, ${spec ? formatFeatureValue(spec, c.value as never) : c.value}, ${up ? 'raises' : 'lowers'} ${target} risk. Edit this input.`}
                className="flex h-7 w-full items-center gap-2 rounded-sm px-1 text-left outline-none hover:bg-surface-1 focus-visible:shadow-focus"
              >
                <span aria-hidden className="flex w-3 items-center">
                  <DirectionMark direction={up ? 'raises' : 'lowers'} />
                </span>
                <span className="min-w-0 flex-1 truncate text-body-s text-secondary">{spec?.label ?? c.feature}</span>
                <span className="num whitespace-nowrap text-body-s font-medium text-primary">
                  {spec ? formatFeatureValue(spec, c.value as never) : String(c.value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cohort position strip (§5.9 item 5): where this patient sits among the demo cohort, for this vessel. */
function CohortStrip({ target, p }: { target: TargetId; p: number }) {
  const scores = useCohortScores();
  const list = scores?.byTarget[target];
  if (!scores || !list || list.length === 0) return null;
  const below = Math.round(percentileBelow(list, p) * 100);
  return (
    <Tooltip
      content={`Each dot is one of the ${scores.n} demo patients (${scores.nTest} held-out, ${scores.nDev} development), scored on their recorded inputs. This patient's ${target} estimate is higher than ${below} % of them.`}
    >
      <div tabIndex={0} className="flex h-6 items-center gap-3 rounded-xs outline-none focus-visible:shadow-focus">
        <span aria-hidden className="relative h-3 flex-1">
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          {list.map((q, i) => (
            <span
              key={i}
              className="absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-disabled"
              style={{ left: `${q * 100}%` }}
            />
          ))}
          <span
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel transition-[left] duration-data ease-data"
            style={{ left: `${p * 100}%`, backgroundColor: riskHex(p) }}
          />
        </span>
        <span className="shrink-0 text-label font-normal text-secondary">Higher than {below}&thinsp;% of the cohort</span>
      </div>
    </Tooltip>
  );
}

export interface VesselInspectorProps {
  className?: string;
}

/**
 * VesselInspector — WORKSTATION_V2 §5.9. Answers "Why this vessel?". Exists only while a vessel is selected.
 *
 *   ● LAD  Left anterior descending ─────────────── ✕
 *   High probability band (50–75 %). Flagged: above LAD's 55 % threshold ›
 *   Driven mostly by typical angina and ST depression; normal wall motion pulls it down.
 *   TOP DRIVERS (only while the patient card is collapsed)
 *   Cohort ·····•·:··•••●···  higher than 71 % of the cohort
 *   [ Isolate O ] [ Ghost others G ] [ Why E ]   (+ [Reveal] while the Risk card is compact)
 *
 * Never a probability numeral: its home is the vessel row. The band word lives here, reconciled with the
 * verdict in one sentence (§3.1).
 */
export function VesselInspector({ className }: VesselInspectorProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const isolate = useViewerStore((s) => s.isolate);
  const ghost = useViewerStore((s) => s.ghostOthers);
  const cardExpanded = useUiStore(selectPatientCardExpanded);
  const compactViewport = useMediaQuery(COMPACT_QUERY);
  const narrow = useMediaQuery('(max-width: 1439.98px)');
  const reduced = useIsReducedMotion();
  const index = useSchemaIndex();
  const view = useRiskView();
  const revealed = usePatientStore((s) => s.revealed);
  const patient = useCohortPatient();

  const spec = selected ? index?.targetById.get(selected) : undefined;
  const p = selected ? view.prediction?.predictions[selected] : undefined;
  const verdict = p ? verdictFor(p) : null;
  const truth = selected && revealed ? cathComparison(selected, patient?.labels[selected], view.recorded?.predictions[selected]) : null;
  const viewer = useViewerStore.getState;

  return (
    <AnimatePresence>
      {selected && (
        <motion.div
          key="inspector"
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
          transition={{ duration: 0.17, ease: EASE.exit }}
        >
          <StageCard
            region="inspector"
            aria-labelledby="inspector-title"
            className={cn('flex flex-col', className)}
          >
            <header className="flex h-8 items-center gap-2">
              <RiskPip p={view.stale || !p ? null : p.probability} />
              <h2 id="inspector-title" className="text-title-2 text-primary">
                {spec?.short ?? selected}
              </h2>
              <span className="min-w-0 flex-1 truncate text-body-s text-secondary">
                {spec?.label.replace(/ artery$/i, '') ?? ''}
              </span>
              <IconButton label="Clear selection · Esc" icon={<X />} size="sm" className="-mr-1" onClick={() => viewer().select(null)} />
            </header>

            <motion.div
              key={selected}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0 : MOTION.fast / 1000, ease: EASE.out }}
              className="flex flex-col"
            >
              {/* Reconciling sentence: band vs threshold, in plain words */}
              <p className="mt-1 text-body-s text-primary" aria-live="polite">
                {view.stale ? (
                  <span className="text-tertiary">Updating</span>
                ) : p && verdict ? (
                  <>
                    {bandSentence(p.risk_band)}{' '}
                    <span className="font-semibold">
                      <span aria-hidden className="mr-1">
                        {verdict.glyph}
                      </span>
                      {verdict.word}:
                    </span>{' '}
                    {verdict.marginal ? 'just ' : ''}
                    {verdict.flagged ? 'above' : 'below'} {selected}&apos;s {formatPercent(p.threshold)}{' '}
                    <button
                      type="button"
                      onClick={() => useUiStore.getState().openDrawer('explain', { tab: 'model' })}
                      className="rounded-xs text-primary underline decoration-line-strong decoration-dotted underline-offset-[3px] outline-none hover:decoration-secondary focus-visible:shadow-focus"
                    >
                      threshold ›
                    </button>
                  </>
                ) : (
                  <span className="text-tertiary">Estimate unavailable</span>
                )}
              </p>

              {truth && (
                <p className="mt-1 flex items-center gap-1.5 text-label font-normal text-secondary">
                  {truth.truthText}
                  <span aria-hidden className="text-primary">
                    {truth.truth === 1 ? '●' : '○'}
                  </span>
                  <span aria-hidden>·</span>
                  <span className={truth.agrees ? 'text-success' : 'text-primary'}>{truth.agreementText}</span>
                </p>
              )}

              {selected && <NarrativeSentence target={selected} className="mt-2" />}

              {!cardExpanded && selected && (
                <div className="mt-3">
                  <TopDrivers target={selected} />
                </div>
              )}

              {p && selected && (
                <div className="mt-2">
                  <CohortStrip target={selected} p={p.probability} />
                </div>
              )}
            </motion.div>

            {/* Docked to the bottom of the right column when it has to scroll (1280 × 720 with a long
                narrative): the 3D verbs never sit below the fold of a column nobody knows scrolls. */}
            <div
              data-region="inspector-verbs"
              className="sticky bottom-0 z-[1] -mx-[var(--card-pad)] -mb-[var(--card-pad)] mt-1 flex flex-wrap items-center gap-1 bg-panel px-[var(--card-pad)] pb-[var(--card-pad)] pt-2"
            >
              <ActionButton
                pressed={isolate}
                onClick={() => viewer().setIsolate(!isolate)}
                label="Isolate"
                shortLabel="Isolate"
                shortcut={SHORTCUT.isolate}
                short={narrow}
              />
              <ActionButton
                pressed={ghost}
                onClick={() => viewer().setGhostOthers(!ghost)}
                label="Ghost others"
                shortLabel="Ghost"
                shortcut={SHORTCUT.ghost}
                short={narrow}
              />
              <ActionButton
                onClick={() => useUiStore.getState().openDrawer('explain', { tab: 'why' })}
                label="Why"
                shortLabel="Why"
                shortcut={SHORTCUT.explain}
                short={narrow}
              />
              {compactViewport && <RevealControl short className="ml-auto h-sm" />}
            </div>
          </StageCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
