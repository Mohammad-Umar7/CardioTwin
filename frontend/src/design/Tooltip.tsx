import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { isReturningFocus } from './focus';
import { computePosition, type Placement } from './position';

/**
 * `:focus-visible` (keyboard focus). True where it cannot be told (a synthetic focus event on an element that
 * is not the active one, or a browser without the selector), so focus still opens the tooltip there.
 */
function focusVisible(el: Element): boolean {
  if (el.ownerDocument.activeElement !== el) return true;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element; it receives aria-describedby. */
  children: ReactElement;
  placement?: Placement;
  /** Hover delay (spec: 120 ms). Focus opens immediately. */
  delay?: number;
  disabled?: boolean;
  className?: string;
}

type ChildProps = {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  'aria-describedby'?: string;
  ref?: React.Ref<HTMLElement>;
};

/**
 * Tooltip (DESIGN_SYSTEM §5): surface/3, e-2, r-md, 8×10 padding, max-width 280, 12/16. Opens after
 * 120 ms of hover or immediately on focus; Esc dismisses. Never the only copy of information.
 *
 * Close-on-press (WORKSTATION_V2 §5.4, P1-11): pressing the trigger closes the tooltip, and it does not
 * reopen (not even from the focus that the press gives the trigger) until the pointer leaves and
 * re-enters. Keyboard focus still opens it immediately.
 */
export function Tooltip({ content, children, placement = 'top', delay = 120, disabled, className }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  /** Set by a press on the trigger; cleared when the pointer leaves it. */
  const suppressed = useRef(false);

  const show = useCallback(
    (immediate: boolean) => {
      if (suppressed.current || disabled || content === null || content === undefined || content === '') return;
      clearTimeout(timer.current);
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay, disabled, content],
  );
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    const onScroll = () => hide();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !floatingRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const { offsetWidth, offsetHeight } = floatingRef.current;
    const p = computePosition(rect, { width: offsetWidth, height: offsetHeight }, placement);
    setPos({ top: p.top, left: p.left });
  }, [open, placement, content]);

  if (!isValidElement<ChildProps>(children)) return children;

  const child = children as ReactElement<ChildProps>;
  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const { ref } = child as unknown as { ref?: React.Ref<HTMLElement> };
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      show(false);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      suppressed.current = false;
      hide();
    },
    onPointerDown: (e: React.PointerEvent) => {
      child.props.onPointerDown?.(e);
      suppressed.current = true;
      hide();
    },
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      // Keyboard focus only: not a focus handed back after a menu closes, nor one that follows a click.
      if (isReturningFocus(e.currentTarget) || !focusVisible(e.currentTarget)) return;
      show(true);
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      hide();
    },
    'aria-describedby': open
      ? [child.props['aria-describedby'], id].filter(Boolean).join(' ')
      : child.props['aria-describedby'],
  });

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={floatingRef}
            id={id}
            role="tooltip"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cn(
              'pointer-events-none fixed z-popover max-w-[280px] rounded-md bg-surface-3 px-2.5 py-2 text-label font-normal text-primary shadow-e2',
              pos ? 'opacity-100 transition-opacity duration-fast ease-out' : 'opacity-0',
              className,
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
