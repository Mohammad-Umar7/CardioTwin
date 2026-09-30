import { ChevronRight } from 'lucide-react';
import { useMemo, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BandChip, Probability, RiskPip, Skeleton } from '@/design';
import { verdictFor } from '@/features/risk/verdict';
import { useSchemaIndex } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import { cn } from '@/lib/cn';
import { TEST_SET } from '@/lib/testSetCopy';
import { ROUTES } from '@/routes';
import { memoize, metricsResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import type { MetricsReport, TargetId } from '@/types/contracts';
import { flaggedCount, highestRiskVessel, topDrivers, vesselMarks } from './heroModel';
import { rocThumbnail } from './landingMetrics';

/** Where a pillar leads, plus an optional store action to run once the workstation stage is live. */
export interface LandingDestination {
  to: string;
  after?: () => void;
}

// ------------------------------------------------------------------------------ micro-visuals

function PredictVisual() {
  const cad = usePatientStore((s) => s.prediction?.predictions.CAD);
  const stale = usePatientStore((s) => s.status === 'loading');
  if (!cad) return <Skeleton className="h-6 w-24" />;
  // The CAD verdict sits under the band, like "k of 3 flagged" under the Map pips: a High band that is not
  // flagged (CAD's threshold is 75 %) then never reads as a contradiction of the vessel count beside it.
  const verdict = verdictFor(cad);
  return (
    <span className="flex items-center gap-2">
      <span data-prob="CAD">
        <Probability p={cad.probability} size="l" stale={stale} />
      </span>
      <span className="flex flex-col items-start gap-1">
        <BandChip band={cad.risk_band} pending={stale} size="sm" showMeter={false} />
        <span className={cn('whitespace-nowrap text-label font-normal text-tertiary', stale && 'opacity-50')}>
          <span aria-hidden className="mr-1">
            {verdict.glyph}
          </span>
          {verdict.word}
        </span>
      </span>
    </span>
  );
}

/** Three direction marks (V2 §5.5): ▶ raises, ◀ lowers, length in 3 steps by |SHAP| share. */
function ExplainVisual() {
  const prediction = usePatientStore((s) => s.prediction);
  const schema = useSchemaIndex();
  const drivers = useMemo(() => topDrivers(prediction, schema?.byKey, 'CAD', 3), [prediction, schema]);
  if (drivers.length === 0) return <Skeleton className="h-7 w-24" />;
  const description = drivers.map((d) => `${d.label} ${d.direction === 'up' ? 'raises' : 'lowers'} it`).join(', ');
  return (
    <span
      role="img"
      aria-label={`Top drivers of the CAD estimate: ${description}.`}
      className="relative flex w-[112px] flex-col gap-[5px] py-0.5"
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong" />
      {drivers.map((d) => {
        const up = d.direction === 'up';
        const color = up ? SHAP_RAISES : SHAP_LOWERS;
        const width = d.steps * 13;
        return (
          <span
            key={d.key}
            aria-hidden
            className={cn('flex h-[7px] items-center', up ? 'justify-start pl-[56px]' : 'flex-row-reverse justify-start pr-[56px]')}
          >
            <span className="h-full rounded-[1px]" style={{ backgroundColor: color, width }} />
            <svg width={5} height={7} viewBox="0 0 5 7" className="shrink-0" style={{ transform: up ? undefined : 'scaleX(-1)' }}>
              <path d="M0 0L5 3.5L0 7Z" fill={color} />
            </svg>
          </span>
        );
      })}
    </span>
  );
}

function MapVisual({ vessels }: { vessels: readonly TargetId[] }) {
  const prediction = usePatientStore((s) => s.prediction);
  const stale = usePatientStore((s) => s.status === 'loading');
  const marks = vesselMarks(prediction, vessels);
  const k = flaggedCount(prediction, vessels);
  if (!prediction) return <Skeleton className="h-5 w-28" />;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2.5">
        {marks.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1">
            <RiskPip p={stale ? null : m.p} />
            <span className="text-label text-secondary">{m.id}</span>
          </span>
        ))}
      </span>
      {k !== null && (
        <span className="text-label font-normal text-tertiary">
          {k} of {vessels.length} flagged
        </span>
      )}
    </span>
  );
}

/** Deferred full report: the ROC thumbnail is the only landing element that needs metrics.json. */
const idleMetrics = memoize<MetricsReport>(
  () =>
    new Promise<void>((resolve) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 2500 });
      else setTimeout(resolve, 1200);
    }).then(() => metricsResource.get()),
);

