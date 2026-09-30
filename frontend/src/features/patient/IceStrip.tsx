import { useId, useMemo } from 'react';
import { formatProbability } from '@/lib/format';
import { riskHex } from '@/theme/risk';
import type { TargetId } from '@/types/contracts';
import type { IceResult } from './lib/whatIfEngine';

/**
 * ICE strip (DESIGN_SYSTEM §5 NumericFeatureRow): 32 samples of p(target) across [min, max], a 1 px
 * text/secondary line over an Ember-gradient fill at 60 %, fading toward the track (risk colour on a mark,
 * never on text). The
 * y-axis is the absolute 0–1 probability, so a flat strip honestly means "this input barely matters".
 */
export function IceStrip({ result, target, className }: { result: IceResult; target: TargetId; className?: string }) {
  const gradientId = useId().replace(/:/g, '');
  const probabilities = result.probabilities[target];
  const shape = useMemo(() => {
    if (!probabilities || probabilities.length < 2) return null;
    const n = probabilities.length;
    const points = probabilities.map((p, i) => [(i / (n - 1)) * 100, 16 - Math.max(0, Math.min(1, p)) * 14 - 1] as const);
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L100,16 L0,16 Z`;
    const stops = probabilities.map((p, i) => ({ offset: `${((i / (n - 1)) * 100).toFixed(1)}%`, color: riskHex(p) }));
    const lo = Math.min(...probabilities);
    const hi = Math.max(...probabilities);
    return { line, area, stops, lo, hi };
  }, [probabilities]);
  if (!shape) return null;
  const range =
    Math.round(shape.lo * 100) === Math.round(shape.hi * 100)
      ? `stays at ${formatProbability(shape.lo).spoken}`
      : `ranges from ${formatProbability(shape.lo).spoken} to ${formatProbability(shape.hi).spoken}`;
  return (
    <svg
      role="img"
      aria-label={`${target} estimate across this input's range: ${range}.`}
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      className={className}
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
          <rect x="0" y="0" width="100" height="16" fill={`url(#${gradientId}-fade)`} />
        </mask>
      </defs>
      <path d={shape.area} fill={`url(#${gradientId})`} mask={`url(#${gradientId}-mask)`} />
      <path d={shape.line} fill="none" className="stroke-secondary" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
