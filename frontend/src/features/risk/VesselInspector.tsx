import { EyeOff, Focus, MessageSquareText, X } from 'lucide-react';
import { Button, IconButton, RiskPip, StageCard } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

/**
 * VesselInspector — WORKSTATION_V2 §5.9. Answers "Why this vessel?". Exists only while a vessel is
 * selected; rendered in StageLayout's `right` column, 8 px below the Risk card (in focus mode it is the
 * only card there).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent C on creation; A never edits this file again.
 *
 * Contract:
 *   export interface VesselInspectorProps { className?: string }
 *   - Renders nothing while `viewerStore.selectedStructure` is null.
 *   - StageCard, `region="inspector"`; header pip + code (title-2) + full name + ✕ (`select(null)`).
 *   - Reconciling sentence (band vs threshold), vessel narrative, Top drivers only while
 *     `!selectPatientCardExpanded(uiStore)`, actions Isolate (O: `setIsolate`), Ghost others (G:
 *     `setGhostOthers`), Why (E: `openDrawer('explain', { tab: 'why' })`).
 *   - Never a probability numeral (its home is the vessel row); prose may cite it only when the row is hidden.
 */
export interface VesselInspectorProps {
  className?: string;
}

export function VesselInspector({ className }: VesselInspectorProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const isolate = useViewerStore((s) => s.isolate);
  const ghost = useViewerStore((s) => s.ghostOthers);
  const index = useSchemaIndex();
  const p = usePatientStore((s) => (selected ? selectDisplayedPrediction(s)?.predictions[selected]?.probability : null));
  if (!selected) return null;
  const spec = index?.vessels.find((v) => v.id === selected);
  const viewer = useViewerStore.getState;

  return (
    <StageCard region="inspector" aria-label={`${selected} inspector`} className={`flex flex-col gap-3 ${className ?? ''}`}>
      <header className="flex items-center gap-2">
        <RiskPip p={p ?? null} />
        <h2 className="text-title-2 text-primary">{selected}</h2>
        {spec && <span className="min-w-0 flex-1 truncate text-body-s text-secondary">{spec.label}</span>}
        <IconButton label="Clear selection · Esc" icon={<X />} size="sm" className="ml-auto" onClick={() => viewer().select(null)} />
      </header>
      {spec?.territory && <p className="text-body-s text-secondary">Supplies {spec.territory}.</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={isolate}
          className={isolate ? 'bg-surface-2 text-accent' : undefined}
          iconLeft={<Focus className="stroke-[1.5]" />}
          onClick={() => viewer().setIsolate(!isolate)}
        >
          Isolate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={ghost}
          className={ghost ? 'bg-surface-2 text-accent' : undefined}
          iconLeft={<EyeOff className="stroke-[1.5]" />}
          onClick={() => viewer().setGhostOthers(!ghost)}
        >
          Ghost others
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<MessageSquareText className="stroke-[1.5]" />}
          onClick={() => useUiStore.getState().openDrawer('explain', { tab: 'why' })}
        >
          Why
        </Button>
      </div>
    </StageCard>
  );
}
