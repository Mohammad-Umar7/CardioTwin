import { Accordion, AccordionItem, EmptyState, Skeleton } from '@/design';
import { useSchema, useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { shareSegments } from '@/lib/explain';
import { formatShap } from '@/lib/format';
import { useUiStore } from '@/state/uiStore';
import { FeatureField } from './fields';
import { useGroupInfo, type GroupHeaderInfo } from './useGroupInfo';

/** 4-segment |SHAP|-share mini bar (text/secondary, never risk colour). */
function ShareBar({ segments }: { segments: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <span aria-hidden className="inline-flex gap-[2px]">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-2 w-1.5 rounded-xs', i <= segments ? 'bg-secondary' : 'bg-line')} />
      ))}
    </span>
  );
}

export function GroupHeader({ label, info }: { label: string; info: GroupHeaderInfo | undefined }) {
  return (
    <>
      <span className="eyebrow truncate text-secondary">{label}</span>
      {info && info.edited > 0 && (
        <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-accent">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {info.edited}
          <span className="sr-only"> edited</span>
        </span>
      )}
      {info && info.imputed > 0 && <span className="text-[0.6875rem] text-tertiary">{info.imputed} imputed</span>}
    </>
  );
}

export function GroupAside({ info }: { info: GroupHeaderInfo | undefined }) {
  if (!info || info.sum === null) return null;
  return (
    <>
      <ShareBar segments={shareSegments(info.share)} />
      <span className="num w-11 text-right text-numeral-m text-secondary">{formatShap(info.sum)}</span>
    </>
  );
}

/**
 * ClinicalForm (DESIGN_SYSTEM §4.2 left panel): generated entirely from schema.json — groups in schema
 * order, each feature rendered by type (numeric slider with reference band, binary No|Yes, categorical
 * segments). Group headers show edits, imputed inputs and the group's share of |SHAP| for the selected
 * target. `exclusive` keeps one group open at a time (1280 layout).
 */
export function ClinicalForm({ exclusive = false, groups }: { exclusive?: boolean; groups?: string[] }) {
  const schema = useSchema();
  const index = useSchemaIndex();
  const openGroups = useUiStore((s) => s.panels.openGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const info = useGroupInfo(index);

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
    <Accordion label="Clinical inputs">
      {visible.map((g) => (
        <AccordionItem
          key={g.id}
          id={`group-${g.id}`}
          open={openGroups.includes(g.id)}
          onToggle={() => toggleGroup(g.id, exclusive)}
          header={<GroupHeader label={g.label} info={info.get(g.id)} />}
          aside={<GroupAside info={info.get(g.id)} />}
        >
          <div className="flex flex-col pb-2 pt-0.5">
            {g.features.map((f) => (
              <FeatureField key={f.key} spec={f} />
            ))}
          </div>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
