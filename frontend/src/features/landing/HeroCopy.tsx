import { ArrowRight, Play } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import type { LeaveMode } from './useEnterWorkstation';

export interface HeroCopyProps {
  /** How the page is leaving: the copy clears first (the dolly's opening beat), or fades for the simple path. */
  leaving: LeaveMode;
  onEnter(): void;
  onGuidedDemo(): void;
  className?: string;
}

/** One gentle arrival, top to bottom (never under reduced motion). */
const arrive = (i: number): CSSProperties => ({ animationDelay: `${80 + i * 80}ms` });

/**
 * Hero copy: one headline, one sentence of what the product does, one dominant call to action (plus the
 * existing guided demo as a quiet text action) and one line of intended use. The full disclaimer stays in the
 * status line and its Details dialog.
 */
export function HeroCopy({ leaving, onEnter, onGuidedDemo, className }: HeroCopyProps) {
  const exiting = leaving !== null;
  return (
    <div
      className={cn(
        'flex flex-col transition-[opacity,transform] ease-exit motion-reduce:transform-none',
        leaving === 'cinematic' ? 'duration-[420ms]' : 'duration-fast',
        exiting && 'pointer-events-none -translate-x-3 opacity-0',
        className,
      )}
    >
      <h1
        id="hero-title"
        className="font-display text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.038em] text-primary sm:text-[3.25rem] lg:text-[3.5rem] min-[1440px]:text-[4rem] min-[1800px]:text-[4.5rem]"
      >
        <span className="block motion-safe:animate-fade-up" style={arrive(0)}>
          Coronary risk,
        </span>{' '}
        <span className="block motion-safe:animate-fade-up" style={arrive(1)}>
          made <span className="text-accent">explainable.</span>
        </span>
      </h1>
      <p
        className="mt-5 max-w-[30rem] text-[1rem] leading-[1.6] text-secondary motion-safe:animate-fade-up sm:mt-6 sm:leading-[1.65] lg:mt-7 lg:text-[1.0625rem] min-[1440px]:max-w-[32rem] min-[1440px]:text-[1.125rem] min-[1440px]:leading-[1.7]"
        style={arrive(2)}
      >
        Estimate coronary artery disease and vessel-level risk from routine clinical data. Understand what drives each
        prediction and explore the results on a 3D reference heart.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3 motion-safe:animate-fade-up sm:mt-9 lg:mt-10" style={arrive(3)}>
        <button
          type="button"
          data-cta="primary"
          onClick={onEnter}
          aria-disabled={exiting || undefined}
          className={cn(
            'group/cta inline-flex h-12 select-none items-center gap-2.5 rounded-md bg-accent pl-6 pr-5 text-[0.9375rem] font-semibold tracking-[-0.005em] text-accent-ink',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[background-color,transform] duration-fast ease-out',
            'hover:bg-accent-hover focus-visible:shadow-focus active:scale-[0.98] motion-reduce:active:scale-100',
          )}
        >
          Enter Workstation
          <ArrowRight
            aria-hidden
            className="size-[18px] stroke-[2.25] transition-transform duration-fast ease-out group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
          />
        </button>
        <button
          type="button"
          onClick={onGuidedDemo}
          aria-label="Guided demo, about 90 seconds"
          className="group/demo inline-flex h-10 items-center gap-2.5 rounded-sm text-body font-medium text-secondary transition-colors duration-fast hover:text-primary"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition-shadow duration-fast group-hover/demo:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.32)]"
          >
            <Play className="size-2.5 translate-x-px fill-current stroke-[2]" />
          </span>
          Guided demo <span className="font-normal text-tertiary">· 90&thinsp;s</span>
        </button>
      </div>
      <p className="mt-5 text-body-s text-tertiary motion-safe:animate-fade-up sm:mt-8 lg:mt-10" style={arrive(4)}>
        Research and educational decision support · Not a diagnosis
      </p>
    </div>
  );
}
