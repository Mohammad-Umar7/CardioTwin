import { ArrowRight, Check, Play } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '@/design';
import { useSchema } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { LiveLever } from './LiveLever';

export interface HeroCopyProps {
  /** Plays the §6.2 exit (240 ms, y −8, fade) before the route changes. */
  leaving: boolean;
  onOpenWorkstation(): void;
  onGuidedDemo(): void;
  className?: string;
}

/** Staggered arrival (LUMEN 2): each block blurs in 90 ms after the one above it. */
const rise = (i: number): CSSProperties => ({ animationDelay: `${120 + i * 90}ms` });

const TRUST = ['A patient the model never saw', 'No login', 'Runs in your browser'] as const;

/**
 * Hero copy (WORKSTATION_V2 §6.1, LUMEN 2): a live-status pill, one H1 in two lit lines (the claim in white,
 * the noun in the accent gradient), one sub-line, exactly one primary CTA and one secondary CTA, a trust row and
 * the live what-if lever. The input count comes from the schema, never a literal.
 */
export function HeroCopy({ leaving, onOpenWorkstation, onGuidedDemo, className }: HeroCopyProps) {
  const schema = useSchema();
  const nInputs = schema.data?.features.length;

  return (
    <div
      className={cn(
        'flex flex-col gap-6 transition-[opacity,transform,filter] duration-base',
        leaving ? 'pointer-events-none -translate-y-2 opacity-0 blur-[2px] ease-exit' : 'ease-out',
        className,
      )}
    >
      <p className="flex animate-blur-in" style={rise(0)}>
        <span className="glass glass-edge inline-flex h-8 items-center gap-2.5 rounded-full pl-3 pr-3.5 text-label text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_8px_24px_-8px_rgba(0,0,0,0.6)]">
          <span className="relative z-[1] inline-flex items-center gap-1.5 font-semibold text-ecg">
            <span aria-hidden className="live-dot" />
            Live twin
          </span>
          <span aria-hidden className="relative z-[1] h-3.5 w-px bg-white/15" />
          <span className="relative z-[1] font-medium">Coronary risk, vessel by vessel</span>
        </span>
      </p>
      <h1
        id="hero-title"
        className="max-w-[40rem] font-display text-display-2 text-primary min-[1440px]:text-display-hero"
      >
        <span className="block animate-blur-in" style={rise(1)}>
          <span className="text-gradient">An explainable</span>
        </span>{' '}
        <span className="block animate-blur-in pb-1" style={rise(2)}>
          <span className="text-gradient-accent is-animated">coronary digital twin.</span>
        </span>
      </h1>
      <p
        className="max-w-[32rem] text-body text-secondary animate-blur-in min-[1440px]:text-[1rem] min-[1440px]:leading-[1.625rem]"
        style={rise(3)}
      >
        Predicts <abbr title="Coronary artery disease">CAD</abbr> and{' '}
        <abbr title="Left anterior descending artery">LAD</abbr> · <abbr title="Left circumflex artery">LCX</abbr> ·{' '}
        <abbr title="Right coronary artery">RCA</abbr> stenosis from {nInputs ?? 'routine'} routine clinical inputs, explains
        every estimate with exact <abbr title="SHapley Additive exPlanations">SHAP</abbr>, and maps it onto a real
        reference heart: a per-patient risk twin, not a scan of this patient.
      </p>
      <div className="flex flex-wrap items-center gap-3 animate-blur-in" style={rise(4)}>
        <Button
          variant="primary"
          size="lg"
          iconRight={<ArrowRight className="stroke-[2]" />}
          onClick={onOpenWorkstation}
          data-cta="primary"
          className="h-11 rounded-md px-6"
        >
          Open the workstation
        </Button>
        <Button
          variant="secondary"
          size="lg"
          iconLeft={
            <span className="grid size-5 place-items-center rounded-full bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
              <Play className="!size-2.5 translate-x-px fill-current stroke-[2]" />
            </span>
          }
          onClick={onGuidedDemo}
          aria-label="Guided demo, 5 chapters, about 90 seconds"
          className="h-11 rounded-md pl-3 pr-5"
        >
          Guided demo <span className="font-normal text-tertiary">· 90&thinsp;s</span>
        </Button>
      </div>
      <ul
        aria-label="Opens on a patient the model never saw. No login."
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-label font-normal text-tertiary animate-blur-in"
        style={rise(5)}
      >
        {TRUST.map((item) => (
          <li key={item} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="grid size-4 place-items-center rounded-full bg-success/15 text-success">
              <Check className="size-2.5 stroke-[3]" />
            </span>
            {item}
          </li>
        ))}
      </ul>
      <div className="-mt-1 self-start animate-blur-in" style={rise(6)}>
        <LiveLever />
      </div>
    </div>
  );
}
