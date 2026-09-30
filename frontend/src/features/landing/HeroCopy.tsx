import { ArrowRight, Play } from 'lucide-react';
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

const rise = (i: number): CSSProperties => ({ animationDelay: `${i * 60}ms` });

/**
 * Hero copy (WORKSTATION_V2 §6.1): one overline, one H1 (display-1), one sub-line (15/24), exactly one
 * primary CTA and one ghost CTA, and a caption. The input count comes from the schema, never a literal.
 */
export function HeroCopy({ leaving, onOpenWorkstation, onGuidedDemo, className }: HeroCopyProps) {
  const schema = useSchema();
  const nInputs = schema.data?.features.length;

  return (
    <div
      className={cn(
        'flex flex-col gap-5 transition-[opacity,transform] duration-base',
        leaving ? 'pointer-events-none -translate-y-2 opacity-0 ease-exit' : 'ease-out',
        className,
      )}
    >
      <p className="eyebrow flex items-center gap-3 text-secondary animate-rise-in" style={rise(0)}>
        <span aria-hidden className="h-px w-6 bg-line-strong" />
        Coronary risk, vessel by vessel
      </p>
      <h1
        id="hero-title"
        className="max-w-[36rem] text-balance font-display text-display-2 text-primary animate-rise-in min-[1440px]:text-display-1"
        style={rise(1)}
      >
        An explainable coronary digital twin.
      </h1>
      <p
        className="max-w-[30rem] text-body text-secondary animate-rise-in min-[1440px]:text-[0.9375rem] min-[1440px]:leading-6"
        style={rise(2)}
      >
        Predicts <abbr title="Coronary artery disease">CAD</abbr> and{' '}
        <abbr title="Left anterior descending artery">LAD</abbr> · <abbr title="Left circumflex artery">LCX</abbr> ·{' '}
        <abbr title="Right coronary artery">RCA</abbr> stenosis from {nInputs ?? 'routine'} routine clinical inputs, explains
        every estimate with exact <abbr title="SHapley Additive exPlanations">SHAP</abbr>, and maps it onto a real
        reference heart: a per-patient risk twin, not a scan of this patient.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1 animate-rise-in" style={rise(3)}>
        <Button
          variant="primary"
          size="lg"
          iconRight={<ArrowRight className="stroke-[1.75]" />}
          onClick={onOpenWorkstation}
          data-cta="primary"
        >
          Open the workstation
        </Button>
        <Button
          variant="ghost"
          size="lg"
          iconLeft={<Play className="stroke-[1.75]" />}
          onClick={onGuidedDemo}
          aria-label="Guided demo, 5 chapters, about 90 seconds"
        >
          Guided demo <span className="font-normal text-tertiary">· 90&thinsp;s</span>
        </Button>
      </div>
      <p className="text-label font-normal text-tertiary animate-rise-in" style={rise(4)}>
        Opens on a patient the model never saw. No login.
      </p>
      <div className="-mt-1 self-start animate-rise-in" style={rise(5)}>
        <LiveLever />
      </div>
    </div>
  );
}
