import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { IconButton, SegmentedControl, Slider, Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import {
  decimalsForStep,
  formatNormalRange,
  formatNumber,
  formatUnit,
  optionDisplay,
  rangeStatus,
  spokenNormalRange,
  THIN_SPACE,
} from '@/lib/format';
import { useUiStore } from '@/state/uiStore';
import type { FeatureSpec } from '@/types/contracts';
import { useField } from './useField';

function FieldLabel({ spec, edited, imputed, htmlFor, extra }: { spec: FeatureSpec; edited: boolean; imputed: boolean; htmlFor?: string; extra?: ReactNode }) {
  const label = (
    <label htmlFor={htmlFor} className={cn('truncate text-label text-secondary', imputed && 'underline decoration-dashed underline-offset-2')}>
      {spec.label}
    </label>
  );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {edited && <span aria-label="edited" className="size-1.5 shrink-0 rounded-full bg-accent" />}
      {spec.description ? (
        <Tooltip content={<span><span className="mono text-tertiary">{spec.key}</span> · {spec.description}</span>}>
          <span tabIndex={-1} className="min-w-0 truncate">
            {label}
          </span>
        </Tooltip>
      ) : (
        label
      )}
      {imputed && (
        <Tooltip content={`Not recorded — filled with the cohort default (${String(spec.default ?? '–')}).`}>
          <span tabIndex={0} className="rounded-xs border border-dashed border-line px-1 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-tertiary">
            IMP
          </span>
        </Tooltip>
      )}
      {extra}
    </span>
  );
}

function ResetButton({ onReset, label }: { onReset(): void; label: string }) {
  return <IconButton label={`Reset ${label} to recorded value`} icon={<RotateCcw />} size="xs" onClick={onReset} />;
}

// ----------------------------------------------------------------------------- numeric

/**
 * NumericFeatureRow (DESIGN_SYSTEM §5): label, editable value + unit, ▲/▼ + words when outside the
 * reference range (never red), slider with the normal band and a ghost tick at the recorded value.
 * The ICE strip slot above the track is filled in phase 2.
 */
