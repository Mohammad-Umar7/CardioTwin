import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean;
  onPressedChange(pressed: boolean): void;
  icon?: ReactNode;
  children: ReactNode;
  /** Tooltip, e.g. why the toggle is disabled in the current render tier. */
  hint?: ReactNode;
  variant?: 'chip' | 'hud';
}

/** Toggle chip (DESIGN_SYSTEM §5 LayerToggles): h 24, on = accent text + accent hairline, aria-pressed. */
export function Toggle({ pressed, onPressedChange, icon, children, hint, variant = 'chip', className, ...rest }: ToggleProps) {
  const button = (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-xs items-center gap-1.5 rounded-sm border px-2 text-label transition-colors duration-fast ease-out',
        '[&>svg]:size-3.5 [&>svg]:stroke-[1.5]',
        variant === 'hud' ? 'bg-surface-3/[0.88] shadow-hud' : 'bg-surface-1',
        pressed
          ? 'border-accent/50 text-primary [&>svg]:text-accent'
          : 'border-line text-secondary hover:bg-surface-2 hover:text-primary',
        'disabled:cursor-not-allowed disabled:border-line disabled:text-disabled',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
  return hint ? <Tooltip content={hint}>{button}</Tooltip> : button;
}
