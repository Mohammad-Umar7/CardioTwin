import { motion } from 'framer-motion';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SPRING } from '@/theme/tokens';
import { Tooltip } from './Tooltip';

export interface SegmentOption<V extends string | number> {
  value: V;
  label: ReactNode;
  /** Full term for the tooltip (e.g. "Left bundle branch block"). */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string | number> {
  options: readonly SegmentOption<V>[];
  value: V | null | undefined;
  onChange(value: V): void;
  /** Accessible group name. */
  label: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
  /** Called while an option is hovered or focused (counterfactual preview in phase 2). */
  onPreview?(value: V | null): void;
  className?: string;
  fullWidth?: boolean;
}

/**
 * Segmented control (radiogroup) for binary and categorical inputs, projection presets and tabs-like
 * choices. Roving tabindex: Tab enters the group, arrow keys move and select.
 */
export function SegmentedControl<const V extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  disabled,
  onPreview,
  className,
  fullWidth,
}: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const thumbId = `segment-thumb-${useId()}`;
  const reduced = useIsReducedMotion();

  const move = (from: number, delta: number) => {
    const n = options.length;
    for (let step = 1; step <= n; step += 1) {
      const i = (from + delta * step + n * n) % n;
      const opt = options[i];
      if (opt && !opt.disabled) {
        refs.current[i]?.focus();
        onChange(opt.value);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, -1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex items-stretch rounded-sm bg-black/25 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_2px_rgba(0,0,0,0.35)]',
        size === 'xs' ? 'h-xs' : 'h-sm',
        fullWidth && 'flex w-full',
        className,
      )}
      onMouseLeave={() => onPreview?.(null)}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        const button = (
          <button
            key={String(opt.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled || opt.disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onMouseEnter={() => onPreview?.(opt.value)}
            onFocus={() => onPreview?.(opt.value)}
            onBlur={() => onPreview?.(null)}
            className={cn(
              'num relative isolate min-w-max flex-1 whitespace-nowrap rounded-[4px] px-2 text-label transition-colors duration-fast ease-out',
              selected ? 'text-primary' : 'text-secondary hover:bg-white/[0.05] hover:text-primary',
              'disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent',
            )}
          >
            {selected && (
              // The selection thumb glides between options (LUMEN 2): raised glass with a lit accent rule.
              <motion.span
                aria-hidden
                layoutId={thumbId}
                transition={reduced ? { duration: 0 } : SPRING.indicator}
                className="absolute inset-0 -z-10 rounded-[4px] bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.06))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.4)]"
              >
                <span className="absolute inset-x-2 bottom-0 h-px bg-accent shadow-[0_0_6px_rgba(86,194,230,0.9)]" />
              </motion.span>
            )}
            {opt.label}
          </button>
        );
        return opt.title ? (
          <Tooltip key={String(opt.value)} content={opt.title}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
