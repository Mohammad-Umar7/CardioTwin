import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Keyboard, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ESCAPE_PRIORITY, Kbd, Shortcut, useEscapeLayer } from '@/design';
import { useSchema } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useCommands } from '@/hooks/useRegisterCommands';
import { cn } from '@/lib/cn';
import { CMD, SHORTCUT } from '@/state/commandIds';
import { isCommandEnabled, useCommandStore, type Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';
import { commandScore, searchCommands, type PaletteSection } from './commandSearch';

/**
 * Command palette (WORKSTATION_V2 §4.9): Ctrl K / ⌘K or "/". surface/3, e-3, r-lg on a 40 % scrim with
 * no blur; 640 px wide (600 at 1280), 96 px below the top bar. Groups in a fixed order; ↑↓ move, ↵ runs,
 * Tab opens the row's actions, Backspace on an empty query goes back a level, Esc closes (top of the Esc
 * chain). Focus stays in the input (`aria-activedescendant`).
 */
export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const reduced = useIsReducedMotion();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>{open && <PalettePanel key="palette" reduced={reduced} />}</AnimatePresence>,
    document.body,
  );
}

interface Row {
  key: string;
  command: Command;
}

function PalettePanel({ reduced }: { reduced: boolean }) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const commands = useCommands();
  const recent = useCommandStore((s) => s.recent);
  const schema = useSchema();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<Command | null>(null);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);

  const close = () => useUiStore.getState().setPaletteOpen(false);
  useEscapeLayer(true, () => (level ? back() : close()), ESCAPE_PRIORITY.palette);

  // Remember what had focus; give it back when the palette closes (unless a command moved focus on).
  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus({ preventScroll: true });
    return () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        el.focus({ preventScroll: true });
      }
    };
  }, []);

  const sections: PaletteSection[] = useMemo(() => {
    if (level) {
      const items = (level.actions ?? []).filter(isCommandEnabled);
      const q = query.trim();
      const matched = q ? items.filter((c) => commandScore(c, q) !== null) : items;
      return matched.length ? [{ group: level.group, label: level.title, items: matched }] : [];
    }
    return searchCommands(commands, query, { recent, exclude: [CMD.paletteOpen] });
  }, [commands, query, recent, level]);

  const inputCount = schema.data?.features.length;
  const fallbacks: Command[] = useMemo(
    () => [
      {
        id: 'palette.fallback.inputs',
        group: 'inputs',
        title: inputCount ? `Search all ${inputCount} inputs in the drawer` : 'Search all inputs in the drawer',
        icon: SlidersHorizontal,
        run: () => useUiStore.getState().openDrawer('inputs'),
      },
      {
        id: 'palette.fallback.shortcuts',
        group: 'actions',
        title: 'Show keyboard shortcuts',
        icon: Keyboard,
        shortcut: SHORTCUT.shortcuts,
        run: () => useUiStore.getState().setShortcutsOpen(true),
      },
    ],
    [inputCount],
  );

  const noResults = sections.length === 0;
  const rows: Row[] = useMemo(
    () =>
      noResults
        ? fallbacks.map((command) => ({ key: `fallback:${command.id}`, command }))
        : sections.flatMap((s) => s.items.map((command) => ({ key: `${s.group}:${command.id}`, command }))),
    [sections, fallbacks, noResults],
  );
  const current = rows[Math.min(active, rows.length - 1)];
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => setActive(0), [query, level]);

  useEffect(() => {
    if (!current) return;
    document.getElementById(optionId(Math.min(active, rows.length - 1)))?.scrollIntoView({ block: 'nearest' });
    // optionId is derived from listId (stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rows.length]);

  // Preview of the active row's effect (P2 hook: "CAD 98 % → 91 %").
  useEffect(() => {
    const command = current?.command;
    if (!command?.preview) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => command.preview!())
      .then(
        (text) => !cancelled && setPreview({ id: command.id, text }),
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, [current?.command]);

  const run = (command: Command) => {
    if (!isCommandEnabled(command)) return;
    close();
    if (!command.id.startsWith('palette.fallback')) useCommandStore.getState().pushRecent(command.id);
    command.run();
  };

  function back() {
    setLevel(null);
    setQuery('');
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = rows.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) setActive((i) => (i + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setActive((i) => (i - 1 + n) % n);
        break;
      case 'Home':
        if (!query) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!query) {
          e.preventDefault();
          setActive(Math.max(0, n - 1));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (current) run(current.command);
        break;
      case 'Tab':
        e.preventDefault();
        if (current?.command.actions?.length && !level) {
          setLevel(current.command);
          setQuery('');
        }
        break;
      case 'Backspace':
        if (!query && level) {
          e.preventDefault();
          back();
        }
        break;
      default:
    }
  };

  let index = -1;
  const transition = { duration: MOTION.fast / 1000, ease: EASE.out };

  return (
    <div className="fixed inset-0 z-scrim">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-[var(--scrim-palette)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.11 } }}
        transition={transition}
        onPointerDown={close}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-region="palette"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.11, ease: EASE.exit } }}
        transition={transition}
        className={cn(
          'absolute left-1/2 top-[calc(var(--topbar-h)+var(--palette-top))] flex w-[min(var(--palette-w),calc(100vw-16px))] flex-col',
          'max-h-[min(440px,calc(100vh-var(--topbar-h)-var(--palette-top)-var(--status-h)-16px))] overflow-clip rounded-lg bg-surface-3 text-primary shadow-e3',
          'min-[1100px]:max-[1439.98px]:max-h-[min(400px,calc(100vh-var(--topbar-h)-var(--palette-top)-var(--status-h)-16px))]',
        )}
        style={{ x: '-50%' }}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <Search aria-hidden className="size-4 shrink-0 stroke-[1.5] text-tertiary" />
          {level && (
            <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-label text-secondary">{level.title}</span>
          )}
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(Math.min(active, rows.length - 1)) : undefined}
            aria-label="Search commands, inputs, patients and views"
            placeholder={level ? `Actions for ${level.title}…` : 'Search or jump to…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[0.875rem] leading-5 text-primary outline-none placeholder:text-tertiary [&:focus-visible]:shadow-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={list} id={listId} role="listbox" aria-label="Results" className="panel-scroll min-h-0 flex-1 py-1">
          {noResults && (
            <p className="px-4 pb-1 pt-3 text-body-s text-secondary" role="status">
              No match for ‘{query.trim()}’
            </p>
          )}
          {(noResults ? [{ group: 'actions' as const, label: 'Try instead', items: fallbacks }] : sections).map((section) => {
            const headerId = `${listId}-${section.group}`;
            return (
              <div key={section.group} role="group" aria-labelledby={headerId}>
                <div id={headerId} className="eyebrow px-4 pb-1 pt-2 text-tertiary">
                  {section.label}
                </div>
                {section.items.map((command) => {
                  index += 1;
                  const i = index;
                  const selected = i === Math.min(active, rows.length - 1);
                  const Icon = command.icon;
                  const previewText = preview?.id === command.id && selected ? preview.text : null;
                  return (
                    <div
                      key={`${section.group}:${command.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => !selected && setActive(i)}
                      onClick={() => run(command)}
                      className={cn(
                        'mx-1 flex h-9 cursor-pointer items-center gap-3 rounded-sm px-3',
                        selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center text-secondary">
                        {Icon && <Icon className="size-4 stroke-[1.5]" />}
                      </span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-body-s text-primary">{command.title}</span>
                        {command.subtitle && <span className="truncate text-label font-normal text-tertiary">{command.subtitle}</span>}
                      </span>
                      {previewText ? (
                        <span className="num shrink-0 text-label text-secondary">{previewText}</span>
                      ) : command.shortcut ? (
                        <Shortcut shortcut={command.shortcut} />
                      ) : command.actions?.length && selected ? (
                        <span className="shrink-0 text-label font-normal text-tertiary">Tab for actions</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-4 text-label font-normal text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft aria-hidden className="size-3 stroke-[1.5]" />
            </Kbd>
            run
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Tab</Kbd> actions
          </span>
          <Shortcut shortcut="Mod+K" className="ml-auto" />
        </div>
      </motion.div>
    </div>
  );
}