export function NumericFeatureRow({ spec, ice, hint }: { spec: FeatureSpec; ice?: ReactNode; hint?: ReactNode }) {
  const field = useField(spec.key);
  const inputId = useId();
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const step = spec.step ?? 1;
  const decimals = decimalsForStep(step);
  const numeric = typeof field.value === 'number' ? field.value : Number(field.value ?? spec.default ?? min);
  const [draft, setDraft] = useState(() => (Number.isFinite(numeric) ? numeric.toFixed(decimals) : ''));
  const [invalid, setInvalid] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Number.isFinite(numeric) ? numeric.toFixed(decimals) : '');
    setInvalid(null);
  }, [numeric, decimals]);

  const status = rangeStatus(numeric, spec.normal);
  const unit = formatUnit(spec.unit);
  const valueText = `${spec.label} ${formatNumber(numeric, step)}${unit ? ` ${spec.unit}` : ''}${
    status === 'above' ? ', above normal' : status === 'below' ? ', below normal' : ''
  }${spokenNormalRange(spec.normal) ? `, ${spokenNormalRange(spec.normal)}` : ''}`;

  const commitDraft = () => {
    const n = Number(draft.replace('−', '-'));
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setInvalid('Enter a number');
      return;
    }
    if (n < min || n > max) {
      setInvalid(`Allowed ${formatNumber(min, step)}–${formatNumber(max, step)}`);
      return;
    }
    setInvalid(null);
    const snapped = Math.round(n / step) * step;
    field.set(Number(snapped.toFixed(Math.max(decimals, 0))));
  };

  const nudge = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, numeric + dir * step));
    field.set(Number(next.toFixed(decimals)));
  };

  return (
    <div className="group/row flex flex-col gap-0.5 px-4 py-1.5" data-feature={spec.key}>
      <div className="flex h-6 items-center gap-2">
        <FieldLabel spec={spec} edited={field.edited} imputed={field.imputed} htmlFor={inputId} extra={hint} />
        <span className="ml-auto flex items-center gap-1">
          {status && status !== 'within' && (
            <span className="whitespace-nowrap text-[0.6875rem] text-secondary">
              {status === 'above' ? '▲ above normal' : '▼ below normal'}
            </span>
          )}
          <span className="hidden items-center group-focus-within/row:flex">
            <IconButton label={`Decrease ${spec.label}`} icon={<Minus />} size="xs" tooltip={false} onClick={() => nudge(-1)} />
            <IconButton label={`Increase ${spec.label}`} icon={<Plus />} size="xs" tooltip={false} onClick={() => nudge(1)} />
          </span>
          <input
            id={inputId}
            inputMode="decimal"
            value={draft}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? `${inputId}-err` : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              if (e.key === 'Escape') setDraft(numeric.toFixed(decimals));
            }}
            className={cn(
              'num h-6 w-16 rounded-sm border bg-surface-1 px-1.5 text-right text-numeral-m text-primary outline-none transition-colors',
              invalid ? 'border-danger' : 'border-line focus:border-accent/60',
            )}
          />
          <span className="w-12 truncate text-label font-normal text-tertiary" title={spec.unit ?? undefined}>
            {unit}
          </span>
          {field.edited && <ResetButton onReset={field.reset} label={spec.label} />}
        </span>
      </div>
      <Slider
        label={spec.label}
        value={numeric}
        min={min}
        max={max}
        step={step}
        normal={spec.normal}
        ghost={field.edited && typeof field.recorded === 'number' ? field.recorded : null}
        valueText={valueText}
        formatBubble={(v) => `${formatNumber(v, step)}${unit ? `${THIN_SPACE}${unit}` : ''}`}
        onChange={(v) => field.set(Number(v.toFixed(decimals)))}
        above={ice}
      />
      <div className="flex h-4 items-center justify-between text-[0.6875rem] leading-4 text-tertiary">
        {invalid ? (
          <span id={`${inputId}-err`} role="alert" className="text-danger">
            {invalid}
          </span>
        ) : (
          <span>{formatNormalRange(spec.normal, step)}</span>
        )}
        {field.edited && typeof field.recorded === 'number' && <span>recorded {formatNumber(field.recorded, step)}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ binary

/** BinaryToggle (DESIGN_SYSTEM §5): segmented No | Yes. The counterfactual caption arrives in phase 2. */
export function BinaryToggle({ spec, caption }: { spec: FeatureSpec; caption?: ReactNode }) {
  const field = useField(spec.key);
  const on = field.value === 1 || field.value === '1';
  return (
    <div className="flex flex-col gap-0.5 px-4 py-1" data-feature={spec.key}>
      <div className="flex min-h-7 items-center gap-2">
        <FieldLabel spec={spec} edited={field.edited} imputed={field.imputed} />
        <span className="ml-auto flex items-center gap-1">
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
          {field.edited ? <ResetButton onReset={field.reset} label={spec.label} /> : <span className="w-6" />}
        </span>
      </div>
      {caption && <div className="text-right text-label font-normal text-tertiary">{caption}</div>}
    </div>
  );
}

// ------------------------------------------------------------------------- categorical

/** CategoricalSegment: segmented control up to 5 options (full term in each tooltip), a select above that. */
export function CategoricalSegment({ spec }: { spec: FeatureSpec }) {
  const field = useField(spec.key);
  const options = spec.options ?? [];
  const current = String(field.value ?? spec.default ?? '');
  const normalised = current.toLowerCase() === 'fmale' ? 'Female' : current;

  return (
    <div className="flex flex-col gap-0.5 px-4 py-1" data-feature={spec.key}>
      <div className="flex min-h-7 items-center gap-2">
        <FieldLabel spec={spec} edited={field.edited} imputed={field.imputed} />
        <span className="ml-auto flex items-center gap-1">
          {options.length <= 5 ? (
            <SegmentedControl
              label={spec.label}
              size="xs"
              value={normalised}
              onChange={(v) => field.set(v)}
              options={options.map((o) => ({
                value: String(o.value),
                label: optionDisplay(spec, o.value).short,
                title: optionDisplay(spec, o.value).full !== optionDisplay(spec, o.value).short ? o.label : undefined,
              }))}
            />
          ) : (
            <select
              aria-label={spec.label}
              value={normalised}
              onChange={(e) => field.set(e.target.value)}
              className="h-xs rounded-sm border border-line bg-surface-1 px-1.5 text-label text-primary outline-none focus:border-accent/60"
            >
              {options.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {field.edited ? <ResetButton onReset={field.reset} label={spec.label} /> : <span className="w-6" />}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders the right control for a feature spec. The row lights up (surface/2) while the same feature is
 * hovered in the narrative, the SHAP waterfall or the physiology table.
 */
export function FeatureField({ spec }: { spec: FeatureSpec }) {
  const highlighted = useUiStore((s) => s.highlightedFeature === spec.key);
  const hint =
    spec.key === 'PR' ? (
      <span className="whitespace-nowrap text-[0.6875rem] text-tertiary" title="The 3D heart beats at this rate">
        ♥ sets beat
      </span>
    ) : undefined;
  return (
    <div className={cn('transition-colors duration-fast', highlighted && 'bg-surface-2')}>
      {spec.type === 'binary' ? (
        <BinaryToggle spec={spec} />
      ) : spec.type === 'categorical' ? (
        <CategoricalSegment spec={spec} />
      ) : (
        <NumericFeatureRow spec={spec} hint={hint} />
      )}
    </div>
  );
}
