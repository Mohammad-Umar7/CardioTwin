import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { EASE, MOTION } from '@/theme/tokens';
import { ESCAPE_PRIORITY, useEscapeLayer } from './escapeStack';

export interface DrawerProps {
  open: boolean;
  /** Stage edge the drawer docks to: Inputs = left, Explain = right. */
  side: 'left' | 'right';
  onClose(): void;
  /** Accessible name (or pass `labelledBy`). */
  label?: string;
  labelledBy?: string;
  /** CSS width. Default: var(--drawer-inputs-w) on the left, var(--drawer-explain-w) on the right. */
  width?: string;
  /** `data-region` (e.g. "inputs-drawer", "explain-drawer"). */
  region?: string;
  /**
   * Selector (inside the drawer) of the element to focus on open. Default: `[data-autofocus]`, then the
   * first input, then the drawer itself (never the close button: focusing it would pop its tooltip).
   */
  initialFocus?: string;
  /** Esc closes the drawer (default true); it sits below palette, modals and menus in the Esc chain. */
  closeOnEscape?: boolean;
  children: ReactNode;
  className?: string;
}

const FIELD = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

/**
 * Docked drawer (WORKSTATION_V2 §5.4): full stage height on one edge, bg/panel, e-3 depth, 1 px
 * border/default on the inner edge, `role="dialog"` + `aria-modal="false"` (the stage stays live).
 * Focus moves to the first field on open and returns to the opener on close; Esc closes.
 * Motion: slides in over `flyout` (360 ms, ease-out) and out over 250 ms (exit easing); content fades in
 * over `fast` after 80 ms. Reduced motion: opacity only, 120 ms.
 *
 * Render it inside `StageLayout`'s `drawers` slot (it positions itself absolutely against the stage).
 * Only one drawer is open at a time: that rule lives in `uiStore.openDrawer`.
 */
export function Drawer({
  open,
  side,
  onClose,
  label,
  labelledBy,
  width,
  region,
  initialFocus,
  closeOnEscape = true,
  children,
  className,
}: DrawerProps) {
  const reduced = useIsReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Focus is inside the drawer (tracked, because the panel may already be detached when it closes). */
  const focusWithin = useRef(false);

  useEscapeLayer(open && closeOnEscape, onClose, ESCAPE_PRIORITY.drawer);

  // Remember the opener, move focus in, and give focus back on close (if nothing else took it). A passive
  // effect, so the restore runs after React's post-commit selection restore instead of being undone by it.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const t = window.setTimeout(() => {
      const root = panel.current;
      if (!root || root.contains(document.activeElement)) return;
      const target =
        (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ??
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>(FIELD) ??
        root;
      target.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(t);
      const back = opener.current;
      const focusLost = document.activeElement === document.body || document.activeElement === null;
      if (back?.isConnected && (focusWithin.current || focusLost)) back.focus({ preventScroll: true });
      focusWithin.current = false;
    };
  }, [open, initialFocus]);

  const offscreen = side === 'left' ? '-100%' : '100%';
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.12 } } }
    : {
        initial: { x: offscreen },
        animate: { x: 0 },
        exit: { x: offscreen, transition: { duration: 0.25, ease: EASE.exit } },
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="drawer"
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          data-region={region}
          tabIndex={-1}
          onFocusCapture={() => {
            focusWithin.current = true;
          }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusWithin.current = false;
          }}
          {...enter}
          transition={{ duration: reduced ? 0.12 : MOTION.flyout / 1000, ease: EASE.out }}
          style={{ width: width ?? (side === 'left' ? 'var(--drawer-inputs-w)' : 'var(--drawer-explain-w)') }}
          className={cn(
            'pointer-events-auto absolute inset-y-0 z-flyout flex max-w-full flex-col overflow-clip bg-panel text-primary outline-none',
            'shadow-[0_16px_48px_rgba(0,0,0,0.6)]',
            side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line',
            className,
          )}
        >
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.08, duration: MOTION.fast / 1000, ease: EASE.out }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
