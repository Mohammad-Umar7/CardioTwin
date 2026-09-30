import { RefreshCw, Rotate3d } from 'lucide-react';
import { useMemo } from 'react';
import { RiskPip } from '@/design';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetId } from '@/types/contracts';
import { attractBlurb, circled } from './attract';

/** Static radial-gradient poster painted under the canvas so the hero never flashes blank. */
export function HeroPoster() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ background: 'radial-gradient(70% 80% at 66% 42%, #11161C 0%, #0B0E12 55%, #07090C 100%)' }}
    />
  );
}

const splitCaption = (split: string | null, mode: string): string =>
  split === 'test'
    ? 'held-out test patient'
    : split === 'dev'
      ? 'development patient'
      : mode === 'cohort'
        ? 'cohort patient'
        : 'blank patient';

/** "P-011 · held-out test patient · Next ↻" (V2 §6.1), centred under the heart. */
function PatientCaption() {
  const cohort = useCohort();
  const patientId = usePatientStore((s) => s.selectedPatientId);
  const split = usePatientStore((s) => s.split);
  const mode = usePatientStore((s) => s.mode);
  const loadPatient = usePatientStore((s) => s.loadPatient);
  const pool = useMemo(() => cohort.data?.patients.filter((p) => p.split === 'test') ?? [], [cohort.data]);

  if (!patientId && mode === 'cohort') return <span className="skeleton block h-8 w-64 rounded-full" aria-hidden />;

  const next = () => {
    if (pool.length === 0) return;
    const i = pool.findIndex((p) => p.id === patientId);
    loadPatient(pool[(i + 1) % pool.length]!);
  };

  return (
    <div className="pointer-events-auto flex h-8 items-center gap-2 rounded-full bg-panel pl-3 pr-1 text-label font-normal text-secondary shadow-e2">
      {patientId && <span className="mono text-mono-s text-primary">{patientId}</span>}
      <span aria-hidden className="text-tertiary">·</span>
      <span>{splitCaption(split, mode)}</span>
      {pool.length > 1 && (
        <>
          <span aria-hidden className="text-tertiary">·</span>
          <button
            type="button"
            onClick={next}
            className="inline-flex h-6 items-center gap-1 rounded-full px-2 font-medium text-secondary transition-colors duration-instant hover:bg-surface-2 hover:text-primary"
            aria-label="Show the next held-out test patient"
          >
            Next <RefreshCw aria-hidden className="size-3 stroke-[1.75]" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Attract-mode caption (P3): the highlighted hotspot as a context chip at the top of the free area, the
 * same place the workstation shows its selection chip. Colour is backed by the code here and by the %
 * on the vessel's 3D label.
 */
function AttractCaption({ target, index }: { target: TargetId; index: number }) {
  const schema = useSchemaIndex();
  const p = usePatientStore((s) => s.prediction?.predictions[target]?.probability ?? null);
  const spec = schema?.targetById.get(target);
  const blurb = attractBlurb(target, spec?.label, spec?.territory);
  return (
    <div
      key={target}
      className="flex h-8 items-center gap-2 whitespace-nowrap rounded-full bg-panel pl-2.5 pr-3.5 text-body-s shadow-e2 animate-rise-in"
    >
      <span aria-hidden className="text-body-s text-tertiary">
        {circled(index + 1)}
      </span>
      <RiskPip p={p} />
      <span className="font-semibold text-primary">{target}</span>
      <span className="text-secondary">{blurb.name}</span>
      {blurb.feeds && <span className="text-tertiary">· {blurb.feeds}</span>}
    </div>
  );
}

export interface HeroHudProps {
  /** Highlighted vessel while attract mode runs. */
  attract: TargetId | null;
  vessels: readonly TargetId[];
  leaving: boolean;
}

/**
 * Hero overlays inside the canvas slot (V2 §6.1): the copy-contrast gradient (chrome, not glass), the
 * attract caption, the patient caption under the heart and the "Interactive 3D" tag. The anatomy credit
 * lives in the status line on every anatomy route (V2 §5.17).
 * Everything that is not a control lets pointer events through to the canvas.
 */
export function HeroHud({ attract, vessels, leaving }: HeroHudProps) {
  const anatomySource = useViewerStore((s) => s.anatomySource);
  return (
    <>
      {/* Left-to-right bg/app → transparent over 0–45 % of the width guarantees the copy's contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-hud hidden w-[45%] min-[1100px]:block"
        style={{
          background:
            'linear-gradient(90deg, rgb(var(--c-bg-app)) 0%, rgb(var(--c-bg-app) / 0.86) 42%, rgb(var(--c-bg-app) / 0) 100%)',
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-panels transition-opacity duration-base',
          leaving ? 'opacity-0 ease-exit' : 'ease-out',
        )}
      >
        {/* Free-area centre (published with the stage insets); the middle when the landing stacks. */}
        <div className="absolute left-1/2 top-6 flex -translate-x-1/2 justify-center min-[1100px]:left-[var(--landing-free-cx,66%)]" aria-live="off">
          {attract && <AttractCaption target={attract} index={Math.max(0, vessels.indexOf(attract))} />}
        </div>
        {anatomySource === 'procedural' && (
          <span className="absolute left-4 top-4 text-label font-normal text-tertiary min-[1100px]:left-[34%]">
            Schematic heart · anatomy loading unavailable
          </span>
        )}
        <div
          className="absolute left-1/2 flex -translate-x-1/2 justify-center whitespace-nowrap min-[1100px]:left-[var(--landing-free-cx,66%)]"
          style={{ bottom: 'calc(var(--landing-bands-h, 0px) + 16px)' }}
        >
          <PatientCaption />
        </div>
        <div
          className="absolute right-4 hidden flex-col items-end gap-0.5 min-[1100px]:flex"
          style={{ bottom: 'calc(var(--landing-bands-h, 0px) + 14px)' }}
        >
          <span className="inline-flex items-center gap-1.5 text-label font-normal text-tertiary">
            <Rotate3d aria-hidden className="size-3.5 stroke-[1.5]" />
            Interactive 3D · drag to rotate
          </span>
        </div>
      </div>
    </>
  );
}
