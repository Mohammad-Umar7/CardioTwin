import { Probability, RiskPip, RiskTrack, Skeleton } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatProbability, formatShownDeltaPts } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetSpec } from '@/types/contracts';
import { useCohortPatient, useRiskView } from './useRiskView';
import { cathComparison, spokenVerdict, verdictFor } from './verdict';

/** Column template shared by the rows and their skeletons (V2 §5.8 VesselRow v2). */
const GRID = 'grid-cols-[8px_32px_52px_minmax(56px,1fr)_80px]';
const GRID_DELTA = 'grid-cols-[8px_32px_52px_34px_minmax(40px,1fr)_80px]';

export interface VesselRowProps {
  spec: TargetSpec;
  /** Omit `data-prob` (the row is covered by a drawer, so its numeral is not this number's home). */
  covered?: boolean;
}

/**
 * VesselRow v2 (WORKSTATION_V2 §5.8): pip · code · % (`data-prob`) · Δ (edits only) · track with the
 * vessel's own threshold tick · verdict ("● Flagged" / "○ Not flagged"). The whole row is one toggle button:
 * hover lights the 3D vessel, click selects it (camera, inspector and drawer follow from `select`).
 * The band word lives in the inspector, never on the row (§3.1).
 */
export function VesselRow({ spec, covered = false }: VesselRowProps) {
  const view = useRiskView();
  const revealed = usePatientStore((s) => s.revealed);
  const patient = useCohortPatient();
  const selected = useViewerStore((s) => s.selectedStructure === spec.id);
  const hovered = useViewerStore((s) => s.hoveredStructure === spec.id);
  const p = view.prediction?.predictions[spec.id];
  const base = view.baseline?.predictions[spec.id];
  const verdict = p ? verdictFor(p) : null;
  const showDelta = view.edits > 0;
  const delta = p && base ? formatShownDeltaPts(base.probability, p.probability) : null;
  const truth = revealed ? cathComparison(spec.id, patient?.labels[spec.id], view.recorded?.predictions[spec.id]) : null;
  const viewer = useViewerStore.getState;

  const label = p
    ? `${spec.label}, ${formatProbability(p.probability).spoken}, ${view.stale ? 'updating' : spokenVerdict(p)}${
        delta && delta.direction !== 'none' ? `, ${delta.spoken} from the recorded value` : ''
      }`
    : `${spec.label}, estimate unavailable`;

  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${label}. ${selected ? 'Selected; press to clear the selection' : 'Select to focus the 3D view'}`}
        onClick={() => viewer().select(selected ? null : spec.id)}
        onMouseEnter={() => viewer().hover(spec.id)}
        onMouseLeave={() => viewer().hover(null)}
        className={cn(
          'group relative grid w-full items-center gap-x-1.5 rounded-sm px-2 text-left outline-none transition-colors duration-instant ease-instant',
          'focus-visible:shadow-focus',
          truth ? 'h-[52px] content-center gap-y-0.5' : 'h-9',
          showDelta ? GRID_DELTA : GRID,
          selected ? 'bg-surface-2' : hovered ? 'bg-surface-1' : 'hover:bg-surface-1',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent transition-opacity duration-instant',
            selected ? 'opacity-100' : 'opacity-0',
          )}
        />
        <RiskPip p={view.stale || !p ? null : p.probability} />
        <span className="text-body-s font-semibold text-primary">{spec.short ?? spec.id}</span>
        {p ? (
          <Probability
            p={p.probability}
            target={covered ? undefined : spec.id}
            size="l"
            stale={view.stale}
            className="text-right [&_.pct-sign]:font-normal"
          />
        ) : view.unavailable ? (
          <span className="text-right text-body-s text-tertiary">–</span>
        ) : (
          <Skeleton className="ml-auto h-5 w-10" />
        )}
        {showDelta && (
          <span className="num whitespace-nowrap text-right text-label font-normal text-secondary" aria-hidden>
            {delta && delta.direction !== 'none' ? `${delta.glyph}${delta.text.replace(/[^\d≥]/g, '')}` : '·'}
          </span>
        )}
        <RiskTrack
          p={p?.probability}
          threshold={p?.threshold}
          ghost={base?.probability ?? null}
          pending={view.stale || !p}
          compact
        />
        <span
          className={cn(
            'whitespace-nowrap text-label font-normal',
            view.stale || !verdict ? 'text-tertiary' : verdict.flagged ? 'text-primary' : 'text-secondary',
          )}
        >
          {view.unavailable ? (
            'Unavailable'
          ) : view.stale ? (
            'Updating'
          ) : verdict ? (
            <>
              <span aria-hidden className="mr-1">
                {verdict.glyph}
              </span>
              {verdict.word}
            </>
          ) : null}
        </span>
        {truth && (
          <span className="col-span-full flex items-center gap-1.5 pl-[14px] text-label font-normal text-secondary">
            <span aria-hidden className="text-primary">
              {truth.truth === 1 ? '●' : '○'}
            </span>
            {truth.truthText}
            <span aria-hidden>·</span>
            <span className={truth.agrees ? 'text-success' : 'text-primary'}>{truth.agreementText}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** The three vessel rows (schema order, LAD · LCX · RCA), or pixel-matched skeletons while the schema loads. */
export function VesselRows({ covered = false, className }: { covered?: boolean; className?: string }) {
  const index = useSchemaIndex();
  const vessels = index?.vessels ?? [];
  return (
    <ul data-region="vessel-rows" data-tour="vessels" aria-label="Vessels" className={cn('-mx-2 flex flex-col', className)}>
      {vessels.length === 0
        ? [0, 1, 2].map((i) => (
            <li key={i} className={cn('grid h-9 items-center gap-x-1.5 px-2', GRID)}>
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="ml-auto h-5 w-10" />
              <Skeleton className="h-1" />
              <Skeleton className="h-4 w-16" />
            </li>
          ))
        : vessels.map((v) => <VesselRow key={v.id} spec={v} covered={covered} />)}
    </ul>
  );
}
