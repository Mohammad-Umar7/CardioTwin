import { useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { EmptyState, Skeleton } from '@/design';
import { useSchema, useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/state/uiStore';
import { FieldRow } from './FieldRow';
import { FindingChips } from './FindingChips';
import { useRowExpansion } from './hooks';
import { useGroupInfo, type GroupHeaderInfo } from './useGroupInfo';

function GroupSection({
  id,
  label,
  info,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  info: GroupHeaderInfo | undefined;
  open: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (region.current) region.current.inert = !open;
  }, [open]);
  return (
    <div className="border-b border-hairline" data-open={open || undefined}>
      <h3 className="m-0">
        <button
          id={`${id}-button`}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-region`}
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-2 px-4 text-left transition-colors duration-instant hover:bg-surface-1"
        >
          <ChevronRight aria-hidden className={cn('size-4 shrink-0 stroke-[1.5] text-tertiary transition-transform duration-fast ease-out', open && 'rotate-90')} />
          <span className="min-w-0 truncate text-body-s font-medium text-primary">{label}</span>
          {info && info.edited > 0 && (
            <span className="inline-flex items-center">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              <span className="sr-only">, {info.edited} edited</span>
            </span>
          )}
          {info && info.imputed > 0 && <span className="ml-auto text-label font-normal text-tertiary">{info.imputed} imputed</span>}
        </button>
      </h3>
      <div
        ref={region}
        id={`${id}-region`}
        role="region"
        aria-labelledby={`${id}-button`}
        className={cn('grid transition-[grid-template-rows] duration-base ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
        <div className="min-h-0 overflow-clip">{children}</div>
      </div>
    </div>
  );
}

/**
 * ClinicalForm — every input, grouped by schema group, with the V2 rows (WORKSTATION_V2 §5.6): 32 px
 * numeric rows that expand on focus, segmented categoricals and one FindingChips cloud per group. No
 * share bars, no signed sums, no 11 px captions.
 *
 * Used where the Inputs drawer is not (the stacked compact layout and the `?layout=legacy` grid); the
 * workstation stage uses `InputsDrawer`. Open groups live in `uiStore.panels.openGroups` for those
 * layouts; `exclusive` keeps one group open at a time.
 */
export function ClinicalForm({ exclusive = false, groups }: { exclusive?: boolean; groups?: string[] }) {
  const schema = useSchema();
  const index = useSchemaIndex();
  const openGroups = useUiStore((s) => s.panels.openGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const info = useGroupInfo(index);
  const { expanded, handlers } = useRowExpansion();

  if (schema.status === 'loading' || (!index && schema.status === 'ready')) {
    return (
      <div className="flex flex-col gap-3 px-4 py-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    );
  }
  if (!index) {
    return (
      <EmptyState title="Feature schema unavailable" className="m-4">
        The model artifacts (<span className="mono">model/schema.json</span>) have not been published yet, and the API
        is not reachable. Inputs appear here as soon as either is available.
      </EmptyState>
    );
  }

  const visible = groups ? index.groups.filter((g) => groups.includes(g.id)) : index.groups;
  return (
    <div className="border-t border-hairline" role="group" aria-label="Clinical inputs" {...handlers}>
      {visible.map((g) => {
        const open = openGroups.includes(g.id);
        const rows = g.features.filter((f) => f.type !== 'binary');
        const chips = g.features.filter((f) => f.type === 'binary');
        return (
          <GroupSection key={g.id} id={`group-${g.id}`} label={g.label} info={info.get(g.id)} open={open} onToggle={() => toggleGroup(g.id, exclusive)}>
            <div className="flex flex-col px-3 pb-2 pt-0.5">
              {rows.map((f) => {
                const rowId = `form-${g.id}:${f.key}`;
                return <FieldRow key={f.key} spec={f} rowId={rowId} expanded={expanded === rowId} />;
              })}
              <FindingChips specs={chips} label={`${g.label} findings`} idPrefix={`form-${g.id}`} className={rows.length ? 'pt-1.5' : undefined} />
            </div>
          </GroupSection>
        );
      })}
    </div>
  );
}
