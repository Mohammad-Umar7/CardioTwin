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
        'inline-flex h-xs items-center gap-1.5 rounded-sm border px-2 text-label transition-[color,background-color,border-color,box-shadow] duration-fast ease-out',
        '[&>svg]:size-3.5 [&>svg]:stroke-[1.5]',
        variant === 'hud' ? 'hud-chip' : 'bg-white/[0.04]',
        pressed
          ? 'border-accent/50 bg-accent/[0.1] text-primary shadow-[0_0_14px_-6px_rgba(86,194,230,0.7)] [&>svg]:text-accent'
          : 'border-white/[0.09] text-secondary hover:bg-white/[0.07] hover:text-primary',
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
