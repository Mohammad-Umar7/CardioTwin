import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Keyboard, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ESCAPE_PRIORITY, Kbd, Shortcut, Skeleton, useEscapeLayer } from '@/design';
import { useCohort, useSchema } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useCommands } from '@/hooks/useRegisterCommands';
import { cn } from '@/lib/cn';
import { CMD, SHORTCUT } from '@/state/commandIds';
import { isCommandEnabled, useCommandStore, type Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { EASE, MOTION } from '@/theme/tokens';
import { commandScore, paletteSuggestions, searchCommands, type PaletteSection } from './commandSearch';

/**
 * Command palette (WORKSTATION_V2 §4.9): Ctrl K / ⌘K or "/". surface/3, e-3, r-lg on a 40 % scrim with
 * no blur; 640 px wide (600 at 1280, 100 % − 16 below 1100), 96 px below the top bar (72 at 1280).
 * Groups in a fixed order, capped per group so opening stays O(visible rows); ↑↓ move, ↵ runs, Tab opens
 * the row's actions, Backspace on an empty query goes back a level, Esc closes (top of the Esc chain).
 * Focus stays in the input (`aria-activedescendant`).
 */
export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const reduced = useIsReducedMotion();
  const prewarm = usePrewarm(open);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <AnimatePresence>{open && <PalettePanel key="palette" reduced={reduced} />}</AnimatePresence>
      {prewarm && (
        <div hidden aria-hidden>
          <PalettePanel reduced prewarm />
        </div>
      )}
    </>,
    document.body,
  );
}

/** Delay after load before the one-off hidden render that warms the palette's code paths. */
const PREWARM_AFTER_MS = 2500;

/**
 * The first open pays for React creating the panel, the motion nodes and the row icons for the first
 * time. One hidden, inert render at idle (never focused, no Esc layer, removed right after it commits)
 * warms those paths, so even the first Ctrl K opens within the 50 ms budget (V2 §9.3 A accept).
 */
function usePrewarm(open: boolean): boolean {
  const [phase, setPhase] = useState<'idle' | 'render' | 'done'>('idle');
  useEffect(() => {
    if (phase !== 'idle') return;
    const ric = window.requestIdleCallback?.bind(window);
    const t = window.setTimeout(() => {
      if (ric) ric(() => setPhase('render'), { timeout: 2000 });
      else setPhase('render');
    }, PREWARM_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'render') setPhase('done');
  }, [phase]);
  useEffect(() => {
    if (open && phase === 'idle') setPhase('done');
  }, [open, phase]);
  return phase === 'render' && !open;
}


