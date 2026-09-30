import { motion } from 'framer-motion';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton, SegmentedControl, Tooltip } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { decimalsForStep, formatNormalRange, formatNumber, optionDisplay, spokenNormalRange } from '@/lib/format';
import { useUiStore } from '@/state/uiStore';
import type { FeatureSpec, FeatureValue } from '@/types/contracts';
import { useChangeTick, useCurrentTarget } from './hooks';
import { IceStrip } from './IceStrip';
import { useIceStrip } from './useIceStrip';
import { useInputInteraction } from './lib/interaction';
import { cardLabel, displayParts, displayValue, inRange, isPresent, numericValue, optionShort, rangeGlyph, snapNumeric } from './lib/values';
import { useField } from './useField';

/**
 * Inputs drawer rows, V2 (WORKSTATION_V2 §5.6).
 *
 *   NumericRow      32 px at rest (28 at 1280): label · value field · unit · ▲/▼ (+ "was 58" when edited).
 *                   Expands to 60 px while focused: ICE strip over a 4 px track with the normal band and
 *                   the recorded ghost tick, ± step buttons, "ref 52–72 %" and a per-field ↺.
 *   CategoricalRow  label · segmented control (h 24) · ↺ when edited.
 *   BinaryRow       label · No | Yes · "was Yes" · ↺ (used in "Changed" and in search results; everywhere
 *                   else findings render as FindingChips).
 *
 * Every row carries `data-row-id` (for expand-on-focus, see `useRowExpansion`) and `data-feature`.
 */

export interface RowProps {
  spec: FeatureSpec;
  /** Unique within the drawer: the same input can show in a section and in "All inputs". */
  rowId: string;
  /** Group name suffix (search results). */
  suffix?: ReactNode;
  className?: string;
}

const ROW = 'h-8 max-[1439.98px]:h-7';

/** 1.2 s accent rule where an edited row sits (V2 §5.6 motion). */
function EditFlash({ value }: { value: FeatureValue | undefined }) {
  const tick = useChangeTick(value);
  const reduced = useIsReducedMotion();
  if (tick === 0) return null;
  return (
    <motion.span
      key={tick}
      aria-hidden
      className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 1.2, ease: 'easeIn' }}
    />
  );
}

function rangeCopy(spec: FeatureSpec): string {
  const low = spec.normal?.low ?? null;
  const high = spec.normal?.high ?? null;
  // A single normal value reads "ref 0 regions", never "ref 0–0".
  const ref = low !== null && low === high ? `ref ${formatNumber(low, spec.step)}` : formatNormalRange(spec.normal, spec.step);
  if (!ref) return '';
  const unit = displayParts(spec, spec.normal?.low ?? spec.normal?.high ?? 0).unit;
  return unit ? `${ref}${unit === '%' ? ' %' : ` ${unit}`}` : ref;
}

export function RowLabel({
  spec,
  htmlFor,
  labelId,
  edited,
  imputed,
  suffix,
}: {
  spec: FeatureSpec;
  htmlFor?: string;
  labelId?: string;
  edited: boolean;
  imputed: boolean;
  suffix?: ReactNode;
}) {
  const ref = rangeCopy(spec);
  const label = cardLabel(spec);
  const abbreviated = label !== spec.label;
  const tip =
    spec.description || ref || abbreviated ? (
      <span className="flex flex-col gap-1">
        {abbreviated && <span className="font-semibold">{spec.label}</span>}
        {spec.description && <span>{spec.description}</span>}
        {ref && <span className="text-tertiary">Reference {ref.replace(/^ref /, '')}</span>}
      </span>
    ) : null;
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full transition-colors duration-fast', edited ? 'bg-accent' : 'bg-transparent')} />
      {edited && <span className="sr-only">Edited: </span>}
      <Tooltip content={tip} delay={400} placement="top">
        <Tag
          id={labelId}
          htmlFor={htmlFor}
          className={cn(
            'min-w-0 truncate text-body-s text-secondary',
            imputed && 'underline decoration-dashed decoration-tertiary underline-offset-[3px]',
          )}
        >
          {abbreviated ? (
            <>
              <span aria-hidden>{label}</span>
              <span className="sr-only">{spec.label}</span>
            </>
          ) : (
            label
          )}
        </Tag>
      </Tooltip>
      {imputed && (
        <Tooltip content="Not recorded: filled with the cohort median">
          <span
            tabIndex={0}
            className="shrink-0 rounded-xs border border-dashed border-line px-1 text-overline leading-4 text-tertiary outline-none focus-visible:shadow-focus"
          >
            IMP
          </span>
        </Tooltip>
      )}
      {suffix && <span className="shrink-0 truncate text-label font-normal text-tertiary">{suffix}</span>}
    </span>
  );
}

