import { Check, FileUp, Search, Shuffle, UserPlus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RiskPip, Skeleton } from '@/design';
import { useCohort } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import type { CohortPatient } from '@/types/contracts';
import { CURATED_CASES } from './curated';
import { compactIdentity, describeFeatures, identityOf } from './lib/describe';
import { openPatient, openRandomTestPatient, pickProfileFile, startBlankPatient } from './profileActions';
import { useCohortPredictions } from './useCohortPredictions';

/**
 * PatientSwitcher — WORKSTATION_V2 §5.2: the content of the popover opened from the top-bar PatientChip
 * (agent A owns the chip and the popover shell: 420 wide, surface/3, e-3, 12 px padding, which this
 * content spans edge to edge).
 *
 *   search       autofocused; ID, sex, age and a feature-based summary
 *   Curated      6 held-out TEST patients chosen for feature diversity (curated.ts), ≥ 44 px: the vignette
 *                wraps to two lines instead of truncating
 *   Held-out test · 61 / Development · 20, h 36
 *   footer       New blank patient · Random test patient · Import…
 *
 * Every line is built from model INPUTS (never the catheterisation result). CAD pips + % appear once the
 * in-browser model has scored the cohort; the open patient shows its pip only, so its estimate keeps one
 * home on screen (the Risk card).
 */
export interface PatientSwitcherProps {
  onClose(): void;
  className?: string;
}

interface Entry {
  patient: CohortPatient;
  group: 'curated' | 'test' | 'dev';
  title: string;
  line: string;
  haystack: string;
}

function entriesFor(patients: readonly CohortPatient[]): Entry[] {
  const byId = new Map(patients.map((p) => [p.id, p]));
  const haystack = (p: CohortPatient, extra = '') => {
    const { sex, age } = identityOf(p.features);
    return `${p.id} ${sex ?? ''} ${age ?? ''} ${describeFeatures(p.features, 4)} ${p.summary} ${extra}`.toLowerCase();
  };
  const curated = CURATED_CASES.map((c): Entry | null => {
    const p = byId.get(c.id);
    return p ? { patient: p, group: 'curated', title: c.note, line: describeFeatures(p.features), haystack: haystack(p, c.note) } : null;
  }).filter((e): e is Entry => e !== null);
  const rest = (split: 'test' | 'dev') =>
    patients
      .filter((p) => (split === 'test' ? p.split === 'test' : p.split !== 'test'))
      .map((p): Entry => ({ patient: p, group: split, title: '', line: describeFeatures(p.features), haystack: haystack(p) }));
  return [...curated, ...rest('test'), ...rest('dev')];
}

const GROUP_LABEL: Record<Entry['group'], string> = {
  curated: 'Curated cases',
  test: 'Held-out test',
  dev: 'Development',
};

function Pip({ p, current }: { p: number | undefined; current: boolean }) {
  if (p === undefined || !Number.isFinite(p)) return <span className="w-14" aria-hidden />;
  const f = formatProbability(p);
  return (
    <span className="flex w-14 shrink-0 items-center justify-end gap-1.5" title={current ? undefined : 'Model estimate of CAD for the recorded inputs'}>
      <RiskPip p={p} />
      {current ? (
        <span className="sr-only">CAD estimate shown in the risk card</span>
      ) : (
        <span className="num w-9 text-right text-label font-normal text-secondary">
          <span className="sr-only">CAD </span>
          {f.text}
        </span>
      )}
    </span>
  );
}

function FooterButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-label text-secondary transition-colors duration-instant hover:bg-white/[0.07] hover:text-primary [&>svg]:size-3.5 [&>svg]:stroke-[1.5]"
    >
      {icon}
      {children}
    </button>
  );
}

