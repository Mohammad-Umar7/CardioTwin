import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { computePosition, type Placement } from './position';

export interface PopoverProps {
  /** Render prop for the trigger: spread `props` onto a button. */
  trigger(props: {
    ref: (el: HTMLElement | null) => void;
    onClick(): void;
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'dialog';
  }): ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  /** Accessible name of the popover panel. */
  label: string;
  className?: string;
  width?: number;
}

/**
 * Anchored popover (surface/3, e-3, r-lg). Click toggles, Esc or an outside click closes, focus moves
 * into the panel on open and back to the trigger on close.
 */
export function Popover({ trigger, children, placement = 'bottom', label, className, width = 320 }: PopoverProps) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
    anchor.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const p = computePosition(anchor.current.getBoundingClientRect(), {
      width: panel.current.offsetWidth,
      height: panel.current.offsetHeight,
    }, placement);
    setPos({ top: p.top, left: p.left });
    panel.current.focus();
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) {
        setOpen(false);
        setPos(null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  return (
    <>
      {trigger({
        ref: (el) => {
          anchor.current = el;
        },
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'dialog',
      })}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
            className={cn(
              'fixed z-popover rounded-lg bg-surface-3 p-4 text-body-s text-secondary shadow-e3 outline-none',
              pos ? 'animate-rise-in' : 'opacity-0',
              className,
            )}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}