function ResetButton({ spec, recorded, onReset }: { spec: FeatureSpec; recorded: FeatureValue | undefined; onReset(): void }) {
  return (
    <IconButton
      label={`Reset ${spec.label} to the recorded value`}
      tooltip={`Reset to ${displayValue(spec, recorded)}`}
      icon={<RotateCcw />}
      size="xs"
      onClick={(e) => {
        const row = e.currentTarget.closest<HTMLElement>('[data-row-id]');
        onReset();
        // The ↺ disappears with the edit: keep keyboard focus in the row instead of dropping it on <body>.
        requestAnimationFrame(() => {
          const target =
            row?.querySelector<HTMLElement>('input:not([type="range"])') ??
            row?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
            row;
          if (target?.isConnected) target.focus({ preventScroll: true });
        });
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------ numeric

interface TrackProps {
  spec: FeatureSpec;
  value: number;
  recorded: number | null;
  labelledBy: string;
  valueText: string;
  onChange(v: number): void;
  ice: ReactNode;
}

/** Compact 4 px track with the normal band (white 6 %), the recorded ghost tick and a 12 px thumb. */
function CompactTrack({ spec, value, recorded, labelledBy, valueText, onChange, ice }: TrackProps) {
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const step = spec.step ?? 1;
  const setDragging = useInputInteraction((s) => s.setDragging);
  const pct = (v: number) => (max > min ? ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100 : 0);
  const low = spec.normal?.low ?? null;
  const high = spec.normal?.high ?? null;
  const band = low !== null || high !== null ? [pct(low ?? min), pct(high ?? max)] : null;
  const safe = Number.isFinite(value) ? value : min;

  useEffect(() => () => setDragging(false), [setDragging]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      onChange(snapNumeric(spec, safe + (e.key === 'PageUp' ? 10 : -10) * step));
    }
  };

  return (
    <div className="relative h-7 min-w-0 flex-1">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-4">{ice}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safe}
        aria-labelledby={labelledBy}
        aria-valuetext={valueText}
        onChange={(e) => onChange(snapNumeric(spec, Number(e.target.value)))}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        onKeyDown={onKeyDown}
        className="peer absolute inset-x-0 bottom-0 z-10 h-6 w-full cursor-pointer opacity-0"
      />
      <div aria-hidden className="absolute inset-x-0 bottom-[10px] h-1 rounded-full bg-surface-2">
        {band && (
          <div className="absolute inset-y-0 rounded-full bg-white/[0.06]" style={{ left: `${band[0]}%`, width: `${Math.max(0, band[1]! - band[0]!)}%` }} />
        )}
      </div>
      {recorded !== null && (
        <div
          aria-hidden
          className="absolute bottom-[6px] h-3 w-1.5 -translate-x-1/2 rounded-xs border border-secondary"
          style={{ left: `${pct(recorded)}%` }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[6px] size-3 -translate-x-1/2 rounded-full border-2 border-panel bg-accent transition-shadow duration-instant peer-hover:shadow-[0_0_0_4px_rgb(var(--c-accent)/0.15)] peer-focus-visible:shadow-focus"
        style={{ left: `${pct(safe)}%` }}
      />
    </div>
  );
}

export function NumericRow({ spec, rowId, expanded, suffix, className }: RowProps & { expanded: boolean }) {
  const field = useField(spec.key);
  const target = useCurrentTarget();
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const errId = `${inputId}-err`;
  const step = spec.step ?? 1;
  const decimals = decimalsForStep(step);
  const value = numericValue(field.value ?? spec.default ?? undefined);
  const recorded = numericValue(field.recorded);
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? value.toFixed(decimals) : ''));
  const [invalid, setInvalid] = useState<string | null>(null);
  const highlighted = useUiStore((s) => s.highlightedFeature === spec.key);
  const ice = useIceStrip(spec, expanded);
  const expandRef = useRef<HTMLDivElement>(null);
  const open = expanded || invalid !== null;

  useEffect(() => {
    setDraft(Number.isFinite(value) ? value.toFixed(decimals) : '');
    setInvalid(null);
  }, [value, decimals]);

  useEffect(() => {
    if (expandRef.current) expandRef.current.inert = !open;
  }, [open]);

  const commit = (n: number) => {
    setInvalid(null);
    field.set(snapNumeric(spec, n));
  };

  const commitDraft = () => {
    const text = draft.replace('−', '-').replace(',', '.').trim();
    const n = Number(text);
    if (text === '' || !Number.isFinite(n)) {
      setInvalid('Enter a number');
      return;
    }
    if (!inRange(spec, n)) {
      setInvalid(`Allowed ${formatNumber(spec.min ?? 0, step)}–${formatNumber(spec.max ?? 0, step)}`);
      return;
    }
    if (Math.abs(n - value) > 1e-9) commit(n);
    else setInvalid(null);
  };

  const nudge = (steps: number) => commit((Number.isFinite(value) ? value : (spec.min ?? 0)) + steps * step);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      nudge(e.key === 'PageUp' ? 10 : -10);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Escape') {
      const shown = Number.isFinite(value) ? value.toFixed(decimals) : '';
      if (draft !== shown || invalid) {
        // Revert the uncommitted text; the drawer stays open (the Esc chain ignores a handled Esc).
        e.preventDefault();
        setDraft(shown);
        setInvalid(null);
      }
    }
  };

  const { unit } = displayParts(spec, value);
  const glyph = rangeGlyph(spec, value);
  const status = glyph === '▲' ? ', above normal' : glyph === '▼' ? ', below normal' : '';
  const spokenRange = spokenNormalRange(spec.normal);
  const valueText = `${formatNumber(value, step)}${unit ? ` ${unit}` : ''}${status}${spokenRange ? `, ${spokenRange}` : ''}`;
  const ref = rangeCopy(spec);

  return (
    <div
      data-row-id={rowId}
      data-feature={spec.key}
      data-expanded={open || undefined}
      tabIndex={-1}
      onPointerEnter={() => useUiStore.getState().highlightFeature(spec.key)}
      onPointerLeave={() => useUiStore.getState().highlightFeature(null)}
      className={cn(
        'relative rounded-sm outline-none transition-colors duration-fast',
        open ? 'bg-surface-1' : highlighted ? 'bg-surface-1' : 'hover:bg-surface-1/60',
        className,
      )}
    >
      <EditFlash value={field.value} />
      <div className={cn('grid grid-cols-[minmax(0,1fr)_56px_44px_56px] items-center gap-1.5 pl-1 pr-2', ROW)}>
        <RowLabel spec={spec} htmlFor={inputId} labelId={labelId} edited={field.edited} imputed={field.imputed} suffix={suffix} />
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          className={cn(
            'num h-6 w-full rounded-sm border bg-transparent px-1.5 text-right text-numeral-m text-primary outline-none transition-colors duration-instant',
            'hover:border-line hover:bg-surface-1 focus:bg-surface-2',
            invalid ? 'border-danger focus:border-danger' : 'border-transparent focus:border-accent/60',
            field.edited && 'font-semibold',
          )}
        />
        <span className="truncate text-label text-tertiary" title={spec.unit ?? undefined}>
          {unit}
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          {field.edited && Number.isFinite(recorded) && (
            <span className="num truncate text-label font-normal text-tertiary">was {formatNumber(recorded, step)}</span>
          )}
          <span aria-hidden className="w-3 shrink-0 text-center text-label text-secondary">
            {glyph}
          </span>
          {glyph && <span className="sr-only">{glyph === '▲' ? 'above normal' : 'below normal'}</span>}
        </span>
      </div>
      {invalid && (
        <p id={errId} role="alert" className="-mt-1 pb-1 pl-[calc(0.25rem+12px)] text-label font-normal text-danger">
          {invalid}
        </p>
      )}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-base ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div ref={expandRef} className="min-h-0 overflow-clip">
          <div className="flex h-7 items-center gap-1 pb-1 pl-3 pr-1">
            <IconButton label={`Decrease ${spec.label}`} tooltip={false} icon={<Minus />} size="xs" tabIndex={-1} onClick={() => nudge(-1)} />
            <CompactTrack
              spec={spec}
              value={value}
              recorded={field.edited && Number.isFinite(recorded) ? recorded : null}
              labelledBy={labelId}
              valueText={valueText}
              onChange={commit}
              ice={
                ice ? (
                  <IceStrip
                    result={ice}
                    target={target}
                    at={spec.max != null && spec.min != null && spec.max > spec.min ? (value - spec.min) / (spec.max - spec.min) : undefined}
                    className="h-4 w-full animate-rise-in"
                  />
                ) : null
              }
            />
            <IconButton label={`Increase ${spec.label}`} tooltip={false} icon={<Plus />} size="xs" tabIndex={-1} onClick={() => nudge(1)} />
            {ref && <span className="num shrink-0 whitespace-nowrap pl-1 text-label font-normal text-tertiary">{ref}</span>}
            <span className="flex w-6 shrink-0 justify-center">
              {field.edited && <ResetButton spec={spec} recorded={field.recorded} onReset={field.reset} />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------- categorical

export function CategoricalRow({ spec, rowId, suffix, className }: RowProps) {
  const field = useField(spec.key);
  const labelId = useId();
  const options = spec.options ?? [];
  const current = String(field.value ?? spec.default ?? '');
  const normalised = current.toLowerCase() === 'fmale' ? 'Female' : current;
  const value = options.find((o) => String(o.value).toLowerCase() === normalised.toLowerCase())?.value ?? normalised;
  const highlighted = useUiStore((s) => s.highlightedFeature === spec.key);

  return (
    <div
      data-row-id={rowId}
      data-feature={spec.key}
      tabIndex={-1}
      onPointerEnter={() => useUiStore.getState().highlightFeature(spec.key)}
      onPointerLeave={() => useUiStore.getState().highlightFeature(null)}
      className={cn(
        'relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-sm pl-1 pr-1 outline-none transition-colors duration-fast',
        ROW,
        highlighted ? 'bg-surface-1' : 'hover:bg-surface-1/60',
        className,
      )}
    >
      <EditFlash value={field.value} />
      <RowLabel spec={spec} labelId={labelId} edited={field.edited} imputed={field.imputed} suffix={suffix} />
      {options.length <= 5 ? (
        <SegmentedControl
          label={spec.label}
          size="xs"
          value={String(value)}
          onChange={(v) => field.set(v)}
          options={options.map((o) => {
            const d = optionDisplay(spec, o.value);
            const short = options.length > 3 ? optionShort(d.short) : d.short;
            return { value: String(o.value), label: short, title: d.full !== short ? d.full : undefined };
          })}
        />
      ) : (
        <select
          aria-labelledby={labelId}
          value={String(value)}
          onChange={(e) => field.set(e.target.value)}
          className="h-6 rounded-sm border border-line bg-surface-1 px-1.5 text-label text-primary outline-none focus:border-accent/60"
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {/* ↺ only while edited: a reserved column would truncate "Valvular heart disease" at 1280. */}
      {field.edited ? <ResetButton spec={spec} recorded={field.recorded} onReset={field.reset} /> : <span />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- binary

export function BinaryRow({ spec, rowId, suffix, className }: RowProps) {
  const field = useField(spec.key);
  const labelId = useId();
  const on = isPresent(field.value);
  const highlighted = useUiStore((s) => s.highlightedFeature === spec.key);
  return (
    <div
      data-row-id={rowId}
      data-feature={spec.key}
      tabIndex={-1}
      onPointerEnter={() => useUiStore.getState().highlightFeature(spec.key)}
      onPointerLeave={() => useUiStore.getState().highlightFeature(null)}
      className={cn(
        'relative grid grid-cols-[minmax(0,1fr)_auto_auto_24px] items-center gap-1.5 rounded-sm pl-1 pr-1 outline-none transition-colors duration-fast',
        ROW,
        highlighted ? 'bg-surface-1' : 'hover:bg-surface-1/60',
        className,
      )}
    >
      <EditFlash value={field.value} />
      <RowLabel spec={spec} labelId={labelId} edited={field.edited} imputed={field.imputed} suffix={suffix} />
      <SegmentedControl
        label={spec.label}
        size="xs"
        value={on ? 1 : 0}
        onChange={(v) => field.set(v)}
        options={[
          { value: 0, label: 'No' },
          { value: 1, label: 'Yes' },
        ]}
      />
      <span className="w-12 truncate text-right text-label font-normal text-tertiary">
        {field.edited ? `was ${isPresent(field.recorded) ? 'Yes' : 'No'}` : ''}
      </span>
      <span className="flex justify-center">{field.edited && <ResetButton spec={spec} recorded={field.recorded} onReset={field.reset} />}</span>
    </div>
  );
}

/** Row for any non-binary input (binary inputs render as chips or `BinaryRow`). */
export function FieldRow(props: RowProps & { expanded?: boolean }) {
  const { spec } = props;
  if (spec.type === 'binary') return <BinaryRow {...props} />;
  if (spec.type === 'categorical') return <CategoricalRow {...props} />;
  return <NumericRow {...props} expanded={props.expanded ?? false} />;
}
