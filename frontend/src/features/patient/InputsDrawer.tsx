import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Download, FileText, FileUp, Link2, MoreHorizontal, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Drawer, IconButton, Kbd, Menu, MenuItem, MenuSeparator, Skeleton, withShortcut } from '@/design';
import { useSchemaIndex, type SchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/routes';
import { CMD } from '@/state/commandIds';
import { editedKeys, selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore, type InputsSection } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';
import type { FeatureSpec } from '@/types/contracts';
import { FieldRow } from './FieldRow';
import { FindingChips } from './FindingChips';
import { useCurrentTarget, useRowExpansion } from './hooks';
import { computeSections, searchInputs, type DrawerSections } from './lib/sections';
import { copyShareLink, exportProfile, importProfileFile, pickProfileFile, resetAllEdits } from './profileActions';

/**
 * InputsDrawer — WORKSTATION_V2 §5.6. Answers "What if I change something?". Docked to the stage's left
 * edge over the patient card (StageLayout fades the card out), `data-region="inputs-drawer"`.
 *
 *   header   EDIT INPUTS · 53 · ⋯ (share link, JSON export / import) · ✕
 *   search   label, aliases and raw key; while typing, the sections flatten into one ranked list
 *   sections Abnormal findings · Most influential for {target} · All inputs (7 groups) · Changed tray
 *   footer   "2 changes · applied instantly" + Done (the only filled button on screen)
 *
 * Stability: the lower sections are laid out once per opening (and when the target or patient changes),
 * so nothing under the pointer disappears while editing. "Changed" is a fixed-height tray under the list
 * (reserved from the moment the drawer opens), so an edit never shrinks the list or covers the row in use.
 *
 * Open state, the row to focus (`focusField`) and the section to scroll to (`inputsSection`) come from
 * `uiStore.openDrawer('inputs', { field, section })`. A JSON profile can be dropped anywhere on the drawer.
 */
export interface InputsDrawerProps {
  className?: string;
}


export function InputsDrawer({ className }: InputsDrawerProps) {
  const open = useUiStore((s) => s.drawer === 'inputs');
  const close = useUiStore((s) => s.closeDrawer);
  const titleId = useId();

  return (
    <Drawer
      open={open}
      side="left"
      onClose={close}
      labelledBy={titleId}
      region="inputs-drawer"
      openerKey="drawer:inputs"
      returnFocus='[data-drawer-opener="inputs"]'
      className={className}
    >
      <DrawerContent titleId={titleId} onClose={close} />
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------ helpers

/** The control a keyboard user expects to land on for an input row or chip. */
function focusTarget(el: HTMLElement): HTMLElement {
  if (el.matches('button, input, select')) return el;
  return (
    el.querySelector<HTMLElement>('input:not([type="range"])') ??
    el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
    el.querySelector<HTMLElement>('select, button, input') ??
    el
  );
}

/** Scroll `el` into the body's view without touching any ancestor scroll position (P0-1). */
function revealInBody(body: HTMLElement, el: HTMLElement, align: 'start' | 'center' = 'center') {
  const bodyRect = body.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const top = rect.top - bodyRect.top + body.scrollTop;
  const stickyHeader = 32;
  const visible = rect.top >= bodyRect.top + stickyHeader && rect.bottom <= bodyRect.bottom;
  if (align === 'start') body.scrollTop = Math.max(0, top);
  else if (!visible) body.scrollTop = Math.max(0, top - body.clientHeight / 3);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ----------------------------------------------------------------------------------------- sections

function SectionHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-8 items-center justify-between gap-2 bg-[rgba(17,22,29,0.94)] px-4 shadow-[0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
      <h3 className="eyebrow m-0 flex min-w-0 items-center gap-1.5 truncate text-tertiary">
        <span className="truncate">{title}</span>
        {count !== undefined && (
          <>
            <span aria-hidden>·</span>
            <span key={count} className="num animate-rise-in">
              {count}
            </span>
          </>
        )}
      </h3>
      {action}
    </header>
  );
}

/** Rows for non-binary inputs, then one chip cloud for the findings. */
function InputList({
  specs,
  section,
  expanded,
  chipsLabel,
  chipsLead,
}: {
  specs: readonly FeatureSpec[];
  section: string;
  expanded: string | null;
  chipsLabel: string;
  chipsLead?: string;
}) {
  const rows = specs.filter((s) => s.type !== 'binary');
  const chips = specs.filter((s) => s.type === 'binary');
  return (
    <div className="flex flex-col px-3 pb-2 pt-1">
      {rows.map((spec) => {
        const rowId = `${section}:${spec.key}`;
        return <FieldRow key={spec.key} spec={spec} rowId={rowId} expanded={expanded === rowId} />;
      })}
      {chips.length > 0 && (
        <FindingChips specs={chips} label={chipsLabel} idPrefix={section} lead={chipsLead} className={rows.length > 0 ? 'pt-1.5' : undefined} />
      )}
    </div>
  );
}

/**
 * The live "Changed" tray, docked between the list and the footer at a FIXED height from the moment the
 * drawer opens (an empty state until the first edit). It sits outside the scrolling list and never grows, so
 * an edit can neither move the list under the pointer nor cover the row being edited (no layout shift,
 * V2 §8.6): the list's viewport is the same before and after every edit. More edits than fit scroll inside
 * the tray. It follows the edits in the same frame.
 */
function ChangedTray({
  keys,
  index,
  expanded,
  onHold,
}: {
  keys: string[];
  index: SchemaIndex;
  expanded: string | null;
  onHold(feature: string | null): void;
}) {
  const reduced = useIsReducedMotion();
  const specs = keys.map((k) => index.byKey.get(k)).filter((s): s is FeatureSpec => !!s);
  const t = { duration: reduced ? 0.12 : MOTION.base / 1000, ease: EASE.out };
  const empty = specs.length === 0;
  return (
    <section
      aria-label="Changed inputs"
      data-section="changed"
      className="relative flex h-[clamp(104px,18vh,152px)] shrink-0 flex-col border-t border-white/[0.06] bg-black/20"
      onFocusCapture={(e) => onHold((e.target as HTMLElement).closest<HTMLElement>('[data-feature]')?.dataset.feature ?? null)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHold(null);
      }}
    >
      <SectionHeader
        title="Changed"
        count={empty ? undefined : specs.length}
        action={
          empty ? undefined : (
            <button
              type="button"
              onClick={resetAllEdits}
              className="rounded-sm px-1.5 py-0.5 text-label font-medium text-secondary transition-colors duration-instant hover:bg-white/[0.07] hover:text-primary"
            >
              Reset all
            </button>
          )
        }
      />
      <div className="panel-scroll flex min-h-0 flex-1 flex-col px-3 pb-2 pt-1">
        {empty ? (
          <p className="m-0 px-1 pt-1.5 text-label font-normal text-tertiary">
            Edits appear here, each with its recorded value and an undo.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {specs.map((spec) => {
              const rowId = `changed:${spec.key}`;
              return (
                <motion.div
                  key={spec.key}
                  initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={t}
                  className="shrink-0 overflow-clip"
                >
                  <FieldRow spec={spec} rowId={rowId} expanded={expanded === rowId} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}

function GroupAccordion({
  group,
  open,
  onToggle,
  expanded,
  edited,
  imputed,
}: {
  group: SchemaIndex['groups'][number];
  open: boolean;
  onToggle(): void;
  expanded: string | null;
  edited: number;
  imputed: number;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (regionRef.current) regionRef.current.inert = !open;
  }, [open]);
  return (
    <div data-group={group.id} className="border-t border-hairline first:border-t-0">
      <h4 className="m-0">
        <button
          type="button"
          id={`${id}-h`}
          aria-expanded={open}
          aria-controls={`${id}-r`}
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-2 px-4 text-left transition-colors duration-instant hover:bg-white/[0.05]"
        >
          <ChevronRight aria-hidden className={cn('size-4 shrink-0 stroke-[1.5] text-tertiary transition-transform duration-fast ease-out', open && 'rotate-90')} />
          <span className="min-w-0 truncate text-body-s font-medium text-primary">{group.label}</span>
          <span className="num text-label font-normal text-tertiary">{group.features.length}</span>
          {edited > 0 && (
            <span className="inline-flex items-center" title={`${plural(edited, 'edit')}`}>
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              <span className="sr-only">, {plural(edited, 'edit')}</span>
            </span>
          )}
          {imputed > 0 && <span className="ml-auto text-label font-normal text-tertiary">{imputed} imputed</span>}
        </button>
      </h4>
      <div
        id={`${id}-r`}
        role="region"
        aria-labelledby={`${id}-h`}
        className={cn('grid transition-[grid-template-rows] duration-base ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
        <div ref={regionRef} className="min-h-0 overflow-clip">
          {open && <InputList specs={group.features} section={`group-${group.id}`} expanded={expanded} chipsLabel={`${group.label} findings`} />}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------- the drawer

function useLayoutSnapshot(index: SchemaIndex | null, target: string) {
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const explanation = usePatientStore((s) => s.prediction?.explanations[target] ?? null);
  const live = useRef({ features, recorded, explanation });
  live.current = { features, recorded, explanation };

  const compute = useCallback((): (DrawerSections & { withShap: boolean }) | null => {
    if (!index) return null;
    const l = live.current;
    return { ...computeSections({ index, features: l.features, recorded: l.recorded, explanation: l.explanation }), withShap: !!l.explanation };
  }, [index]);

  const [snapshot, setSnapshot] = useState(compute);
  const [refresh, setRefresh] = useState(0);

  // Re-lay out for another target, another patient, or when the first explanation arrives.
  useEffect(() => {
    setSnapshot(compute());
  }, [compute, target, recorded, refresh]);
  useEffect(() => {
    if (snapshot && !snapshot.withShap && explanation) setSnapshot(compute());
  }, [snapshot, explanation, compute]);

  return { snapshot, relayout: () => setRefresh((r) => r + 1) };
}

/**
 * The keys the "Changed" tray lists, in schema order and in the same frame as the edit. A tray row that holds
 * focus stays until focus leaves the tray, even once its edit is undone (it never vanishes under the caret).
 */
function useChangedList(index: SchemaIndex | null) {
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const [held, setHeld] = useState<string | null>(null);
  const keys = useMemo(() => {
    const edited = new Set(editedKeys(features, recorded));
    // Everything reset (Reset all, a new patient): the tray closes at once.
    if (edited.size === 0) return [];
    if (held) edited.add(held);
    return (index?.features ?? []).map((f) => f.key).filter((k) => edited.has(k));
  }, [features, recorded, index, held]);
  return { keys, hold: setHeld };
}

function DrawerContent({ titleId, onClose }: { titleId: string; onClose(): void }) {
  const index = useSchemaIndex();
  const target = useCurrentTarget();
  const navigate = useNavigate();
  const edits = usePatientStore(selectEditCount);
  const imputedList = usePatientStore((s) => s.prediction?.imputed);
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const focusField = useUiStore((s) => s.focusField);
  const inputsSection = useUiStore((s) => s.inputsSection);
  const [query, setQuery] = useState('');
  const [dropping, setDropping] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { expanded, handlers } = useRowExpansion();
  const { snapshot, relayout } = useLayoutSnapshot(index, target);
  const changed = useChangedList(index);

  // "/" focuses the search while the drawer is open (V2 §4.10), above the palette's own "/".
  useRegisterCommands(
    'patient.inputs-drawer',
    [
      {
        id: CMD.inputsSearch,
        group: 'inputs',
        title: 'Find an input',
        subtitle: 'Edit inputs drawer',
        shortcut: '/',
        icon: Search,
        when: () => useUiStore.getState().drawer === 'inputs',
        run: () => {
          search.current?.focus();
          search.current?.select();
        },
      },
    ],
    [],
    { priority: 1 },
  );

  const hits = useMemo(() => (index && query.trim() ? searchInputs(index, query) : []), [index, query]);

  const specs = useCallback((keys: readonly string[]) => keys.map((k) => index?.byKey.get(k)).filter((s): s is FeatureSpec => !!s), [index]);

  const groupFacts = useMemo(() => {
    const edited = new Set(editedKeys(features, recorded));
    const imputed = new Set(imputedList ?? []);
    const facts = new Map<string, { edited: number; imputed: number }>();
    for (const g of index?.groups ?? []) {
      facts.set(g.id, {
        edited: g.features.filter((f) => edited.has(f.key)).length,
        imputed: g.features.filter((f) => imputed.has(f.key)).length,
      });
    }
    return facts;
  }, [features, recorded, imputedList, index]);

  // ---- focus a requested field (row click in the card, palette, tour) and scroll to a section
  // Sections inside the scrolling list (the Changed tray sits outside it): other fields open their group.
  const upper = useMemo(() => new Set([...(snapshot?.abnormal ?? []), ...(snapshot?.key ?? [])]), [snapshot]);
  useLayoutEffect(() => {
    if (!focusField || !index) return;
    const spec = index.byKey.get(focusField);
    if (!spec) return;
    if (query) setQuery('');
    if (!upper.has(focusField)) setOpenGroups((g) => (g.has(spec.group) ? g : new Set(g).add(spec.group)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField, index]);
  useEffect(() => {
    if (!focusField) return;
    // After the Drawer's own initial focus (setTimeout 0) and the group's render.
    const t = window.setTimeout(() => {
      const root = body.current;
      const el = root?.querySelector<HTMLElement>(`[data-feature="${CSS.escape(focusField)}"]`);
      if (!root || !el) return;
      revealInBody(root, el);
      focusTarget(el).focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(t);
  }, [focusField, openGroups]);
  useEffect(() => {
    if (!inputsSection || focusField) return;
    const t = window.setTimeout(() => {
      const root = body.current;
      const el = root?.querySelector<HTMLElement>(`[data-section="${inputsSection satisfies InputsSection}"]`);
      if (root && el) revealInBody(root, el, 'start');
    }, 40);
    return () => window.clearTimeout(t);
  }, [inputsSection, focusField]);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
      relayout();
    } else if ((e.key === 'ArrowDown' || e.key === 'Enter') && hits.length > 0) {
      e.preventDefault();
      const first = body.current?.querySelector<HTMLElement>('[data-feature]');
      if (first) focusTarget(first).focus({ preventScroll: true });
    }
  };

  // ---- JSON profile drop
  const onDragOver = (e: DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (file) void importProfileFile(file, navigate);
  };

  const total = index?.features.length ?? 53;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 pl-4 pr-2">
        <h2 id={titleId} className="eyebrow m-0 flex-1 text-secondary">
          Edit inputs <span className="text-tertiary">· {total}</span>
        </h2>
        <Menu
          label="Patient profile"
          width={248}
          trigger={(props) => (
            <IconButton {...props} label="Share, export or import" tooltip="Share · export · import" icon={<MoreHorizontal />} size="sm" />
          )}
        >
          <MenuItem icon={<Link2 />} onSelect={() => void copyShareLink()} hint="URL">
            Copy share link
          </MenuItem>
          <MenuItem icon={<Download />} onSelect={() => void exportProfile()} hint=".json">
            Export profile
          </MenuItem>
          <MenuItem icon={<FileUp />} onSelect={() => pickProfileFile(navigate)} hint=".json">
            Import profile…
          </MenuItem>
          <MenuItem icon={<FileText />} onSelect={() => navigate(ROUTES.report)} hint="PDF">
            Printable report
          </MenuItem>
          {edits > 0 && (
            <>
              <MenuSeparator />
              <MenuItem icon={<RotateCcw />} onSelect={resetAllEdits}>
                Reset all edits
              </MenuItem>
            </>
          )}
        </Menu>
        <IconButton label="Close" tooltip={withShortcut('Close', 'Escape')} icon={<X />} size="sm" onClick={onClose} />
      </header>

      <div className="shrink-0 px-4 pb-2">
        <div className="group/search flex h-8 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2 transition-colors duration-fast focus-within:border-accent/60 hover:border-line-strong">
          <Search aria-hidden className="size-4 shrink-0 stroke-[1.5] text-tertiary" />
          <input
            ref={search}
            data-autofocus
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) relayout();
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Find an input — e.g. ejection fraction"
            aria-label="Find an input"
            aria-controls={`${titleId}-body`}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-body-s text-primary outline-none placeholder:text-tertiary [&::-webkit-search-cancel-button]:hidden [&:focus-visible]:shadow-none"
          />
          {query ? (
            <IconButton
              label="Clear search"
              tooltip={false}
              icon={<X />}
              size="xs"
              onClick={() => {
                setQuery('');
                relayout();
                search.current?.focus();
              }}
            />
          ) : (
            <Kbd className="group-focus-within/search:hidden">/</Kbd>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col" {...handlers}>
      <div
        ref={body}
        id={`${titleId}-body`}
        className="panel-scroll relative min-h-0 flex-1 border-t border-hairline pb-4"
      >
        {!index || !snapshot ? (
          <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : query.trim() ? (
          <section aria-label="Search results" data-section="search">
            <SectionHeader title="Results" count={hits.length} />
            {hits.length === 0 ? (
              <p className="px-4 py-3 text-body-s text-secondary" role="status">
                No input matches ‘{query.trim()}’.
              </p>
            ) : (
              <div className="flex flex-col px-3 pb-2 pt-1" role="status" aria-live="polite" aria-atomic="false">
                <span className="sr-only">{plural(hits.length, 'match', 'matches')}</span>
                {hits.map((h) => {
                  const rowId = `search:${h.spec.key}`;
                  return <FieldRow key={h.spec.key} spec={h.spec} rowId={rowId} expanded={expanded === rowId} suffix={h.groupLabel} />;
                })}
              </div>
            )}
          </section>
        ) : (
          <>
            {snapshot.abnormal.length > 0 && (
              // "Abnormal findings", the patient card's noun for the same set (values outside the normal range,
              // present findings and abnormal categories): the Physiology tab's "outside the normal range" counts
              // measured values only.
              <section aria-label="Abnormal findings" data-section="abnormal">
                <SectionHeader title="Abnormal findings" count={snapshot.abnormal.length} />
                <InputList specs={specs(snapshot.abnormal)} section="abnormal" expanded={expanded} chipsLabel="Present findings" chipsLead="Present" />
              </section>
            )}
            {snapshot.key.length > 0 && (
              <section aria-label={`Most influential for ${target}`} data-section="key">
                <SectionHeader title={`Most influential for ${target}`} count={snapshot.key.length} />
                <InputList specs={specs(snapshot.key)} section="key" expanded={expanded} chipsLabel={`Most influential findings for ${target}`} />
              </section>
            )}
            <section aria-label="All inputs" data-section="all">
              <SectionHeader title="All inputs" count={total} />
              {index.groups.map((g) => (
                <GroupAccordion
                  key={g.id}
                  group={g}
                  open={openGroups.has(g.id)}
                  onToggle={() =>
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    })
                  }
                  expanded={expanded}
                  edited={groupFacts.get(g.id)?.edited ?? 0}
                  imputed={groupFacts.get(g.id)?.imputed ?? 0}
                />
              ))}
            </section>
          </>
        )}
      </div>
      {index && <ChangedTray keys={changed.keys} index={index} expanded={expanded} onHold={changed.hold} />}
      </div>

      <footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-hairline px-4">
        <span className="text-label font-normal text-tertiary" aria-live="polite">
          {edits > 0 ? (
            <>
              <span className="num font-medium text-secondary">{plural(edits, 'change')}</span> · applied instantly
            </>
          ) : (
            'Changes apply instantly'
          )}
        </span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>

      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-accent/70 bg-panel/95 text-center">
          <FileUp aria-hidden className="size-5 stroke-[1.5] text-accent" />
          <span className="text-body-s font-medium text-primary">Drop a patient profile</span>
          <span className="text-label font-normal text-tertiary">JSON: exported profiles or any map of inputs</span>
        </div>
      )}
    </div>
  );
}