function PalettePanel({ reduced, prewarm = false }: { reduced: boolean; prewarm?: boolean }) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const commands = useCommands();
  const recent = useCommandStore((s) => s.recent);
  const selected = useViewerStore((s) => s.selectedStructure);
  const schema = useSchema();
  const cohortLoading = useCohort().status === 'loading';
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<Command | null>(null);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);

  const close = () => useUiStore.getState().setPaletteOpen(false);
  // Only while open: during its 110 ms exit the panel must not swallow the next Esc (the layer below's).
  const open = useUiStore((s) => s.paletteOpen);
  useEscapeLayer(open && !prewarm, () => (level ? back() : close()), ESCAPE_PRIORITY.palette);

  // Remember what had focus; give it back when the palette closes (unless a command moved focus on).
  useEffect(() => {
    if (prewarm) return;
    opener.current = document.activeElement;
    input.current?.focus({ preventScroll: true });
    return () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        el.focus({ preventScroll: true });
      }
    };
  }, [prewarm]);

  const sections: PaletteSection[] = useMemo(() => {
    if (level) {
      const items = (level.actions ?? []).filter(isCommandEnabled);
      const q = query.trim();
      const matched = q ? items.filter((c) => commandScore(c, q) !== null) : items;
      return matched.length ? [{ group: level.group, label: level.title, items: matched }] : [];
    }
    return searchCommands(commands, query, {
      recent,
      exclude: [CMD.paletteOpen],
      suggestedIds: paletteSuggestions(selected),
    });
  }, [commands, query, recent, level, selected]);

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
  const shownSections: PaletteSection[] = useMemo(
    () => (noResults ? [{ group: 'actions', label: 'Try instead', items: fallbacks }] : sections),
    [noResults, fallbacks, sections],
  );
  const rows = useMemo(() => shownSections.flatMap((s) => s.items.map((command) => ({ command }))), [shownSections]);
  const activeIndex = Math.min(active, rows.length - 1);
  const current = rows[activeIndex];
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => setActive(0), [query, level]);

  useEffect(() => {
    if (!current) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // optionId is derived from listId (stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, rows.length]);

  // At rest, the Suggested levers show their effect before they are even hovered ("Flip typical angina ·
  // CAD ≥95 % → 62 %"): a handful of rows, each one worker batch of two.
  const [restPreviews, setRestPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const suggestedWithPreview = useMemo(
    () =>
      query.trim() || level
        ? []
        : (sections.find((x) => x.group === 'suggested')?.items ?? []).filter((c) => c.preview).slice(0, 3),
    [sections, query, level],
  );
  // Keyed on the rows' ids, not the array: a re-render (e.g. this effect's own result) never re-fetches.
  const suggestedKey = suggestedWithPreview.map((c) => c.id).join('|');
  const suggestedRef = useRef(suggestedWithPreview);
  suggestedRef.current = suggestedWithPreview;
  useEffect(() => {
    const rows = suggestedRef.current;
    if (prewarm || rows.length === 0) return;
    let cancelled = false;
    void Promise.all(
      rows.map((c) =>
        Promise.resolve()
          .then(() => c.preview!())
          .then(
            (text) => [c.id, text] as const,
            () => null,
          ),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map(pairs.filter((x): x is readonly [string, string] => x !== null));
      setRestPreviews((prev) =>
        prev.size === next.size && [...next].every(([id, text]) => prev.get(id) === text) ? prev : next,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [suggestedKey, prewarm]);

  // Preview of the active row's effect ("CAD 98 % → 91 %"), fetched for that row only.
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
        if (n) setActive((i) => (Math.min(i, n - 1) + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setActive((i) => (Math.min(i, n - 1) - 1 + n) % n);
        break;
      case 'PageDown':
        e.preventDefault();
        if (n) setActive((i) => Math.min(n - 1, i + 8));
        break;
      case 'PageUp':
        e.preventDefault();
        if (n) setActive((i) => Math.max(0, i - 8));
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
  const showSkeleton = !query.trim() && !level && cohortLoading;

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
          'absolute left-1/2 top-[calc(var(--topbar-h)+var(--palette-top))] flex w-[min(var(--palette-w),calc(100vw-16px))] origin-top flex-col',
          'max-h-[min(440px,calc(100vh-var(--topbar-h)-var(--palette-top)-var(--status-h)-16px))] overflow-clip rounded-lg bg-surface-3 text-primary shadow-e3',
          'max-[1439.98px]:max-h-[min(400px,calc(100vh-var(--topbar-h)-var(--palette-top)-var(--status-h)-16px))]',
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
            aria-activedescendant={current ? optionId(activeIndex) : undefined}
            aria-label="Search commands, inputs, patients and views"
            placeholder={level ? `Actions for ${level.title}…` : 'Search or jump to…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-tertiary [&:focus-visible]:shadow-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="panel-scroll min-h-0 flex-1 py-1">
          {noResults && (
            <p className="px-4 pb-1 pt-3 text-body-s text-secondary" role="status">
              No match for ‘{query.trim()}’
            </p>
          )}
          {shownSections.map((section) => {
            const headerId = `${listId}-${section.group}`;
            return (
              <div key={section.group} role="group" aria-labelledby={headerId}>
                <div id={headerId} className="eyebrow flex h-7 items-end px-4 pb-1 text-tertiary">
                  {section.label}
                </div>
                {section.items.map((command) => {
                  index += 1;
                  const i = index;
                  const isActive = i === activeIndex;
                  const Icon = command.icon;
                  const previewText =
                    preview?.id === command.id && isActive
                      ? preview.text
                      : section.group === 'suggested'
                        ? (restPreviews.get(command.id) ?? null)
                        : null;
                  return (
                    <div
                      key={`${section.group}:${command.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => !isActive && setActive(i)}
                      onClick={() => run(command)}
                      className={cn(
                        'mx-1 flex h-9 cursor-pointer items-center gap-3 rounded-sm px-3 transition-colors duration-instant',
                        isActive ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn('inline-flex size-4 shrink-0 items-center justify-center', isActive ? 'text-primary' : 'text-tertiary')}
                      >
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
                      ) : command.actions?.length && isActive ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-label font-normal text-tertiary">
                          Actions <Kbd>Tab</Kbd>
                        </span>
                      ) : command.hint ? (
                        <span className="num max-w-[40%] shrink-0 truncate text-label font-normal text-tertiary">{command.hint}</span>
                      ) : null}
                    </div>
                  );
                })}
                {section.more ? (
                  <div aria-hidden className="mx-1 flex h-7 items-center px-3 pl-10 text-label font-normal text-tertiary">
                    + {section.more} more · type to narrow
                  </div>
                ) : null}
                {showSkeleton && section.group === 'suggested' && (
                  <div aria-hidden>
                    <div className="eyebrow flex h-7 items-end px-4 pb-1 text-tertiary">Patients</div>
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="mx-1 flex h-9 items-center gap-3 px-3">
                        <Skeleton className="size-4 shrink-0" />
                        <Skeleton className="h-3 w-40" />
                      </div>
                    ))}
                  </div>
                )}
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