/** ROC thumbnail with the deployed operating point as the only accent mark; no numbers (V2 §6.1). */
function ValidateVisual() {
  const metrics = useResource(idleMetrics);
  const roc = useMemo(() => rocThumbnail(metrics.data, 'CAD'), [metrics.data]);
  const W = 88;
  const H = 44;
  if (!roc) return metrics.status === 'loading' ? <Skeleton className="h-11 w-[88px]" /> : null;
  const x = (v: number) => 1 + v * (W - 2);
  const y = (v: number) => H - 1 - v * (H - 2);
  const d = roc.points.map(([fx, ty], i) => `${i ? 'L' : 'M'}${x(fx).toFixed(1)} ${y(ty).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ROC curve of the CAD model on the held-out test set, with the deployed operating point">
      <path d={`M0.5 0.5V${H - 0.5}H${W}`} fill="none" stroke="rgb(var(--c-border-strong))" />
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="rgb(var(--c-border-strong))" strokeDasharray="2 3" />
      <path d={`${d} L${x(1)} ${y(0)} Z`} fill="rgb(var(--c-text-primary) / 0.05)" />
      <path d={d} fill="none" stroke="rgb(var(--c-text-secondary))" strokeWidth={1.5} strokeLinejoin="round" />
      {roc.operating && (
        <>
          <circle cx={x(roc.operating[0])} cy={y(roc.operating[1])} r={5} fill="rgb(var(--c-accent) / 0.18)" />
          <circle cx={x(roc.operating[0])} cy={y(roc.operating[1])} r={2.75} fill="rgb(var(--c-accent))" />
        </>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------------------------ pillars

interface PillarProps {
  n: string;
  verb: string;
  sentence: string;
  visual: ReactNode;
  destination: LandingDestination;
  linkLabel: string;
  onNavigate(destination: LandingDestination): void;
}

function Pillar({ n, verb, sentence, visual, destination, linkLabel, onNavigate }: PillarProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(destination);
  };
  return (
    <Link
      to={destination.to}
      onClick={onClick}
      aria-label={`${verb}: ${sentence} ${linkLabel}`}
      className="group relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-none bg-app px-5 py-3.5 outline-none transition-colors duration-instant hover:bg-surface-1 focus-visible:z-10 min-[1440px]:px-6 min-[1440px]:py-4"
    >
      <span className="col-start-1 flex items-baseline gap-2.5">
        <span className="mono text-mono-s text-tertiary">{n}</span>
        <span className="eyebrow text-primary">{verb}</span>
        <ChevronRight
          aria-hidden
          className="size-3.5 -translate-x-1 self-center stroke-[1.75] text-tertiary opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
        />
      </span>
      <span className="col-start-1 line-clamp-2 text-body-s text-secondary">{sentence}</span>
      <span className="col-start-2 row-span-2 row-start-1 flex items-center justify-end">
        {visual}
      </span>
    </Link>
  );
}

/**
 * Verb pillars (V2 §6.1): 01 Predict → 02 Explain → 03 Map → 04 Validate. Each has one sentence and a
 * live micro-visual from the hero patient, and deep-links into that state of the workstation (URL
 * `?t=` / `?panel=explain`, plus the equivalent store action once the stage is live) or into Performance.
 */
export function Pillars({ onNavigate, className }: { onNavigate(destination: LandingDestination): void; className?: string }) {
  const schema = useSchemaIndex();
  const vessels = useMemo(() => schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'], [schema]);
  const prediction = usePatientStore((s) => s.prediction);
  const focus = highestRiskVessel(prediction, vessels) ?? vessels[0] ?? 'LAD';

  return (
    <nav
      aria-label="What CardioTwin does"
      className={cn(
        'grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 min-[1100px]:grid-cols-4',
        className,
      )}
    >
      <Pillar
        n="01"
        verb="Predict"
        sentence="Calibrated CAD and per-artery risk."
        visual={<PredictVisual />}
        destination={{ to: ROUTES.workstation }}
        linkLabel="Opens the workstation."
        onNavigate={onNavigate}
      />
      <Pillar
        n="02"
        verb="Explain"
        sentence="Exact SHAP: what pushes it up or down."
        visual={<ExplainVisual />}
        destination={{
          to: `${ROUTES.workstation}?panel=explain&tab=why`,
          after: () => useUiStore.getState().openDrawer('explain', { tab: 'why' }),
        }}
        linkLabel="Opens the Explain drawer."
        onNavigate={onNavigate}
      />
      <Pillar
        n="03"
        verb="Map"
        sentence="Each artery coloured on real anatomy."
        visual={<MapVisual vessels={vessels} />}
        destination={{
          to: `${ROUTES.workstation}?t=${focus}`,
          after: () => useViewerStore.getState().select(focus),
        }}
        linkLabel={`Selects the ${focus} in 3D.`}
        onNavigate={onNavigate}
      />
      <Pillar
        n="04"
        verb="Validate"
        sentence={TEST_SET.pillar}
        visual={<ValidateVisual />}
        destination={{ to: ROUTES.performance }}
        linkLabel="Opens model performance."
        onNavigate={onNavigate}
      />
    </nav>
  );
}
