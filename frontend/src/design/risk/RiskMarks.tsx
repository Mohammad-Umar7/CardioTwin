/**
 * Risk marks (DESIGN_SYSTEM §2.2, §5). Rules enforced here:
 *   - risk colour appears only on marks (pip, band rule, track marker, legend) — numbers and band words
 *     are always text/primary;
 *   - colour never stands alone: the % value, band word, 4-segment meter and track position accompany it;
 *   - pending / stale state is achromatic and labelled "updating".
 */
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { formatPercent, formatProbability } from '@/lib/format';
import { RISK_BAND_STYLES, RISK_PENDING, SHAP_LOWERS, SHAP_RAISES, riskGradientCss, riskHex, type RiskBandId } from '@/theme/risk';
import type { TargetId } from '@/types/contracts';

// ------------------------------------------------------------------------------------ RiskPip

export interface RiskPipProps {
  /** Probability; null = pending (achromatic). */
  p?: number | null;
  /** Use the band chip colour instead of the exact ramp colour. */
  band?: RiskBandId | null;
  size?: number;
  className?: string;
  /** Plays one 240 ms ring (band change / ignition). Change the key to replay. */
  ring?: boolean;
}

export function RiskPip({ p, band, size = 8, className, ring }: RiskPipProps) {
  const color =
    band != null ? RISK_BAND_STYLES[band].chip : p === null || p === undefined ? RISK_PENDING : riskHex(p);
  const style: CSSProperties = { width: size, height: size, backgroundColor: color };
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0 rounded-full ring-1 ring-line-strong', className)} style={style}>
      {ring && (
        <span className="absolute inset-0 animate-pip-ring rounded-full" style={{ boxShadow: `0 0 0 1.5px ${color}` }} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------- RiskMeter

/** 4-segment meter ▮▮▮▯ (filled text/secondary, empty border/default). */
export function RiskMeter({ level, className }: { level: 0 | 1 | 2 | 3 | 4; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex items-center gap-[2px]', className)}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-2.5 w-1.5 rounded-xs', i <= level ? 'bg-secondary' : 'bg-line')} />
      ))}
    </span>
  );
}

// ----------------------------------------------------------------------------------- BandChip

export interface BandChipProps {
  band: RiskBandId | null;
  /** Pending: achromatic rule, "updating" word. */
  pending?: boolean;
  size?: 'sm' | 'md';
  showMeter?: boolean;
  className?: string;
}

/** h 20, surface/1, 2 px left rule in band colour, band word as overline in text/primary, meter. */
export function BandChip({ band, pending, size = 'md', showMeter = true, className }: BandChipProps) {
  const style = band ? RISK_BAND_STYLES[band] : null;
  const rule = pending || !style ? RISK_PENDING : style.chip;
  const word = pending ? 'Updating' : (style?.label ?? 'Unavailable');
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border-l-2 bg-surface-1 pl-1.5 pr-2',
        size === 'sm' && 'h-[18px] gap-1 pr-1.5',
        className,
      )}
      style={{ borderLeftColor: rule }}
    >
      {showMeter && <RiskMeter level={pending || !style ? 0 : style.level} />}
      <span className={cn('eyebrow whitespace-nowrap', pending ? 'text-tertiary' : 'text-primary')}>{word}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------- Probability

export interface ProbabilityProps {
  p: number | null | undefined;
  /**
   * The target this probability belongs to. Renders `data-prob="<target>"` (the one-home-per-number
   * contract, WORKSTATION_V2 §1.4 / §10.3 probe 2): at most one visible element per target may carry it.
   * Every V2 caller passes it.
   */
  target?: TargetId;
  /**
   * A different quantity from the current estimate (the recorded baseline in "was 98 %"): renders
   * `data-baseline="<target>"` instead of `data-prob`, so the duplicate probe does not count it.
   */
  baseline?: boolean;
  /** Visual size token. */
  size?: 'xl' | 'l' | 'label' | 'm';
  stale?: boolean;
  className?: string;
}

const SIZE_CLASS = {
  xl: 'font-numeral text-numeral-xl-compact min-[1440px]:text-numeral-xl',
  l: 'font-numeral text-numeral-l',
  label: 'font-numeral text-numeral-label',
  m: 'num text-numeral-m',
} as const;

