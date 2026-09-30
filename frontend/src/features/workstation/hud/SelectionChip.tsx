import { X } from 'lucide-react';
import { IconButton, RiskPip, StageCard } from '@/design';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { formatCarm } from '@/three/camera/presets';

/**
 * SelectionChip — WORKSTATION_V2 §5.12: `● LAD · RAO 30° CRA 25° ✕`. Rendered first in StageLayout's
 * `top` (context) slot, centred on the free area; the WhatIfPill sits beside it.
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent D on creation; A never edits this file again.
 *
 * Contract:
 *   export interface SelectionChipProps { className?: string }
 *   - Renders nothing while `viewerStore.selectedStructure` is null.
 *   - StageCard `shape="chip"`, `data-region="selection-chip"`; pip + code (body-s 600) + live C-arm
 *     angles (`viewerStore.carm`, mono-s tertiary); variants "LAD · Isolated ✕", "LAD · Others ghosted ✕".
 *   - ✕ clears the selection (`select(null)`); with isolate/ghost active it ends those first.
 */
export interface SelectionChipProps {
  className?: string;
}

export function SelectionChip({ className }: SelectionChipProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const carm = useViewerStore((s) => s.carm);
  const isolate = useViewerStore((s) => s.isolate);
  const ghost = useViewerStore((s) => s.ghostOthers);
  const p = usePatientStore((s) => (selected ? selectDisplayedPrediction(s)?.predictions[selected]?.probability : null));
  if (!selected) return null;
  return (
    <StageCard as="div" shape="chip" region="selection-chip" className={`pr-1 ${className ?? ''}`}>
      <RiskPip p={p ?? null} />
      <span className="text-body-s font-semibold text-primary">{selected}</span>
      {isolate || ghost ? (
        <span className="text-label font-normal text-secondary">{isolate ? 'Isolated' : 'Others ghosted'}</span>
      ) : (
        carm && <span className="mono text-mono-s text-tertiary">{formatCarm(carm.azimuth, carm.elevation)}</span>
      )}
      <IconButton
        label="Clear selection · Esc"
        icon={<X />}
        size="xs"
        className="rounded-full"
        onClick={() => {
          const v = useViewerStore.getState();
          if (v.isolate || v.ghostOthers) {
            v.setIsolate(false);
            v.setGhostOthers(false);
          } else v.select(null);
        }}
      />
    </StageCard>
  );
}