export function PatientSwitcher({ onClose, className }: PatientSwitcherProps) {
  const cohort = useCohort();
  const navigate = useNavigate();
  const selectedId = usePatientStore((s) => (s.mode === 'cohort' ? s.selectedPatientId : null));
  const predictions = useCohortPredictions();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const all = useMemo(() => entriesFor(cohort.data?.patients ?? []), [cohort.data]);
  const shown = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return all;
    // While searching, each patient appears once (curated rows win).
    const seen = new Set<string>();
    return all.filter((e) => {
      if (seen.has(e.patient.id) || !tokens.every((t) => e.haystack.includes(t))) return false;
      seen.add(e.patient.id);
      return true;
    });
  }, [all, query]);

  // Autofocus the search after the popover has focused itself.
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => setActive(0), [query]);
  // Keep the active row visible by scrolling the list only (never an ancestor, P0-1).
  useEffect(() => {
    const box = list.current;
    const el = document.getElementById(`${listId}-${active}`);
    if (!box || !el) return;
    const header = 28;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top - header < box.scrollTop) box.scrollTop = Math.max(0, top - header);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [active, listId]);

  const choose = (p: CohortPatient) => {
    onClose();
    if (p.id !== selectedId) openPatient(p, navigate);
  };
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = shown.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) setActive((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((i) => (i - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = shown[active];
      if (entry) choose(entry.patient);
    } else if (e.key === 'Home' && !query) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && !query) {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    }
  };

  const counts = useMemo(() => {
    const c = { curated: 0, test: 0, dev: 0 };
    for (const e of shown) c[e.group] += 1;
    return c;
  }, [shown]);

  let index = -1;
  const groups = (['curated', 'test', 'dev'] as const).filter((g) => counts[g] > 0);

  return (
    <div data-region="patient-switcher" className={cn('-m-3 flex max-h-[min(520px,calc(100vh-var(--topbar-h)-var(--status-h)-24px))] flex-col', className)}>
      <div className="shrink-0 border-b border-line p-2">
        <div className="flex h-8 items-center gap-2 rounded-sm bg-surface-2 px-2">
          <Search aria-hidden className="size-4 shrink-0 stroke-[1.5] text-tertiary" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.length ? `${listId}-${Math.min(active, shown.length - 1)}` : undefined}
            aria-label="Find a patient by ID, sex, age or findings"
            placeholder="Find a patient — ID, age, sex, findings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-body-s text-primary outline-none placeholder:text-tertiary [&:focus-visible]:shadow-none"
          />
        </div>
      </div>

      <div ref={list} id={listId} role="listbox" aria-label="Patients" className="panel-scroll min-h-0 flex-1 py-1">
        {cohort.status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : cohort.status !== 'ready' ? (
          <p className="px-3 py-3 text-body-s text-secondary">The demo cohort is not available. Start a blank patient instead.</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-3 text-body-s text-secondary" role="status">
            No patient matches ‘{query.trim()}’.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g} role="group" aria-labelledby={`${listId}-g-${g}`}>
              <div id={`${listId}-g-${g}`} className="eyebrow sticky top-0 z-10 flex h-7 items-center gap-1.5 bg-[rgba(30,37,48,0.96)] px-3 text-tertiary backdrop-blur">
                {GROUP_LABEL[g]}
                {g !== 'curated' && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="num">{counts[g]}</span>
                  </>
                )}
              </div>
              {shown
                .filter((e) => e.group === g)
                .map((e) => {
                  index += 1;
                  const i = index;
                  const isActive = i === Math.min(active, shown.length - 1);
                  const current = e.patient.id === selectedId;
                  const curated = e.group === 'curated';
                  return (
                    <div
                      key={`${g}:${e.patient.id}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={isActive}
                      aria-current={current || undefined}
                      onMouseMove={() => !isActive && setActive(i)}
                      onClick={() => choose(e.patient)}
                      className={cn(
                        'mx-1 flex cursor-pointer items-center gap-3 rounded-sm px-2',
                        curated ? 'min-h-11 py-1.5' : 'h-9',
                        isActive ? 'bg-surface-2' : 'bg-transparent',
                      )}
                    >
                      <span className="mono w-12 shrink-0 text-mono-s text-primary">{e.patient.id}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        {curated ? (
                          <>
                            <span className="line-clamp-2 text-body-s text-primary text-pretty">{e.title}</span>
                            <span className="line-clamp-2 text-label font-normal text-tertiary text-pretty">{e.line}</span>
                          </>
                        ) : (
                          <span className="truncate text-label font-normal text-secondary">
                            <span className="text-primary">{compactIdentity(identityOf(e.patient.features))}</span>
                            {e.line.replace(compactIdentity(identityOf(e.patient.features)), '')}
                          </span>
                        )}
                      </span>
                      {current && <Check aria-label="Open now" className="size-4 shrink-0 stroke-[1.75] text-accent" />}
                      <Pip p={predictions?.get(e.patient.id)} current={current} />
                    </div>
                  );
                })}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line p-1.5">
        <FooterButton icon={<UserPlus />} onClick={act(() => void startBlankPatient(navigate))}>
          New blank patient
        </FooterButton>
        <FooterButton icon={<Shuffle />} onClick={act(() => void openRandomTestPatient(navigate))}>
          Random test patient
        </FooterButton>
        <span className="flex-1" />
        <FooterButton icon={<FileUp />} onClick={act(() => pickProfileFile(navigate))}>
          Import…
        </FooterButton>
      </div>
    </div>
  );
}
