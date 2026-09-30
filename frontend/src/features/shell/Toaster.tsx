import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/routes';
import { EASE, MOTION } from '@/theme/tokens';
import { useUiStore, type Toast } from '@/state/uiStore';
import { toastDuration } from './toastDuration';

const ICON = { info: Info, success: CheckCircle2, warn: AlertTriangle, danger: XCircle } as const;
const TONE = { info: 'text-secondary', success: 'text-success', warn: 'text-warn', danger: 'text-danger' } as const;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const Icon = ICON[toast.tone];

  const arm = () => {
    const ms = toastDuration(toast);
    if (ms === null) return; // danger toasts persist
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss(toast.id), ms);
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: (MOTION.base * 0.7) / 1000, ease: EASE.exit } }}
      transition={{ duration: MOTION.base / 1000, ease: EASE.out }}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={arm}
      onFocusCapture={() => clearTimeout(timer.current)}
      onBlurCapture={arm}
      className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-24px)] items-center gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-body-s text-primary shadow-e2"
    >
      <Icon aria-hidden className={cn('size-4 shrink-0 stroke-[1.5]', TONE[toast.tone])} />
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="rounded-sm px-1 text-label font-semibold text-accent hover:text-accent-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="rounded-sm p-0.5 text-tertiary hover:text-primary">
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

/**
 * Toasts: bottom-right above the status line; they auto-hide (see `toastDuration`), paused on hover or focus.
 * While the Explain drawer is docked on the right they sit left of it, never over its rows.
 */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const rightDrawer = useUiStore((s) => s.drawer === 'explain');
  const { pathname } = useLocation();
  const docked = useMediaQuery('(min-width: 1100px)');
  const besideDrawer = docked && rightDrawer && pathname.startsWith(ROUTES.workstation);
  return (
    <div
      aria-live="polite"
      style={besideDrawer ? { right: 'calc(var(--drawer-explain-w) + 12px)' } : undefined}
      className="pointer-events-none fixed bottom-[calc(var(--status-h)+12px)] right-3 z-toast flex flex-col items-end gap-2 transition-[right] duration-base ease-out"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
