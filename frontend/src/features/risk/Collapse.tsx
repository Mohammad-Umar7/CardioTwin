import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { EASE, MOTION } from '@/theme/tokens';

/**
 * Height + fade collapse for the parts a card's selected / compact variant hides (V2 §8.1 "Right column
 * compact ⇄ full": height over `base`, content fades, no reflow jump below). Instant under reduced motion.
 */
export function Collapse({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const reduced = useIsReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : MOTION.base / 1000, ease: EASE.out }}
          className={cn('overflow-clip', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
