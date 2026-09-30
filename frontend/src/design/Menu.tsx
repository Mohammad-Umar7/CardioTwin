import { Check } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { ESCAPE_PRIORITY, useEscapeLayer } from './escapeStack';
import { returnFocusQuietly } from './focus';
import { Shortcut } from './Kbd';
import { computePosition, type Placement } from './position';

export interface MenuTriggerProps {
  ref: (el: HTMLElement | null) => void;
  onClick(): void;
  onKeyDown(e: ReactKeyboardEvent<HTMLElement>): void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface MenuProps {
  /** Accessible name of the menu ("View", "Layers", "More"). */
  label: string;
  /** Render prop for the trigger: spread `props` onto a button. */
  trigger(props: MenuTriggerProps): ReactNode;
  /** MenuItem / MenuSeparator / MenuLabel children, or a render function receiving `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  /** Minimum width in px (default 200). */
  width?: number;
  className?: string;
  onOpenChange?(open: boolean): void;
}

interface MenuContextValue {
  close(options?: { returnFocus?: boolean }): void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

function items(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter((el) => el.getAttribute('aria-disabled') !== 'true');
}

/**
 * Menu (WORKSTATION_V2 §5.4): surface/3, e-3, r-lg; items h 32, 13/18; the shortcut is right-aligned as a
 * Kbd; radio and checkbox items show a 16 px check. WAI-ARIA menu button pattern: ↓/↵/Space on the trigger
 * opens it (↑ opens on the last item), ↑↓ Home End move, ↵ Space activate, Esc closes and returns focus
 * to the trigger, Tab closes. Enters with a fade + y 4 over `fast`.
 */
export function Menu({ label, trigger, children, placement = 'bottom', width = 200, className, onOpenChange }: MenuProps) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const initial = useRef<'first' | 'last'>('first');

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) setPos(null);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    ({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
      setOpenState(false);
      if (returnFocus) returnFocusQuietly(anchor.current);
    },
    [setOpenState],
  );

  useEscapeLayer(open, () => close(), ESCAPE_PRIORITY.menu);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const p = computePosition(
      anchor.current.getBoundingClientRect(),
      { width: panel.current.offsetWidth, height: panel.current.offsetHeight },
      placement,
      6,
    );
    setPos({ top: p.top, left: p.left });
    const all = items(panel.current);
    const checked = all.find((el) => el.getAttribute('aria-checked') === 'true' && el.getAttribute('role') === 'menuitemradio');
    const target = initial.current === 'last' ? all[all.length - 1] : (checked ?? all[0]);
    (target ?? panel.current).focus({ preventScroll: true });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpenState(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, setOpenState]);

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = items(panel.current);
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => all[(i + all.length) % all.length]?.focus({ preventScroll: true });
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(index < 0 ? all.length - 1 : index - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(all.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        close({ returnFocus: false });
        break;
      default:
    }
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      initial.current = e.key === 'ArrowUp' ? 'last' : 'first';
      setOpenState(true);
    }
  };

  return (
    <>
      {trigger({
        ref: (el) => {
          anchor.current = el;
        },
        onClick: () => {
          initial.current = 'first';
          setOpenState(!open);
        },
        onKeyDown: onTriggerKeyDown,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
      })}
      {open &&
        createPortal(
          <MenuContext.Provider value={{ close }}>
            <div
              ref={panel}
              id={id}
              role="menu"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onPanelKeyDown}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: width }}
              className={cn(
                'fixed z-popover flex flex-col rounded-lg bg-surface-3 p-1 text-body-s text-primary shadow-e3 outline-none',
                pos ? 'menu-enter' : 'opacity-0',
                className,
              )}
            >
              {typeof children === 'function' ? children(() => close()) : children}
            </div>
          </MenuContext.Provider>,
          document.body,
        )}
    </>
  );
}

export interface MenuItemProps {
  onSelect?(): void;
  /** action (default) · radio (one of a group, shows a check when `checked`) · checkbox (toggles). */
  type?: 'action' | 'radio' | 'checkbox';
  checked?: boolean;
  disabled?: boolean;
  /** Registry-grammar shortcut, rendered right-aligned as Kbd ("H", "[", "Mod+K"). */
  shortcut?: string;
  /** 16 px icon (lucide, stroke 1.5) for action items. */
  icon?: ReactNode;
  /** Right-aligned secondary text, e.g. the current value (shown when there is no shortcut). */
  hint?: ReactNode;
  /** Keep the menu open after selection (checkbox toggles). Default: close. */
  keepOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function MenuItem({
  onSelect,
  type = 'action',
  checked = false,
  disabled = false,
  shortcut,
  icon,
  hint,
  keepOpen = false,
  children,
  className,
}: MenuItemProps) {
  const ctx = useContext(MenuContext);
  const role = type === 'radio' ? 'menuitemradio' : type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem';
  const checkable = type !== 'action';
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      aria-checked={checkable ? checked : undefined}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        if (!keepOpen) ctx?.close();
      }}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-s text-primary outline-none',
        'transition-colors duration-instant ease-instant hover:bg-surface-2 focus-visible:bg-surface-2 focus:bg-surface-2',
        disabled && 'cursor-not-allowed text-disabled hover:bg-transparent',
        className,
      )}
    >
      {checkable ? (
        <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center text-accent">
          {checked && <Check className="size-4 stroke-[1.75]" />}
        </span>
      ) : (
        icon && <span aria-hidden className="inline-flex size-4 shrink-0 text-secondary [&>svg]:size-4 [&>svg]:stroke-[1.5]">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <Shortcut shortcut={shortcut} className="ml-4" />
      ) : (
        hint !== undefined && <span className="ml-4 shrink-0 text-label font-normal text-tertiary">{hint}</span>
      )}
    </button>
  );
}

/** 1 px hairline between item groups. */
export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-line" />;
}

/** Overline group label inside a menu ("PROJECTIONS"). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="eyebrow px-2 pb-1 pt-2 text-tertiary">
      {children}
    </div>
  );
}
