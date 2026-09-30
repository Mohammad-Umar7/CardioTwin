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
        'inline-flex shrink-0 items-center justify-center rounded-sm transition-colors duration-instant ease-instant',
        '[&>svg]:size-4 [&>svg]:stroke-[1.5]',
        variant === 'ghost' && 'text-secondary hover:bg-surface-2 hover:text-primary',
        variant === 'secondary' && 'border border-line bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary',
        variant === 'hud' && 'hud-chip text-secondary hover:text-primary',
        active && 'bg-surface-2 text-accent hover:text-accent',
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
