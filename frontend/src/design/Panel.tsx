import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Opaque side panel (bg/panel, no blur, separated from neighbours by hairlines). */
export const Panel = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { as?: 'section' | 'aside' | 'div' }>(
  function Panel({ as: Tag = 'section', className, ...rest }, ref) {
    return <Tag ref={ref as never} className={cn('bg-panel text-primary', className)} {...rest} />;
  },
);

export interface SectionHeaderProps {
  title: ReactNode;
  /** Right-aligned slot: actions, units, a (i) tooltip. */
  aside?: ReactNode;
  id?: string;
  className?: string;
}

/** Overline section header ("OVERALL · CAD", "VESSELS"). */
export function SectionHeader({ title, aside, id, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex min-h-6 items-center justify-between gap-2', className)}>
      <h2 id={id} className="overline text-secondary">
        {title}
      </h2>
      {aside && <div className="flex items-center gap-1 text-label text-tertiary">{aside}</div>}
    </div>
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md';
  interactive?: boolean;
}

/**
 * Card: surface/1, 1 px border/default, r-md, e-1 inset highlight. Opaque by rule (the spec rejects
 * glass blur); `GlassCard` is kept as an alias for components written against the original brief.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', interactive, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-md border border-line bg-surface-1 shadow-e1',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-3 min-[1440px]:p-4',
        interactive && 'transition-colors duration-instant hover:bg-surface-2',
        className,
      )}
      {...rest}
    />
  );
});

export const GlassCard = Card;

/** 1 px hairline divider. */
export function Divider({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(vertical ? 'w-px self-stretch bg-hairline' : 'h-px w-full bg-hairline', className)}
    />
  );
}
