import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AccordionItemProps {
  open: boolean;
  onToggle(): void;
  /** Header content (overline title, badges, mini-bars). */
  header: ReactNode;
  /** Right-aligned header slot. */
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  headerClassName?: string;
}

/**
 * Disclosure section (DESIGN_SYSTEM §5 GroupAccordion header: h 32, 16 px chevron). Height animates with
 * the CSS grid 0fr → 1fr technique, so no layout measurement or JS animation is needed.
 */
export function AccordionItem({ open, onToggle, header, aside, children, id, className, headerClassName }: AccordionItemProps) {
  const autoId = useId();
  const base = id ?? autoId;
  const regionId = `${base}-region`;
  const buttonId = `${base}-button`;
  const regionRef = useRef<HTMLDivElement>(null);
  // Collapsed content must leave the tab order and the accessibility tree.
  useEffect(() => {
    if (regionRef.current) regionRef.current.inert = !open;
  }, [open]);
  return (
    <div className={cn('border-b border-hairline', className)} data-open={open || undefined}>
      <h3 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className={cn(
            'group flex h-md w-full items-center gap-1.5 px-4 text-left transition-colors duration-instant hover:bg-white/[0.05]',
            headerClassName,
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn('size-4 shrink-0 stroke-[1.5] text-tertiary transition-transform duration-fast ease-out', open && 'rotate-90')}
          />
          <span className="flex min-w-0 flex-1 items-center gap-2">{header}</span>
          {aside && <span className="flex shrink-0 items-center gap-2">{aside}</span>}
        </button>
      </h3>
      <div
        ref={regionRef}
        id={regionId}
        role="region"
        aria-labelledby={buttonId}
        className={cn(
          'grid transition-[grid-template-rows] duration-base ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-clip">{children}</div>
      </div>
    </div>
  );
}

/** Stack of AccordionItems with a top hairline. */
export function Accordion({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn('border-t border-hairline', className)} aria-label={label} role={label ? 'group' : undefined}>
      {children}
    </div>
  );
}
