import { useEffect, useId, useRef, useState } from 'react';
import { StageCard } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { useViewerStore } from '@/state/viewerStore';
import { RISK_BAND_STYLES, RISK_PENDING, riskGradientCss, type RiskBandId } from '@/theme/risk';
import { usePresence } from './presence';

/** Hover delay before the legend expands (the tooltip delay, V2 §5.4). */
const OPEN_DELAY_MS = 120;

const BANDS: readonly { id: RiskBandId; range: string }[] = [
  { id: 'low', range: '0–25 %' },
  { id: 'moderate', range: '25–50 %' },
  { id: 'high', range: '50–75 %' },
  { id: 'critical', range: '75–100 %' },
];

/**
 * LegendChip — WORKSTATION_V2 §5.13. Collapsed (bottomLeft slot, 212 × 40; 184 × 36 at 1280): "Low", a
 * 120 × 6 Ember ramp with the current target's decision-threshold tick, "Very high" — no scale numerals.
 * On hover or focus it expands upward into a 280 px card: the band ladder (pip · band · range), the tick
 * sentence, left main "not predicted", the territory and flow notes and "Vessel-level risk · no lesion
 * localisation". The ramp is the only risk colour; text is never risk-coloured.
 */
export interface LegendChipProps {
  className?: string;
}

export function LegendChip({ className }: LegendChipProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const index = useSchemaIndex();
  const reduced = useIsReducedMotion();
  const targetId = selected ?? 'CAD';
  const target = index?.targets.find((t) => t.id === targetId);
  const threshold = target?.threshold ?? null;
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();
  const panelId = useId();
  const { shown, phase } = usePresence<true>(open ? true : null, reduced, 110);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const thr = threshold != null ? formatProbability(threshold) : null;

  return (
    <div
      className="relative"
      onPointerEnter={() => show(false)}
      onPointerLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          hide();
        }
      }}
    >
      {shown && (
        <div
          id={panelId}
          role="note"
          aria-label="Risk colour legend"
          data-region="legend-expanded"
          className={cn(
            'stage-card absolute bottom-[calc(100%+8px)] left-0 w-[280px] p-3 transition-[opacity,transform] motion-reduce:!translate-y-0',
            phase === 'open' ? 'translate-y-0 opacity-100 duration-fast ease-out' : 'translate-y-1 opacity-0',
            phase === 'closed' && 'duration-[110ms] ease-exit',
          )}
        >
          <p className="eyebrow text-tertiary">Probability bands</p>
          <ul className="mt-1.5 flex flex-col">
            {BANDS.map((b) => (
              <li key={b.id} className="flex h-6 items-center gap-2 text-body-s">
                <span aria-hidden className="size-2 rounded-full ring-1 ring-line-strong" style={{ backgroundColor: RISK_BAND_STYLES[b.id].chip }} />
                <span className="flex-1 text-primary">{RISK_BAND_STYLES[b.id].label}</span>
                <span className="num text-label font-normal text-tertiary">{b.range}</span>
              </li>
            ))}
          </ul>
          <div className="my-2 h-px bg-line" />
          <ul className="flex flex-col gap-1.5 text-label font-normal text-secondary">
            {thr && (
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-primary" />
                <span>
                  Tick = decision threshold for {targetId} ({thr.value}
                  <span className="pct-sign">%</span>)
                </span>
              </li>
            )}
            <li className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-line-strong" style={{ backgroundColor: RISK_PENDING }} />
              <span>Left main · not predicted</span>
            </li>
            <li>Territory tint = approximate supplied territory, not a perfusion scan</li>
            <li>Flow is illustrative</li>
            <li className="text-tertiary">Vessel-level risk · no lesion localisation</li>
          </ul>
        </div>
      )}
      <StageCard
        as="div"
        shape="bare"
        region="legend"
        enterDelay={180}
        tabIndex={0}
        role="img"
        aria-label={`Risk colour scale from low to very high${thr ? `; the tick marks the ${targetId} decision threshold, ${thr.value} percent` : ''}`}
        aria-describedby={shown ? panelId : undefined}
        className={cn(
          'flex h-[var(--toolbar-h)] w-[212px] cursor-default items-center gap-2 px-3 outline-none focus-visible:shadow-focus max-[1439.98px]:w-[184px]',
          className,
        )}
      >
        <span className="text-label font-normal text-tertiary">Low</span>
        <span className="relative h-1.5 flex-1 rounded-xs" style={{ backgroundImage: riskGradientCss() }}>
          {threshold != null && (
            <span
              aria-hidden
              className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_0_1px_rgb(var(--c-bg-panel))] transition-[left] duration-base ease-out"
              style={{ left: `${threshold * 100}%` }}
            />
          )}
        </span>
        <span className="whitespace-nowrap text-label font-normal text-secondary">Very high</span>
      </StageCard>
    </div>
  );
}
