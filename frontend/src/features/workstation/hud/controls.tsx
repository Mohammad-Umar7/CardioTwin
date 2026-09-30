import { ChevronDown } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from '@/design';
import { cn } from '@/lib/cn';

/** 1 × 20 hairline between toolbar groups (V2 §5.11). */
export function ToolbarSeparator() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-hairline" />;
}

/** Icon-button size inside the toolbar: 32 px at ≥ 1440, 28 px below (V2 §5.11). */
export const TOOLBAR_ICON = 'size-8 max-[1439.98px]:size-7';

export interface ToolbarTextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Open state of the menu / popover it triggers. */
  open?: boolean;
  tooltip?: string;
  /** Compact toolbar (< 1100 px): the icon alone, the text becomes the accessible name. */
  iconOnly?: boolean;
  children: ReactNode;
}

/**
 * Text trigger of a toolbar menu ("AP ▾", "Layers ▾"): h 32 (28), 13/18 500 text/secondary, r-sm, a 14 px
 * chevron; hover surface/1, open surface/2 + text/primary.
 */
export const ToolbarTextButton = forwardRef<HTMLButtonElement, ToolbarTextButtonProps>(function ToolbarTextButton(
  { icon, open = false, tooltip, iconOnly = false, className, children, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm text-body-s font-medium text-secondary outline-none max-[1439.98px]:h-7',
        'transition-colors duration-instant ease-instant hover:bg-surface-1 hover:text-primary focus-visible:shadow-focus',
        iconOnly ? 'w-8 justify-center max-[1439.98px]:w-7' : icon ? 'pl-2 pr-1.5' : 'pl-2.5 pr-1.5',
        open && 'bg-surface-2 text-primary hover:bg-surface-2',
        '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.5]',
        className,
      )}
      {...rest}
    >
      {icon}
      {!iconOnly && <span className="min-w-0 truncate">{children}</span>}
      {!iconOnly && (
        <ChevronDown aria-hidden className={cn('!size-3.5 text-tertiary transition-transform duration-fast', open && 'rotate-180')} />
      )}
    </button>
  );
  // Always wrapped (no remount when the menu opens); the tooltip is off while its menu is open.
  return (
    <Tooltip content={tooltip} disabled={open || !tooltip}>
      {button}
    </Tooltip>
  );
});

export interface HudSwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  /** Right-aligned shortcut / hint shown before the switch. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Row with a label and a 28 × 16 switch (`role="switch"`); the whole row toggles. */
export function HudSwitch({ checked, onChange, label, hint, disabled, className }: HudSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-s text-primary outline-none',
        'transition-colors duration-instant ease-instant hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-focus',
        'disabled:cursor-not-allowed disabled:text-disabled',
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint}
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full border transition-colors duration-fast ease-out',
          checked ? 'border-accent bg-accent/80' : 'border-line bg-surface-1',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary shadow-e1 transition-[left] duration-fast ease-out',
            checked ? 'left-[13px]' : 'left-[1px]',
          )}
        />
      </span>
    </button>
  );
}
