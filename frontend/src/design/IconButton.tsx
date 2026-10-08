import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required accessible name; also used as the tooltip unless `tooltip` is given. */
  label: string;
  icon: ReactNode;
  size?: 'xs' | 'sm' | 'md';
  tooltip?: ReactNode | false;
  active?: boolean;
  variant?: 'ghost' | 'hud' | 'secondary';
}

const SIZE = { xs: 'size-6', sm: 'size-7', md: 'size-8' } as const;

/** Icon button: 24 / 28 / 32 square, 16 px lucide icon at stroke 1.5. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'sm', tooltip, active = false, variant = 'ghost', className, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={rest['aria-pressed']}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm transition-[color,background-color,box-shadow,transform] duration-fast ease-out active:scale-95 motion-reduce:active:scale-100',
        '[&>svg]:size-4 [&>svg]:stroke-[1.5]',
        variant === 'ghost' && 'text-secondary hover:bg-white/[0.07] hover:text-primary',
        variant === 'secondary' &&
          'bg-white/[0.045] text-secondary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] hover:bg-white/[0.08] hover:text-primary',
        variant === 'hud' && 'hud-chip text-secondary hover:text-primary',
        active &&
          'bg-accent/[0.14] text-accent shadow-[inset_0_0_0_1px_rgba(86,194,230,0.35),0_0_14px_-4px_rgba(86,194,230,0.6)] hover:bg-accent/[0.18] hover:text-accent',
        'disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent',
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  if (tooltip === false) return button;
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>;
});
