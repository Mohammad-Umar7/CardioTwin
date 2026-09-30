import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Height + fade collapse for the parts a card's selected / compact variant hides (V2 §8.1 "Right column
 * compact ⇄ full": height over `base`, content fades, no reflow jump below). Instant under reduced motion
 * (the global reduced-motion rule zeroes transition durations).
 *
 * Pure CSS: a grid row animates between 0fr and 1fr while the content fades. CSS transitions reverse
 * from wherever they are when interrupted, so a quick re-show (select a vessel, then Esc within 240 ms)
 * always lands fully open. The earlier AnimatePresence / animation-callback version could be revived at
 * its exit opacity 0 and leave a blank gap in the card. The content stays mounted; while closed it is
 * inert, hidden from assistive technology and `visibility: hidden` (switched at the end of the collapse).
 */
export function Collapse({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !show;
  }, [show]);
  return (
    <div
      ref={ref}
      aria-hidden={show ? undefined : true}
      data-collapse={show ? 'open' : 'closed'}
      className={cn(
        'grid transition-[grid-template-rows,opacity,visibility] duration-base ease-out',
        show ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
      )}
    >
      <div className={cn('min-h-0 overflow-clip', className)}>{children}</div>
    </div>
  );
}
