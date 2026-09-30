import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { shortcutLabels } from './shortcut';

/**
 * Keyboard key chip (WORKSTATION_V2 §5.4): h 18, padding 0 4, r-xs, 1 px border/default, mono 11/16
 * text/tertiary. 11 px is allowed here (Kbd is one of the three 11 px exceptions).
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'mono inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-xs border border-line px-1 text-[0.6875rem] font-normal not-italic leading-4 text-tertiary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface ShortcutProps {
  /** Shortcut string in the registry grammar ("Mod+K,/", "I", "0,H"). */
  shortcut: string | undefined;
  /** Show every alternative ("Ctrl K or /"); default: the first only. */
  all?: boolean;
  className?: string;
}

/** Renders a shortcut as Kbd chips, with the platform's modifier names (⌘ on macOS, Ctrl elsewhere). */
export function Shortcut({ shortcut, all = false, className }: ShortcutProps) {
  const alternatives = shortcutLabels(shortcut);
  if (alternatives.length === 0) return null;
  const shown = all ? alternatives : alternatives.slice(0, 1);
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {shown.map((labels, i) => (
        <Fragment key={labels.join('+')}>
          {i > 0 && <span className="px-1 text-label font-normal text-tertiary">or</span>}
          {labels.map((label) => (
            <Kbd key={label}>{label}</Kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