/** "72 %": integer + thin space + % at 0.6 em in text/secondary. Exact p in the title tooltip. */
export function Probability({ p, target, baseline = false, size = 'l', stale, className }: ProbabilityProps) {
  const f = formatProbability(p);
  return (
    <span
      className={cn('whitespace-nowrap text-primary transition-opacity duration-fast', SIZE_CLASS[size], stale && 'opacity-50', className)}
      title={f.exact}
      data-prob={target !== undefined && !baseline ? target : undefined}
      data-baseline={target !== undefined && baseline ? target : undefined}
    >
      <span className="sr-only">{f.spoken}</span>
      <span aria-hidden>
        {/* "≥95 %": the bound sign is set like the % sign (0.6 em, text/secondary), so the digits stay the answer. */}
        {f.qualifier && <span className="pct-sign pct-qual">{f.qualifier}</span>}
        {f.value}
        {f.value !== '–' && <span className="pct-sign">%</span>}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------- RiskTrack

export interface RiskTrackProps {
  p: number | null | undefined;
  /** Decision threshold (2 px text/primary tick labelled "thr 46 %"). */
  threshold?: number | null;
  /** Hollow accent ghost marker (pinned baseline / previous value). */
  ghost?: number | null;
  showThresholdLabel?: boolean;
  showScale?: boolean;
  pending?: boolean;
  className?: string;
  /** Height of the track row; the marker is 10 px. */
  compact?: boolean;
}

/**
 * RiskTrack: 2 px border/default track 0–100, 1 px band ticks at 25/50/75, threshold tick, 10 px value
 * marker in riskHex(p) with a 1 px bg ring; the marker glides with the `data` motion token.
 */
export function RiskTrack({
  p,
  threshold,
  ghost,
  showThresholdLabel = false,
  showScale = false,
  pending,
  className,
  compact,
}: RiskTrackProps) {
  const has = typeof p === 'number' && Number.isFinite(p);
  const x = has ? Math.min(1, Math.max(0, p as number)) * 100 : 0;
  const color = pending || !has ? RISK_PENDING : riskHex(p as number);
  return (
    <div className={cn('relative w-full', className)}>
      <div className={cn('relative', compact ? 'h-3' : 'h-4')}>
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
        {[25, 50, 75].map((t) => (
          <div key={t} aria-hidden className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${t}%` }} />
        ))}
        {typeof threshold === 'number' && (
          <div
            aria-hidden
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${threshold * 100}%` }}
          />
        )}
        {typeof ghost === 'number' && Number.isFinite(ghost) && (
          <div
            aria-hidden
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-transparent"
            style={{ left: `${Math.min(1, Math.max(0, ghost)) * 100}%` }}
          />
        )}
        {has && (
          <div
            aria-hidden
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-app transition-[left,background-color] duration-data ease-data"
            style={{ left: `${x}%`, backgroundColor: color }}
          />
        )}
      </div>
      {(showScale || showThresholdLabel) && (
        <div className="num relative mt-0.5 h-4 text-label font-normal text-tertiary">
          {showScale && (
            <>
              <span className="absolute left-0">0</span>
              <span className="absolute right-0">100</span>
            </>
          )}
          {showThresholdLabel && typeof threshold === 'number' && (
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-secondary"
              style={{ left: `${Math.min(92, Math.max(8, threshold * 100))}%` }}
            >
              thr {formatPercent(threshold)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- RiskLegend

export interface RiskLegendProps {
  /** Threshold tick of the selected target. */
  threshold?: number | null;
  width?: number;
  caption?: string;
  className?: string;
}

/** Legend: Ember ramp 160×8 with band ticks and labels 0 · 25 · 50 · 75 · 100 %. */
export function RiskLegend({ threshold, width = 160, caption = 'P(stenosis)', className }: RiskLegendProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} role="img" aria-label={`Risk colour scale from 0 to 100 percent${caption ? `, ${caption}` : ''}`}>
      <span className="eyebrow text-tertiary">Risk</span>
      <div style={{ width }}>
        <div className="relative h-2 rounded-xs" style={{ backgroundImage: riskGradientCss() }}>
          {[25, 50, 75].map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-void/70" style={{ left: `${t}%` }} />
          ))}
          {typeof threshold === 'number' && (
            <span
              className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary"
              style={{ left: `${threshold * 100}%` }}
              title={`Decision threshold ${formatPercent(threshold)}`}
            />
          )}
        </div>
        <div className="num mt-0.5 flex justify-between text-label font-normal text-tertiary">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100&thinsp;%</span>
        </div>
      </div>
      {caption && <span className="text-label font-normal text-tertiary">{caption}</span>}
    </div>
  );
}

// ------------------------------------------------------------------------------- DirectionMark

export interface DirectionMarkProps {
  /** Which way the input pushes the estimate; null keeps the 8 px slot empty (negligible effect). */
  direction: 'raises' | 'lowers' | null;
  className?: string;
}

/**
 * The ▶ / ◀ contribution mark (SHAP raises / lowers colours, never the Ember ramp) as an 8 px vector
 * triangle, so it is a mark and not 10 px text (V2 §5: 11 px only for overline, Kbd and credits). Always
 * decorative: the row's text or aria-label carries the direction in words.
 */
export function DirectionMark({ direction, className }: DirectionMarkProps) {
  if (!direction) return <span aria-hidden className={cn('inline-block size-2 shrink-0', className)} />;
  const up = direction === 'raises';
  return (
    <svg aria-hidden viewBox="0 0 8 8" className={cn('size-2 shrink-0', className)}>
      <path d={up ? 'M1 0.5 L7.5 4 L1 7.5 Z' : 'M7 0.5 L0.5 4 L7 7.5 Z'} fill={up ? SHAP_RAISES : SHAP_LOWERS} />
    </svg>
  );
}
