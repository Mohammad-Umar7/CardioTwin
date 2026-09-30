import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EASE, MOTION } from '@/theme/tokens';
import { ESCAPE_PRIORITY, useEscapeLayer } from './escapeStack';
import { trapFocus } from './focus';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  /** Short line under the title. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}

/**
 * Dialog sheet: surface/3 on a scrim, e-3, r-lg. Focus is trapped, Esc closes and focus returns to the
 * element that opened it (DESIGN_SYSTEM §10.11). Never used for the disclaimer itself (§9).
 */
export function Modal({ open, onClose, title, description, children, footer, width = 560, className }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // Esc is one layer of the app-wide chain (palette → modal → menu → drawer → … → focus mode).
  useEscapeLayer(open, onClose, ESCAPE_PRIORITY.modal);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panelRef.current;
      first?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') trapFocus(panelRef.current)(e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-popover flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MOTION.base / 1000, ease: EASE.out }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: (MOTION.base * 0.7) / 1000, ease: EASE.exit } }}
            transition={{ duration: MOTION.base / 1000, ease: EASE.out }}
            style={{ maxWidth: width }}
            className={cn(
              'relative flex max-h-[calc(100vh-var(--status-h)-48px)] w-full flex-col rounded-lg bg-surface-3 shadow-e3 outline-none',
              className,
            )}
          >
            <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-title-2 text-primary">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1 text-body-s text-secondary">
                    {description}
                  </p>
                )}
              </div>
              <IconButton label="Close" icon={<X />} onClick={onClose} tooltip={false} />
            </header>
            <div className="panel-scroll min-h-0 flex-1 px-5 py-4">{children}</div>
            {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
