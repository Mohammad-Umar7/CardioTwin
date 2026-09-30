import { motion, useIsPresent, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * A `motion.div` that leaves the tab order, the pointer and the accessibility tree the moment its exit
 * starts. `AnimatePresence` keeps an exiting child mounted until its exit animation ends, and a throttled
 * or background tab can hold it there for a long time: without this, a closed drawer or a faded card
 * would stay tabbable and readable while invisible. Use it as the keyed child of `AnimatePresence`
 * (it forwards its ref, so `mode="popLayout"` works too).
 */
export const ExitInert = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(function ExitInert(
  { className, ...props },
  forwarded,
) {
  const present = useIsPresent();
  const local = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (local.current) local.current.inert = !present;
  }, [present]);
  return (
    <motion.div
      {...props}
      ref={(el: HTMLDivElement | null) => {
        local.current = el;
        if (typeof forwarded === 'function') forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      aria-hidden={present ? props['aria-hidden'] : true}
      data-exiting={present ? undefined : ''}
      className={cn(className as string | undefined, !present && 'pointer-events-none')}
    />
  );
});
