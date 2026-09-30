import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'outline' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Dashed border, e.g. "exploring" or "imputed" states. */
  dashed?: boolean;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-secondary border-line',
  accent: 'bg-transparent text-accent border-accent/50',
  success: 'bg-transparent text-success border-success/40',
  outline: 'bg-transparent text-tertiary border-line',
  danger: 'bg-transparent text-danger border-danger/50',
};

/** Small uppercase tag (TEST, DEV, IMP, CUSTOM). Status only — never risk. */
export function Badge({ tone = 'neutral', dashed, className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-xs border px-1.5 text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.06em]',
        dashed && 'border-dashed',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
