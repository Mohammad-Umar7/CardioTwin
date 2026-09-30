import { useId, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { riskHex } from '@/theme/risk';
import type { TargetId } from '@/types/contracts';
import { iceAt } from './lib/copy';
import type { IceResult } from './lib/whatIfEngine';

const H = 16;
/** Probability → y inside the 16 px strip (1 px margin top and bottom). */
const yOf = (p: number) => H - Math.max(0, Math.min(1, p)) * (H - 2) - 1;

/**
 * ICE strip (DESIGN_SYSTEM §5 NumericFeatureRow): 32 samples of p(target) across [min, max], a 1 px
 * text/secondary line over an Ember-gradient fill at 60 %, fading toward the track (risk colour on a
 * mark, never on text). The y-axis is the absolute 0–1 probability, so a flat strip honestly means "this
 * input barely matters". A small marker rides the curve above the thumb (`at`, the thumb's fraction of
 * the range), so a drag previews the estimate before the value is committed.
 */
export function IceStrip({ result, target, at, className }: { result: IceResult; target: TargetId; at?: number; className?: string }) {
  const gradientId = useId().replace(/:/g, '');
  const probabilities = result.probabilities[target];
  const shape = useMemo(() => {
    if (!probabilities || probabilities.length < 2) return null;
    const n = probabilities.length;
    const points = probabilities.map((p, i) => [(i / (n - 1)) * 100, yOf(p)] as const);
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L100,${H} L0,${H} Z`;
    const stops = probabilities.map((p, i) => ({ offset: `${((i / (n - 1)) * 100).toFixed(1)}%`, color: riskHex(p) }));
    const lo = Math.min(...probabilities);
    const hi = Math.max(...probabilities);
    return { line, area, stops, lo, hi };
  }, [probabilities]);
  if (!shape || !probabilities) return null;
  const range =
    Math.round(shape.lo * 100) === Math.round(shape.hi * 100)
      ? `stays at ${formatProbability(shape.lo).spoken}`
      : `ranges from ${formatProbability(shape.lo).spoken} to ${formatProbability(shape.hi).spoken}`;
  const marker =
    at !== undefined && Number.isFinite(at)
      ? { left: `${Math.max(0, Math.min(1, at)) * 100}%`, top: yOf(iceAt(probabilities, at)) }
      : null;
  return (
    <div className={cn('relative', className)}>
      <svg
        role="img"
        aria-label={`${target} estimate across this input's range: ${range}.`}
        viewBox={`0 0 100 ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            {shape.stops.map((s) => (
              <stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
          {/* Fade the fill toward the track so a high, flat strip reads as a curve, not a slab. */}
          <linearGradient id={`${gradientId}-fade`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.6} />
            <stop offset="1" stopColor="#fff" stopOpacity={0.08} />
          </linearGradient>
          <mask id={`${gradientId}-mask`} maskContentUnits="userSpaceOnUse">
            <rect x="0" y="0" width="100" height={H} fill={`url(#${gradientId}-fade)`} />
          </mask>
        </defs>
        <path d={shape.area} fill={`url(#${gradientId})`} mask={`url(#${gradientId}-mask)`} />
        <path d={shape.line} fill="none" className="stroke-secondary" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {marker && (
        <span
          aria-hidden
          className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_1.5px_rgb(var(--c-bg-panel))]"
          style={{ left: marker.left, top: marker.top }}
        />
      )}
    </div>
  );
}
