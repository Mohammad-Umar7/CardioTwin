import { ChevronRight } from 'lucide-react';
import { BandChip, Probability, RiskTrack, SectionHeader, Skeleton, Tooltip } from '@/design';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { usePrediction } from '@/hooks/usePrediction';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetSpec } from '@/types/contracts';
import { DeltaChip } from './DeltaChip';

function GroundTruth({ target, predictedLabel }: { target: string; predictedLabel: 0 | 1 }) {
  const cohort = useCohort();
  const id = usePatientStore((s) => s.selectedPatientId);
  const patient = cohort.data?.patients.find((p) => p.id === id);
  const truth = patient?.labels[target];
  if (truth === undefined) return null;
  const agrees = truth === predictedLabel;
  return (
    <span className="flex items-center gap-1.5 text-[0.6875rem] text-secondary">
      <span aria-hidden className="text-primary">
        {truth === 1 ? '●' : '○'}
      </span>
      {truth === 1 ? 'stenotic at cath' : 'not stenotic at cath'}
      <span className={cn('font-semibold', agrees ? 'text-success' : 'text-primary')}>{agrees ? 'agrees ✓' : 'disagrees ✕'}</span>
    </span>
  );
}

/**
 * VesselRow (DESIGN_SYSTEM §5): name, probability, track with threshold tick, band chip, ▸ focus. Hover
 * lights the 3D vessel; click / ▸ selects it (camera flies to its C-arm view, WHY follows).
 */
export function VesselRow({ spec }: { spec: TargetSpec }) {
  const { prediction, previous, baseline, status, seq } = usePrediction();
  const revealed = usePatientStore((s) => s.revealed);
  const selected = useViewerStore((s) => s.selectedStructure === spec.id);
  const hovered = useViewerStore((s) => s.hoveredStructure === spec.id);
  const select = useViewerStore((s) => s.select);
  const hover = useViewerStore((s) => s.hover);
  const stale = useDelayedFlag(status === 'loading', 150);
  const p = prediction?.predictions[spec.id];
  const band = p ? bandStyle(p.risk_band) : null;

  return (
    <li
      className={cn(
        'group relative flex flex-col gap-1 border-l-2 py-1.5 pl-2.5 pr-1 transition-colors duration-fast',
        selected ? 'border-accent bg-surface-2' : hovered ? 'border-transparent bg-surface-1' : 'border-transparent',
      )}
      onMouseEnter={() => hover(spec.id)}
      onMouseLeave={() => hover(null)}
    >
      <div className="flex h-7 items-center gap-2">
        <button
          type="button"
          onClick={() => select(selected ? null : spec.id)}
          aria-pressed={selected}
          aria-label={`${spec.label}${p ? `, ${Math.round(p.probability * 100)} percent, ${band?.label}` : ''}. ${selected ? 'Selected' : 'Select to focus the 3D view'}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left"
        >
          <Tooltip content={`${spec.label}${spec.territory ? ` · supplies ${spec.territory.toLowerCase()} (approx.)` : ''}`}>
            <span className="w-9 shrink-0 text-body-s font-semibold text-primary">{spec.short ?? spec.id}</span>
          </Tooltip>
          {p ? <Probability p={p.probability} size="l" stale={stale} className="w-14 text-right" /> : <Skeleton className="h-5 w-12" />}
          <RiskTrack p={p?.probability} threshold={p?.threshold} ghost={baseline?.predictions[spec.id]?.probability ?? null} pending={stale || !p} compact className="flex-1" />
        </button>
        <BandChip band={band?.id ?? null} pending={!p || stale} size="sm" showMeter={false} className="w-[74px] justify-start" />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => select(selected ? null : spec.id)}
          className="rounded-sm p-0.5 text-tertiary opacity-60 transition-opacity group-hover:opacity-100 hover:text-primary"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      {(revealed || baseline) && p && (
        <div className="flex items-center justify-between gap-2 pl-11">
          {revealed ? <GroundTruth target={spec.id} predictedLabel={p.label} /> : <span />}
          {baseline && (
            <DeltaChip now={p.probability} previous={previous?.predictions[spec.id]?.probability} baseline={baseline.predictions[spec.id]?.probability} seq={seq} />
          )}
        </div>
      )}
    </li>
  );
}

/** Vessel rows for every vessel target in the schema, plus the expected number of diseased vessels. */
export function VesselList() {
  const index = useSchemaIndex();
  const { prediction } = usePrediction();
  const vessels = index?.vessels ?? [];
  const expected = prediction?.summary.expected_diseased_vessels;

  return (
    <section aria-labelledby="vessels-title" className="flex flex-col gap-1.5" data-tour="vessels">
      <SectionHeader id="vessels-title" title="Vessels" aside={<span>P(stenosis)</span>} />
      {vessels.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {vessels.map((v) => (
            <VesselRow key={v.id} spec={v} />
          ))}
        </ul>
      )}
      {typeof expected === 'number' && (
        <Tooltip content="Sum of the three vessel probabilities: the expected number of vessels with ≥ 50 % narrowing.">
          <p tabIndex={0} className="self-start text-label font-normal text-secondary">
            ≈ <span className="num text-primary">{formatNumber(expected, 0.1)}</span> of {vessels.length} vessels expected
            stenotic
          </p>
        </Tooltip>
      )}
    </section>
  );
}
