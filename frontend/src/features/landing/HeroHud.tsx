import { RefreshCw, Rotate3d } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RiskPip } from '@/design';
import { VitalsStrip } from '@/features/vitals/EcgMonitor';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
  const narrow = useMediaQuery('(max-width: 639.98px)');

  if (!patientId && mode === 'cohort') return <span className="skeleton block h-11 w-96 rounded-full" aria-hidden />;

  const next = () => {
    if (pool.length === 0) return;
    const i = pool.findIndex((p) => p.id === patientId);
    loadPatient(pool[(i + 1) % pool.length]!);
  };

  // LUMEN 2: the caption is the twin's bedside monitor — the live ECG strip (locked to the beating heart) at the
  // patient's recorded rate, then who this patient is and the way to the next one. Phones keep the strip short
  // and the patient id only, so the chip never outgrows the screen.
  return (
    <div className="glass glass-edge pointer-events-auto flex h-11 max-w-[calc(100vw-24px)] items-center gap-3 rounded-full pl-4 pr-1.5 text-label font-normal text-secondary max-[639.98px]:gap-2 max-[639.98px]:pl-3">
      <VitalsStrip width={narrow ? 64 : 136} height={28} caption={!narrow} className="relative z-[1]" />
      <span aria-hidden className="relative z-[1] h-5 w-px bg-white/[0.12]" />
      <span className="relative z-[1] flex min-w-0 items-center gap-2">
        {patientId && <span className="mono text-mono-s text-primary">{patientId}</span>}
        <span aria-hidden className="text-tertiary max-[639.98px]:hidden">·</span>
        <span className="truncate max-[639.98px]:hidden">{splitCaption(split, mode)}</span>
      </span>
      {pool.length > 1 && (
        <button
          type="button"
          onClick={next}
          className="group/next relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 font-medium text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] duration-fast hover:bg-white/[0.1] hover:shadow-[inset_0_0_0_1px_rgba(86,194,230,0.4),0_0_16px_-6px_rgba(86,194,230,0.7)]"
          aria-label="Show the next held-out test patient"
        >
          Next
          <RefreshCw
            aria-hidden
            className="size-3 stroke-[2] transition-transform duration-base ease-out group-hover/next:rotate-180"
          />
        </button>
      )}
    </div>
  );
}

/**
 * Attract-mode caption (P3): the highlighted hotspot as a context chip in the free stage space at the top
 * right, clear of the heart and its great vessels. Colour is backed by the code here and by the %
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
      className="glass glass-edge flex h-9 max-w-[calc(100vw-24px)] items-center gap-2 whitespace-nowrap rounded-full pl-3 pr-4 text-body-s animate-blur-in"
    >
      <span aria-hidden className="relative z-[1] text-body-s text-tertiary">
        {circled(index + 1)}
      </span>
      <RiskPip p={p} className="relative z-[1]" />
      <span className="relative z-[1] font-semibold text-primary">{target}</span>
      <span className="relative z-[1] min-w-0 truncate text-secondary">{blurb.name}</span>
      {blurb.feeds && <span className="relative z-[1] text-tertiary max-[639.98px]:hidden">· {blurb.feeds}</span>}
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
/** How long the "drag to rotate" affordance stays up when nobody touches the stage (ms). */
const HINT_MS = 6000;

function useStageHint(): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const hide = () => setShown(false);
    const t = window.setTimeout(hide, HINT_MS);
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('canvas')) hide();
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);
  return shown;
}

export function HeroHud({ attract, vessels, leaving }: HeroHudProps) {
  const anatomySource = useViewerStore((s) => s.anatomySource);
  const hintShown = useStageHint();
  return (
    <>
      {/* Left-to-right bg/app → transparent over 0–52 % of the width guarantees the copy's contrast; a faint cyan
          light pools behind the headline (LUMEN 2). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-hud hidden w-[52%] min-[1100px]:block"
        style={{
          background:
            'radial-gradient(60% 46% at 22% 40%, rgb(var(--c-glow-cyan) / 0.07), transparent 70%), linear-gradient(90deg, rgb(var(--c-bg-app)) 0%, rgb(var(--c-bg-app) / 0.88) 44%, rgb(var(--c-bg-app) / 0) 100%)',
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-panels transition-opacity duration-base',
          leaving ? 'opacity-0 ease-exit' : 'ease-out',
        )}
      >
        {/* Top-right, in the empty stage beside the great vessels (centred over the aortic root it covered
            the heart); the middle when the landing stacks. */}
        <div
          className="absolute left-1/2 top-6 flex -translate-x-1/2 justify-center min-[1100px]:left-auto min-[1100px]:right-4 min-[1100px]:translate-x-0 min-[1100px]:justify-end"
          aria-live="off"
        >
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
        {/* Top-left of the free stage (clear of the monitor chip under the heart and the attract caption). It is
            an affordance, not content: it bows out after a few seconds or at the first touch of the stage. */}
        <div
          className={cn(
            'absolute top-6 hidden flex-col items-start gap-0.5 transition-[opacity,transform] duration-[640ms] ease-out min-[1100px]:flex',
            hintShown ? 'opacity-100' : '-translate-y-1 opacity-0',
          )}
          style={{ left: 'calc(var(--landing-free-left, 34%) + 8px)' }}
        >
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.035] px-2.5 text-label font-normal text-tertiary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <Rotate3d aria-hidden className="size-3.5 stroke-[1.5] text-accent" />
            Interactive 3D · drag to rotate
          </span>
        </div>
      </div>
    </>
  );
}
