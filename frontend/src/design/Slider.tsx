import { useCallback, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  /** Fired on pointer release / keyboard commit (spec: ripple and server check run on commit). */
  onCommit?(value: number): void;
  /** Clinical reference range, drawn as a white 6 % band on the track. */
  normal?: { low: number | null; high: number | null } | null;
  /** Recorded value, drawn as a hollow ghost tick when the value was edited or a baseline is pinned. */
  ghost?: number | null;
  /** Accessible name (the visible label's text). */
  label: string;
  /** Spoken value, e.g. "Ejection fraction 45 percent, below normal range 50 to 70". */
  valueText?: string;
  /** Text shown in the bubble while dragging. */
  formatBubble?(value: number): string;
  disabled?: boolean;
  /** Slot rendered 16 px above the track (the ICE strip, phase 2). */
  above?: ReactNode;
  className?: string;
  id?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct = (v: number, min: number, max: number) => (max > min ? ((v - min) / (max - min)) * 100 : 0);

/**
 * Slider (DESIGN_SYSTEM §5 NumericFeatureRow track): 4 px surface/2 track, reference band at white 6 %,
 * 14 px accent thumb in a 24 px hit area, value bubble while dragging, hollow ghost tick for the
 * recorded value. A native range input underneath provides keyboard, touch and screen-reader support;
 * PageUp / PageDown move ×10 steps.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  normal,
  ghost,
  label,
  valueText,
  formatBubble,
  disabled,
  above,
  className,
  id,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [dragging, setDragging] = useState(false);
  const safe = clamp(Number.isFinite(value) ? value : min, min, max);
  const position = pct(safe, min, max);

  const bandLow = normal?.low ?? null;
  const bandHigh = normal?.high ?? null;
  const hasBand = bandLow !== null || bandHigh !== null;
  const bandStart = pct(clamp(bandLow ?? min, min, max), min, max);
  const bandEnd = pct(clamp(bandHigh ?? max, min, max), min, max);
  const ghostPos = ghost !== null && ghost !== undefined && Number.isFinite(ghost) ? pct(clamp(ghost, min, max), min, max) : null;

  const commit = useCallback((v: number) => onCommit?.(v), [onCommit]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const next = clamp(safe + (e.key === 'PageUp' ? 10 : -10) * step, min, max);
      onChange(next);
      commit(next);
    }
  };

  return (
    <div className={cn('relative w-full', className)}>
      {above && <div className="mb-1 h-4">{above}</div>}
      <div className="relative h-6">
        <input
          id={inputId}
          type="range"
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          min={min}
          max={max}
          step={step}
          value={safe}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={(e) => {
            setDragging(false);
            commit(Number((e.target as HTMLInputElement).value));
          }}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') commit(Number(e.currentTarget.value));
          }}
          onBlur={() => setDragging(false)}
        />
        {/* track */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2">
          {hasBand && (
            <div
              aria-hidden
              className="absolute inset-y-0 rounded-full bg-white/[0.06]"
              style={{ left: `${bandStart}%`, width: `${Math.max(0, bandEnd - bandStart)}%` }}
            />
          )}
          <div
            aria-hidden
            className={cn('absolute inset-y-0 left-0 rounded-full', disabled ? 'bg-disabled/40' : 'bg-accent/35')}
            style={{ width: `${position}%` }}
          />
        </div>
        {ghostPos !== null && (
          <div
            aria-hidden
            title="Recorded value"
            className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-xs border border-secondary bg-transparent"
            style={{ left: `${ghostPos}%` }}
          />
        )}
        {/* thumb (visual) */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-app transition-[width,height] duration-instant',
            'peer-hover:size-4 peer-focus-visible:shadow-focus',
            disabled ? 'bg-disabled' : 'bg-accent',
            dragging && 'size-4',
          )}
          style={{ left: `${position}%` }}
        />
        {dragging && formatBubble && (
          <div
            aria-hidden
            className="num pointer-events-none absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface-3 px-1.5 py-0.5 text-label text-primary shadow-e2"
            style={{ left: `${position}%` }}
          >
            {formatBubble(safe)}
          </div>
        )}
      </div>
    </div>
  );
}
