import { motion } from 'framer-motion';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SPRING } from '@/theme/tokens';
import { tabId, tabPanelId } from './tabIds';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string> {
  items: readonly TabItem<V>[];
  value: V;
  onChange(value: V): void;
  label: string;
  /** Prefix for tab / panel ids: tab = `${idBase}-tab-${value}`, panel = `${idBase}-panel-${value}`. */
  idBase: string;
  size?: 'sm' | 'md';
  className?: string;
}


/**
 * Tabs (DESIGN_SYSTEM §5 TargetTabs / right-panel tabs): 2 px accent underline on the active tab, which
 * glides from tab to tab with a soft glow (LUMEN 2; it jumps under reduced motion).
 */
export function Tabs<const V extends string>({ items, value, onChange, label, idBase, size = 'sm', className }: TabsProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicatorId = `tabs-indicator-${useId()}`;
  const reduced = useIsReducedMotion();

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const n = items.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (item && !item.disabled) {
      refs.current[next]?.focus();
      onChange(item.value);
    }
  };

  return (
    <div role="tablist" aria-label={label} className={cn('flex items-end gap-1 border-b border-hairline', className)}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={tabId(idBase, item.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(idBase, item.value)}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative -mb-px inline-flex items-center px-2 font-medium transition-colors duration-fast ease-out',
              size === 'sm' ? 'h-sm text-label' : 'h-md text-body-s',
              active ? 'text-primary' : 'text-secondary hover:text-primary',
              'disabled:cursor-not-allowed disabled:text-disabled',
            )}
          >
            {item.label}
            {active && (
              <motion.span
                aria-hidden
                layoutId={indicatorId}
                transition={reduced ? { duration: 0 } : SPRING.indicator}
                className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent shadow-[0_0_10px_rgba(86,194,230,0.7)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
