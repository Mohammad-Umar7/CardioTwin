import { Check, ChevronDown, Lock, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Skeleton } from '@/design';
import { useCohort } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { compactSummary, splitLabel } from '@/lib/patients';
import { usePatientStore } from '@/state/patientStore';
import type { CohortPatient } from '@/types/contracts';

const VESSELS = ['LAD', 'LCX', 'RCA'] as const;

/** Ground-truth chips. Hidden for held-out TEST patients so "Reveal cath result" stays a real reveal. */
function TruthChips({ patient }: { patient: CohortPatient }) {
  if (patient.split === 'test') {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-tertiary" title="Catheter result hidden until revealed">
        <Lock aria-hidden className="size-3" /> cath hidden
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-tertiary" aria-label="Catheterisation result">
      {VESSELS.map((v) => (
        <span key={v} className="inline-flex items-center gap-0.5">
          <span aria-hidden>{patient.labels[v] === 1 ? '●' : '○'}</span>
          {v}
        </span>
      ))}
    </span>
  );
}

/**
 * PatientPicker combobox (DESIGN_SYSTEM §5): type to filter by ID or summary, arrow keys to move,
 * Enter to open a patient. Grouped "Held-out TEST" / "Dev"; the default patient is a TEST patient.
 */
export function PatientPicker({ className }: { className?: string }) {
  const cohort = useCohort();
  const selectedId = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  const loadPatient = usePatientStore((s) => s.loadPatient);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const patients = useMemo(() => cohort.data?.patients ?? [], [cohort.data]);
  const selected = patients.find((p) => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: CohortPatient) => !q || p.id.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q);
    const test = patients.filter((p) => p.split === 'test' && match(p));
    const dev = patients.filter((p) => p.split !== 'test' && match(p));
    return { test, dev, flat: [...test, ...dev] };
  }, [patients, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, filtered.flat.findIndex((p) => p.id === selectedId));
    setActive(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const choose = (p: CohortPatient) => {
    loadPatient(p);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = filtered.flat.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => (n ? (a + 1) % n : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (n ? (a - 1 + n) % n : 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const p = filtered.flat[active];
      if (p) choose(p);
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  if (cohort.status === 'loading') return <Skeleton className="h-md" label="Loading patients" />;
  if (cohort.status !== 'ready') {
    return (
      <p className="rounded-sm border border-dashed border-line px-3 py-2 text-label font-normal text-tertiary">
        Demo cohort not available yet — using a custom patient.
      </p>
    );
  }

  const renderGroup = (label: string, list: CohortPatient[], offset: number) =>
    list.length > 0 && (
      <li role="presentation">
        <div className="sticky top-0 z-10 bg-surface-3 px-3 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-tertiary">
          {label} · {list.length}
        </div>
        <ul role="group" aria-label={label}>
          {list.map((p, i) => {
            const index = offset + i;
            const isSelected = p.id === selectedId && mode === 'cohort';
            return (
              <li
                key={p.id}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-3 px-3',
                  index === active ? 'bg-surface-2' : 'bg-transparent',
                )}
              >
                <span className="mono w-12 shrink-0 text-mono-s text-primary">{p.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-normal text-secondary">{p.summary}</span>
                  <TruthChips patient={p} />
                </span>
                {isSelected && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
              </li>
            );
          })}
        </ul>
      </li>
    );

  return (
    <div ref={rootRef} className={cn('relative', className)} data-tour="patient-picker">
      <div
        className={cn(
          'flex h-md items-center gap-2 rounded-sm border bg-surface-1 px-2 transition-colors duration-fast',
          open ? 'border-accent/60' : 'border-line hover:border-line-strong',
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search aria-hidden className="size-4 shrink-0 stroke-[1.5] text-tertiary" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Patient"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-opt-${active}` : undefined}
          value={open ? query : ''}
          placeholder={
            mode === 'custom'
              ? 'Custom patient — pick a cohort patient'
              : selected
                ? `${selected.id} · ${compactSummary(selected.summary)}`
                : 'Choose a patient'
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="mono h-full min-w-0 flex-1 bg-transparent text-mono-s text-primary outline-none placeholder:font-ui placeholder:text-body-s placeholder:text-primary"
        />
        {selected && mode === 'cohort' && (
          <Badge tone={selected.split === 'test' ? 'accent' : 'outline'}>{splitLabel(selected.split)}</Badge>
        )}
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-tertiary transition-transform duration-fast', open && 'rotate-180')} />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Demo patients"
          className="panel-scroll absolute inset-x-0 top-[calc(100%+4px)] z-popover max-h-[360px] rounded-lg bg-surface-3 pb-1 shadow-e3"
        >
          {filtered.flat.length === 0 ? (
            <li className="px-3 py-3 text-body-s text-tertiary">No patient matches “{query}”.</li>
          ) : (
            <>
              {renderGroup('Held-out TEST', filtered.test, 0)}
              {renderGroup('Dev', filtered.dev, filtered.test.length)}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
