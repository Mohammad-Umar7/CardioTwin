import { X } from 'lucide-react';
import { IconButton, RiskPip, StageCard } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetId } from '@/types/contracts';
import { formatCarm } from '@/three/camera/presets';
import { usePresence } from './presence';

/** "RAO 30° CRA 25°" (the C-arm readout, now inside a legible chip). */
const chipAngles = (azimuth: number, elevation: number): string => formatCarm(azimuth, elevation).replace(' · ', ' ');

/**
 * SelectionChip — WORKSTATION_V2 §5.12: `● LAD · RAO 30° CRA 25° ✕` in the context slot (top, centred on the
 * free area; the what-if pill sits beside it). h 32, r-full, stage-card material: pip, the code in body-s
 * 600, the live C-arm angles in mono-s text/tertiary (they tick during the camera flight, then settle).
 * Variants "LAD · Isolated ✕" and "LAD · Others ghosted ✕": ✕ ends those first, then the selection.
 * Enter / exit: fade + y −4 over `fast`.
 */
export interface SelectionChipProps {
  className?: string;
}

export function SelectionChip({ className }: SelectionChipProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const carm = useViewerStore((s) => s.carm);
  const isolate = useViewerStore((s) => s.isolate);
  const ghost = useViewerStore((s) => s.ghostOthers);
  const reduced = useIsReducedMotion();
  const { shown, phase } = usePresence<TargetId>(selected, reduced);
  const p = usePatientStore((s) => (shown ? selectDisplayedPrediction(s)?.predictions[shown]?.probability : null));
  const status = usePatientStore((s) => s.status);
  if (!shown) return null;

  const mode = isolate ? 'Isolated' : ghost ? 'Others ghosted' : null;
  const clearLabel = mode ? `End ${mode === 'Isolated' ? 'isolate' : 'ghosting'} · Esc` : 'Clear selection · Esc';

  return (
    <StageCard
      as="div"
      shape="chip"
      region="selection-chip"
      noEnter
      data-state={phase}
      className={cn(
        'gap-0 pl-3 pr-1 transition-[opacity,transform] motion-reduce:!translate-y-0',
        phase === 'open' ? 'translate-y-0 opacity-100 duration-fast ease-out' : '-translate-y-1 opacity-0',
        phase === 'closed' && 'duration-[110ms] ease-exit',
        className,
      )}
    >
      <RiskPip p={status === 'error' && p == null ? null : (p ?? null)} />
      <span className="ml-2 text-body-s font-semibold text-primary">{shown}</span>
      <span aria-hidden className="mx-1.5 text-tertiary">
        ·
      </span>
      {mode ? (
        <span className="text-label font-normal text-secondary">{mode}</span>
      ) : (
        <span className="mono min-w-[112px] text-mono-s tabular-nums text-tertiary" aria-live="off">
          {carm ? chipAngles(carm.azimuth, carm.elevation) : '—'}
        </span>
      )}
      <IconButton
        label={clearLabel}
        icon={<X />}
        size="xs"
        className="ml-1 rounded-full"
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
