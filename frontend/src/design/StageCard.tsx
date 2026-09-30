import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StageCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  as?: 'section' | 'aside' | 'div' | 'nav';
  /** Overline header text (left). Headers carry no icons (V2 §5.4). */
  title?: ReactNode;
  /** id for the title element, e.g. for `aria-labelledby`. */
  titleId?: string;
  /** Right side of the header: a tag, an (i) button, a close button. */
  actions?: ReactNode;
  /** `data-region` for the V2 probes and the tour (e.g. "risk-card", "inspector"). */
  region?: string;
  /**
   * card: r-lg with --card-pad padding (default) · chip: r-full, h --chip-h, horizontal padding only
   * (selection chip, what-if pill, answer pill, hint) · bare: the material only, no padding.
   */
  shape?: 'card' | 'chip' | 'bare';
  /** Enter stagger in ms (V2 §8.1: Risk card 0, patient card 60, toolbar 120, legend 180). */
  enterDelay?: number;
  /** Skip the enter animation (content swapped inside an already visible card). */
  noEnter?: boolean;
}

/**
 * The one floating material of the V2 stage (WORKSTATION_V2 §5.4, §7): bg/panel, 1 px border/default
 * ring, e-2, r-lg, no blur, `position: relative` and `overflow: clip` (the P0-1 class of bug cannot
 * recur). Enters with y 8 → 0 + fade over `base` (opacity only under reduced motion).
 *
 * Exit and compact transitions belong to the slot or the owner (they need presence / measured heights).
 */
export const StageCard = forwardRef<HTMLElement, StageCardProps>(function StageCard(
  { as: Tag = 'section', title, titleId, actions, region, shape = 'card', enterDelay = 0, noEnter, className, style, children, ...rest },
  ref,
) {
  const header =
    title !== undefined || actions !== undefined ? (
      <header className="flex min-h-6 items-center justify-between gap-2">
        {title !== undefined ? (
          <h2 id={titleId} className="eyebrow min-w-0 truncate text-secondary">
            {title}
          </h2>
        ) : (
          <span />
        )}
        {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
    ) : null;

  const merged: CSSProperties = { ...style, ...(enterDelay ? { animationDelay: `${enterDelay}ms` } : null) };

  return (
    <Tag
      ref={ref as never}
      data-region={region}
      className={cn(
        'stage-card text-primary',
        !noEnter && 'stage-card-enter',
        shape === 'card' && 'p-[var(--card-pad)]',
        shape === 'chip' && 'flex h-[var(--chip-h)] items-center gap-2 rounded-full px-3',
        className,
      )}
      style={merged}
      {...rest}
    >
      {header}
      {children}
    </Tag>
  );
});
