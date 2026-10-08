import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows an inline 12 px progress bar and disables the button. */
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // LUMEN 2: a lit accent gradient with a top highlight, a cyan glow that grows on hover and a light sweep.
  primary: cn(
    'btn-shine bg-accent text-accent-ink bg-[linear-gradient(180deg,#8ad8f1_0%,#56c2e6_55%,#45add3_100%)]',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.12),0_6px_20px_-6px_rgba(86,194,230,0.55)]',
    'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.12),0_10px_30px_-6px_rgba(86,194,230,0.75)] hover:brightness-[1.06]',
    'active:brightness-95',
    'disabled:bg-none disabled:bg-surface-2 disabled:text-disabled disabled:shadow-none',
  ),
  secondary: cn(
    'bg-white/[0.045] text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),inset_0_1px_0_rgba(255,255,255,0.05)]',
    'hover:bg-white/[0.08] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),inset_0_1px_0_rgba(255,255,255,0.07)]',
    'active:bg-white/[0.1] disabled:bg-surface-2 disabled:text-disabled disabled:shadow-none',
  ),
  ghost: 'bg-transparent text-secondary hover:bg-white/[0.06] hover:text-primary active:bg-white/[0.09] disabled:text-disabled',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-sm px-2.5 text-label gap-1.5',
  md: 'h-md px-3 text-body-s font-semibold gap-2',
  lg: 'h-lg px-5 text-body font-semibold gap-2',
};

/**
 * Button (DESIGN_SYSTEM §5, LUMEN 2): h 32 (40 on landing CTA), r-sm, 13/18 600; primary = lit accent
 * gradient with glow, secondary = glass, ghost = text. Presses scale to 98 % (none under reduced motion).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, iconLeft, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'group/btn relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm',
        'transition-[color,background-color,box-shadow,filter,transform] duration-fast ease-out',
        'active:scale-[0.98] disabled:active:scale-100 motion-reduce:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {iconLeft && <span className="relative z-[2] -ml-0.5 inline-flex shrink-0 [&>svg]:size-4">{iconLeft}</span>}
      {children}
      {iconRight && (
        <span className="relative z-[2] -mr-0.5 inline-flex shrink-0 transition-transform duration-fast ease-out group-hover/btn:translate-x-0.5 [&>svg]:size-4">
          {iconRight}
        </span>
      )}
      {loading && (
        <span aria-hidden className="absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 overflow-hidden rounded-full">
          <span className="absolute inset-0 bg-current opacity-30" />
          <span className="relative block h-full w-1/2 animate-indeterminate rounded-full bg-current" />
        </span>
      )}
    </button>
  );
});
