import { AlertCircle, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BandChip, Probability, RiskTrack, SectionHeader, Skeleton, Tooltip } from '@/design';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { usePrediction } from '@/hooks/usePrediction';
import { useSchemaIndex } from '@/hooks/useData';
import { formatPercent, formatProbability } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { usePatientStore } from '@/state/patientStore';
import { EASE, MOTION } from '@/theme/tokens';
import { DeltaChip } from './DeltaChip';

/** Polite screen-reader announcement, only when the band or the verdict flips, debounced 1 s (§10.4). */
function useVerdictAnnouncement(text: string | null, key: string | null): string {
  const [announced, setAnnounced] = useState('');
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!text || !key) return;
    if (lastKey.current === null) {
      lastKey.current = key;
      return;
    }
    if (key === lastKey.current) return;
    const t = setTimeout(() => {
      lastKey.current = key;
      setAnnounced(text);
    }, 1000);
    return () => clearTimeout(t);
  }, [text, key]);
  return announced;
}

/**
 * CADHeroCard (DESIGN_SYSTEM §5): overline, numeral-xl probability, band chip + meter, RiskTrack with
 * the deployed threshold, verdict line and "Model estimate, not a diagnosis". States: skeleton,
 * value, updating (stale at 50 % after 150 ms), error ("estimate unavailable" — never a stale number as
 * current), and with a pinned baseline "was → now".
 */
export function CADHeroCard({ target = 'CAD' }: { target?: string }) {
  const { prediction, previous, baseline, status, error, seq } = usePrediction();
  const index = useSchemaIndex();
  const engineStatus = usePatientStore((s) => s.engineStatus);
  const stale = useDelayedFlag(status === 'loading', 150);
  const spec = index?.targetById.get(target);
  const p = prediction?.predictions[target];
  const band = p ? bandStyle(p.risk_band) : null;
  const likely = p ? p.probability >= p.threshold : false;
  const verdict = p
    ? `${target} ${likely ? 'likely' : 'unlikely'} · ${likely ? 'above' : 'below'} threshold ${formatPercent(p.threshold)}`
    : null;
  const announcement = useVerdictAnnouncement(
    p && band ? `${target} ${formatProbability(p.probability).spoken}, ${band.label}. ${verdict}.` : null,
    p && band ? `${band.id}-${likely}` : null,
  );
  const unavailable = !p && (status === 'error' || engineStatus === 'unavailable');

  return (
    <section aria-labelledby="cad-card-title" className="flex flex-col gap-2" data-tour="cad-card">
      <SectionHeader
        id="cad-card-title"
        title={
          <>
            Overall · <abbr title={spec?.label ?? 'Coronary artery disease'}>{target}</abbr>
          </>
        }
        aside={
          <Tooltip
            content={
              spec?.description ??
              'Probability that angiography would show at least one major coronary artery narrowed by 50 % or more.'
            }
          >
            <button type="button" aria-label="About this estimate" className="rounded-sm p-0.5 text-tertiary hover:text-primary">
              <Info className="size-4 stroke-[1.5]" />
            </button>
          </Tooltip>
        }
      />

      {!p && !unavailable && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-32" label="Computing the estimate" />
          <Skeleton className="h-4" />
        </div>
      )}

      {unavailable && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-line bg-surface-1 p-3">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-danger" />
          <div className="flex flex-col gap-0.5">
            <span className="text-body-s font-semibold text-primary">Estimate unavailable</span>
            <span className="text-label font-normal text-secondary">{error ?? 'No prediction engine is reachable.'}</span>
            <span className="text-label font-normal text-tertiary">
              Start the API (<span className="mono">uvicorn app.main:app --app-dir backend</span>) to compute estimates.
            </span>
          </div>
        </div>
      )}

      {p && band && (
        <>
          <div className="flex items-end justify-between gap-3">
            <Probability p={p.probability} size="xl" stale={stale} />
            <div className="flex flex-col items-end gap-1 pb-1">
              <BandChip band={band.id} pending={stale} />
              <DeltaChip
                now={p.probability}
                previous={previous?.predictions[target]?.probability}
                baseline={baseline?.predictions[target]?.probability}
                seq={seq}
              />
            </div>
          </div>
          <RiskTrack
            p={p.probability}
            threshold={p.threshold}
            ghost={baseline?.predictions[target]?.probability ?? null}
            pending={stale}
            showScale
            showThresholdLabel
          />
          <div className="relative h-5 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.p
                key={verdict}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: MOTION.fast / 1000, ease: EASE.out }}
                className="text-body-s font-medium text-primary"
              >
                {verdict}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className="text-label font-normal text-tertiary">
            Model estimate, not a diagnosis{stale ? ' · updating…' : ''}
            {status === 'error' && error ? ` · last update failed: ${error}` : ''}
          </p>
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
