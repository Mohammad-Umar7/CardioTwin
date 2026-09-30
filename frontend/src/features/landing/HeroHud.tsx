import { RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { IconButton, RiskLegend } from '@/design';
import { useCohort } from '@/hooks/useData';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

/** Static radial-gradient poster painted under the canvas so the hero never flashes blank. */
export function HeroPoster() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ background: 'radial-gradient(120% 90% at 50% 40%, #11161C 0%, #06080A 70%)' }}
    />
  );
}

/** Canvas watermark (DESIGN_SYSTEM §9), research DICOM-viewer convention. */
export function Watermark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none select-none text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-tertiary/60 ${className}`}
    >
      Not for diagnostic use
    </span>
  );
}

export function Credits({ className = '' }: { className?: string }) {
  return (
    <span className={`pointer-events-none text-[0.6875rem] leading-4 text-tertiary ${className}`}>
      BodyParts3D © DBCLS · CC BY-SA 2.1 JP
    </span>
  );
}

/** Landing hero HUD: legend, the held-out patient on display with "next", watermark and credits. */
export function HeroHud() {
  const cohort = useCohort();
  const patientId = usePatientStore((s) => s.selectedPatientId);
  const loadPatient = usePatientStore((s) => s.loadPatient);
  const anatomySource = useViewerStore((s) => s.anatomySource);
  const testPatients = useMemo(() => cohort.data?.patients.filter((p) => p.split === 'test') ?? [], [cohort.data]);

  const next = () => {
    if (testPatients.length === 0) return;
    const i = testPatients.findIndex((p) => p.id === patientId);
    loadPatient(testPatients[(i + 1) % testPatients.length]!);
  };

  return (
    <>
      <Watermark className="absolute right-4 top-3 z-hud" />
      {anatomySource === 'procedural' && (
        <span className="absolute left-4 top-3 z-hud text-label font-normal text-tertiary">Schematic heart · anatomy loading unavailable</span>
      )}
      <div className="absolute inset-x-4 bottom-3 z-hud flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <RiskLegend />
          {patientId && (
            <div className="hud-chip pointer-events-auto flex h-7 items-center gap-2 pl-2 pr-0.5 text-label text-secondary">
              <span className="mono text-mono-s text-primary">{patientId}</span>
              <span>· held-out test patient</span>
              <IconButton
                label="Show the next held-out test patient"
                icon={<RefreshCw />}
                size="xs"
                onClick={next}
                disabled={testPatients.length < 2}
              />
            </div>
          )}
        </div>
        <Credits />
      </div>
    </>
  );
}
