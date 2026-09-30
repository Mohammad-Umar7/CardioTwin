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
  primary:
    'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-pressed disabled:bg-surface-2 disabled:text-disabled',
  secondary:
    'bg-surface-1 text-primary border border-line hover:bg-surface-2 active:border-line-strong disabled:bg-surface-2 disabled:text-disabled',
  ghost: 'bg-transparent text-secondary hover:bg-surface-2 hover:text-primary active:bg-surface-3 disabled:text-disabled',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-sm px-2.5 text-label gap-1.5',
  md: 'h-md px-3 text-body-s font-semibold gap-2',
  lg: 'h-lg px-4 text-body font-semibold gap-2',
};

/** Button (DESIGN_SYSTEM §5): h 32 (40 on landing CTA), r-sm, 13/18 600; primary = accent fill. */
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
        'relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm',
        'transition-colors duration-instant ease-instant',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {iconLeft && <span className="-ml-0.5 inline-flex shrink-0 [&>svg]:size-4">{iconLeft}</span>}
      {children}
      {iconRight && <span className="-mr-0.5 inline-flex shrink-0 [&>svg]:size-4">{iconRight}</span>}
      {loading && (
        <span aria-hidden className="absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 overflow-hidden rounded-full">
          <span className="absolute inset-0 bg-current opacity-30" />
          <span className="relative block h-full w-1/2 animate-indeterminate rounded-full bg-current" />
        </span>
      )}
    </button>
  );
});
