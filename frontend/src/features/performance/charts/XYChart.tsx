import { scaleLinear } from 'd3-scale';
import { area, curveStepAfter, line } from 'd3-shape';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { UI } from '@/theme/tokens';
import { formatTick, labelWidth, niceAxis } from './scale';
import { useElementWidth } from './useElementWidth';

export type SeriesKind = 'main' | 'secondary' | 'reference' | 'hidden';

export interface XYSeries {
  id: string;
  label: string;
  points: readonly (readonly [number, number])[];
  /** main = text/primary 1.5 px · secondary = white 40 % · reference = tertiary dashed 4 3 · hidden = hover only. */
  kind?: SeriesKind;
  curve?: 'linear' | 'step';
  /** Draw a dot per point; a number array gives per-point radii (calibration bin sizes). */
  dots?: boolean | readonly number[];
  /** Participates in the crosshair (defaults to true for main and hidden series). */
  hover?: boolean;
}

export interface XYBand {
  label: string;
  x: readonly number[];
  low: readonly number[];
  high: readonly number[];
}

export interface XYMarker {
  x: number;
  y: number;
  /** Permanent annotation next to the mark ("deployed thr 0.75"). */
  label?: string;
  kind: 'operating' | 'explore';
  /**
   * Where the annotation sits relative to the mark. `auto` goes above and flips left near the right
   * edge; charts whose curve would cross that spot (ROC) pass the empty side explicitly.
   */
  placement?: 'auto' | 'above-right' | 'below-right' | 'above-left' | 'below-left';
}

export interface XYRule {
  x: number;
  label?: string;
  kind: 'operating' | 'explore';
}

export interface AxisSpec {
  title: string;
  /** Data domain; niced to round ticks. Omit to fit the data. */
  domain?: [number, number];
  /** Natural bounds the niced domain may not cross (e.g. [0, 1]). */
  clamp?: [number, number];
}

export interface HoverPoint {
  series: XYSeries;
  index: number;
  x: number;
  y: number;
}

export interface XYChartProps {
  height: number;
  x: AxisSpec;
  y: AxisSpec;
  series: XYSeries[];
  band?: XYBand | null;
  markers?: XYMarker[];
  rules?: XYRule[];
  /** Crosshair search: nearest point in 2D, or nearest by x (functions of x such as net benefit). */
  hoverMode?: 'nearest' | 'x';
  /** Text for the live readout slot (top-right, never over the data). */
  readout?: (p: HoverPoint) => string;
  /** Click / Enter on the hovered point. */
  onPick?: (p: HoverPoint) => void;
  /** Accessible name of the plot. */
  label: string;
  /** One-sentence summary (aria-describedby). */
  summary: string;
}

const TOP = 28; // y-axis title row (horizontal title, top-left) + clearance
const TICK_GAP = 8; // tick label ↔ plot
const X_TICK_H = 16;
const TITLE_CLEAR = 8; // tick labels ↔ axis title (≥ 8 px, §6.4 rule 5)
const TITLE_H = 16;
const FONT = 12;
const GRID = 'rgba(255,255,255,0.06)';
const SECONDARY = 'rgba(255,255,255,0.4)';

function stroke(kind: SeriesKind | undefined): { color: string; width: number; dash?: string } {
  if (kind === 'reference') return { color: UI.textTertiary, width: 1, dash: '4 3' };
  if (kind === 'secondary') return { color: SECONDARY, width: 1.25 };
  return { color: UI.textPrimary, width: 1.5 };
}

/** Legend key for a series kind, reused by the module legend row. */
export function SeriesKey({ kind }: { kind: SeriesKind | 'band' | 'operating' }) {
  if (kind === 'band') {
    return (
      <svg width="18" height="10" aria-hidden>
        <rect x="0" y="1" width="18" height="8" rx="1" fill="rgba(255,255,255,0.08)" />
      </svg>
    );
  }
  if (kind === 'operating') {
    return (
      <svg width="12" height="12" aria-hidden>
        <circle cx="6" cy="6" r="4" fill={UI.accent} stroke={UI.bgPanel} strokeWidth="2" />
      </svg>
    );
  }
  const s = stroke(kind);
  return (
    <svg width="18" height="6" aria-hidden>
      <line
        x1="0"
        x2="18"
        y1="3"
        y2="3"
        stroke={s.color}
        strokeWidth={Math.max(1.5, s.width)}
        strokeDasharray={s.dash}
      />
    </svg>
  );
}

/**
 * Neutral evaluation chart (LUMEN §4.4, V2 §6.4): rendered at 1:1 pixels with round ticks, a
 * horizontal y-axis title top-left, ≥ 8 px title clearance, 6 % white gridlines, the operating point
 * as the only accent mark, and a crosshair whose values sit on the axes and in a readout slot above
 * the plot (never an occluding tooltip). Keyboard: ←/→ walk the points, Enter picks, Esc clears.
 */
export function XYChart({
  height,
  x: xSpec,
  y: ySpec,
  series,
  band,
  markers = [],
  rules = [],
  hoverMode = 'nearest',
  readout,
  onPick,
  label,
  summary,
}: XYChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const descId = useId();
  const clipId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<HoverPoint | null>(null);

  const extent = useCallback(
    (axis: 0 | 1, spec: AxisSpec): [number, number] => {
      if (spec.domain) return spec.domain;
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of series)
        for (const p of s.points) {
          lo = Math.min(lo, p[axis]);
          hi = Math.max(hi, p[axis]);
        }
      return Number.isFinite(lo) ? [lo, hi] : [0, 1];
    },
    [series],
  );

  const xAxis = useMemo(() => {
    const [a, b] = extent(0, xSpec);
    return niceAxis(a, b, xSpec.clamp);
  }, [extent, xSpec]);
  const yAxis = useMemo(() => {
    const [a, b] = extent(1, ySpec);
    return niceAxis(a, b, ySpec.clamp);
  }, [extent, ySpec]);

  const yLabels = yAxis.ticks.map((t) => formatTick(t, yAxis.step));
  const xLabels = xAxis.ticks.map((t) => formatTick(t, xAxis.step));
  const left = Math.ceil(Math.max(...yLabels.map((l) => labelWidth(l, FONT)), 8)) + TICK_GAP;
  const right = Math.ceil(Math.max(12, labelWidth(xLabels.at(-1) ?? '', FONT) / 2 + 2));
  const bottom = TICK_GAP + X_TICK_H + TITLE_CLEAR + TITLE_H;
  const plotW = Math.max(40, width - left - right);
  const plotH = Math.max(40, height - TOP - bottom);

  const xs = useMemo(
    () =>
      scaleLinear()
        .domain(xAxis.domain)
        .range([left, left + plotW]),
    [xAxis, left, plotW],
  );
  const ys = useMemo(
    () =>
      scaleLinear()
        .domain(yAxis.domain)
        .range([TOP + plotH, TOP]),
    [yAxis, plotH],
  );
  const clampY = (v: number) => Math.min(TOP + plotH, Math.max(TOP, ys(v)));

  const hoverable = useMemo(
    () => series.filter((s) => s.hover ?? (s.kind === undefined || s.kind === 'main' || s.kind === 'hidden')),
    [series],
  );
  /** Flat list of hoverable points in x order (keyboard walking order). */
  const flat = useMemo(() => {
    const pts: HoverPoint[] = [];
    for (const s of hoverable)
      s.points.forEach((p, index) => pts.push({ series: s, index, x: p[0], y: p[1] }));
    return pts.sort((a, b) => a.x - b.x || a.y - b.y);
  }, [hoverable]);

  const nearest = (px: number, py: number): HoverPoint | null => {
    let best: HoverPoint | null = null;
    let bestD = Infinity;
    for (const p of flat) {
      const dx = xs(p.x) - px;
      const dy = ys(p.y) - py;
      const d = hoverMode === 'x' ? Math.abs(dx) : dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setHover(nearest(e.clientX - r.left, e.clientY - r.top));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (flat.length === 0) return;
    const i = hover ? flat.findIndex((p) => p.series.id === hover.series.id && p.index === hover.index) : -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHover(flat[Math.min(flat.length - 1, i + 1)] ?? null);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setHover(flat[Math.max(0, i < 0 ? flat.length - 1 : i - 1)] ?? null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHover(flat[0] ?? null);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHover(flat.at(-1) ?? null);
    } else if ((e.key === 'Enter' || e.key === ' ') && hover && onPick) {
      e.preventDefault();
      onPick(hover);
    } else if (e.key === 'Escape' && hover) {
      e.stopPropagation();
      setHover(null);
    }
  };

  const path = (s: XYSeries) => {
    const gen = line<readonly [number, number]>()
      .x((p) => xs(p[0]))
      .y((p) => clampY(p[1]));
    if (s.curve === 'step') gen.curve(curveStepAfter);
    return gen(s.points as (readonly [number, number])[]) ?? '';
  };

  const maxDot = (s: XYSeries) => (Array.isArray(s.dots) ? Math.max(1, ...(s.dots as number[])) : 1);
  const readoutText = hover && readout ? readout(hover) : '';
  const hx = hover ? xs(hover.x) : 0;
  const hy = hover ? clampY(hover.y) : 0;
  const plotBottom = TOP + plotH;

  const chip = (text: string, cx: number, cy: number, anchor: 'middle' | 'end'): ReactNode => {
    const w = labelWidth(text, FONT) + 8;
    const x0 = anchor === 'middle' ? cx - w / 2 : cx - w;
    return (
      <g>
        <rect x={x0} y={cy - 9} width={w} height={18} rx={3} fill={UI.surface3} />
        <text
          x={anchor === 'middle' ? cx : cx - 4}
          y={cy + 4}
          textAnchor={anchor}
          fill={UI.textPrimary}
          fontSize={FONT}
        >
          {text}
        </text>
      </g>
    );
  };

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <div
        role="group"
        aria-label={label}
        aria-describedby={descId}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        className="rounded-sm outline-none focus-visible:shadow-focus"
      >
        <svg
          data-chart-root=""
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          fontFamily="Inter Variable, Inter, system-ui, sans-serif"
          className="block select-none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={TOP - 6} width={plotW + 6} height={plotH + 12} />
            </clipPath>
          </defs>
          {/* y-axis title, horizontal, top-left (replaces rotated titles) */}
          <text x={0} y={12} fill={UI.textSecondary} fontSize={FONT}>
            {ySpec.title}
          </text>
          {readoutText && (
            <text x={width} y={12} textAnchor="end" fill={UI.textPrimary} fontSize={FONT}>
              {readoutText}
            </text>
          )}
          {yAxis.ticks.map((t) => (
            <line
              key={`gy${t}`}
              x1={left}
              x2={left + plotW}
              y1={ys(t)}
              y2={ys(t)}
              stroke={GRID}
              shapeRendering="crispEdges"
            />
          ))}
          {xAxis.ticks.map((t) => (
            <line
              key={`gx${t}`}
              x1={xs(t)}
              x2={xs(t)}
              y1={TOP}
              y2={plotBottom}
              stroke={GRID}
              shapeRendering="crispEdges"
            />
          ))}
          <g clipPath={`url(#${clipId})`}>
            {band && (
              <path
                d={
                  area<number>()
                    .x((_, i) => xs(band.x[i]!))
                    .y0((_, i) => clampY(band.low[i]!))
                    .y1((_, i) => clampY(band.high[i]!))(band.x as number[]) ?? ''
                }
                fill="rgba(255,255,255,0.08)"
              />
            )}
            {rules.map((r) => (
              <line
                key={`rule-${r.kind}-${r.x}`}
                x1={xs(r.x)}
                x2={xs(r.x)}
                y1={TOP}
                y2={plotBottom}
                stroke={UI.accent}
                strokeOpacity={r.kind === 'operating' ? 0.9 : 0.7}
                strokeDasharray={r.kind === 'explore' ? '3 3' : undefined}
              />
            ))}
            {series.map((s) => {
              if (s.kind === 'hidden') return null;
              const st = stroke(s.kind);
              const radii = Array.isArray(s.dots) ? (s.dots as number[]) : null;
              const maxR = maxDot(s);
              return (
                <g key={s.id}>
                  {!s.dots && (
                    <path
                      d={path(s)}
                      fill="none"
                      stroke={st.color}
                      strokeWidth={st.width}
                      strokeDasharray={st.dash}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      // LUMEN 2: solid curves draw themselves in when their card scrolls into view (globals.css);
                      // dashed reference lines keep their dash units, so they are left out.
                      {...(st.dash ? null : { pathLength: 1, className: 'chart-draw' })}
                    />
                  )}
                  {s.dots &&
                    s.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={xs(p[0])}
                        cy={clampY(p[1])}
                        r={radii ? 3.5 + 4 * Math.sqrt((radii[i] ?? 0) / maxR) : 4}
                        fill={UI.textPrimary}
                        fillOpacity={0.9}
                        stroke={UI.bgPanel}
                        strokeWidth={2}
                      />
                    ))}
                </g>
              );
            })}
          </g>
          {hover && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={hy} y2={plotBottom} stroke={UI.textTertiary} strokeOpacity={0.6} />
              <line x1={left} x2={hx} y1={hy} y2={hy} stroke={UI.textTertiary} strokeOpacity={0.6} />
              <circle cx={hx} cy={hy} r={5} fill="none" stroke={UI.textPrimary} strokeWidth={1.5} />
            </g>
          )}
          {markers.map((mk) => {
            const cx = xs(mk.x);
            const cy = clampY(mk.y);
            const place = mk.placement ?? 'auto';
            const nearRight = cx > left + plotW * 0.62;
            const nearTop = cy < TOP + 24;
            const nearBottom = cy > TOP + plotH - 24;
            const flip = place === 'auto' ? nearRight : place.endsWith('left') ? cx > left + 96 : nearRight;
            const below = place === 'auto' ? nearTop : place.startsWith('below') ? !nearBottom : nearTop;
            return (
              <g key={`mk-${mk.kind}`} pointerEvents="none">
                {mk.kind === 'operating' ? (
                  <circle cx={cx} cy={cy} r={4.5} fill={UI.accent} stroke={UI.bgPanel} strokeWidth={2} />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="none"
                    stroke={UI.accent}
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                  />
                )}
                {mk.label && (
                  <text
                    x={flip ? cx - 10 : cx + 10}
                    y={below ? cy + 18 : cy - 10}
                    textAnchor={flip ? 'end' : 'start'}
                    fill={UI.textSecondary}
                    fontSize={FONT}
                    stroke={UI.bgPanel}
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {mk.label}
                  </text>
                )}
              </g>
            );
          })}
          {rules
            .filter((r) => r.label)
            .map((r) => {
              const rx = xs(r.x);
              const flip = rx > left + plotW * 0.7;
              return (
                <text
                  key={`rl-${r.kind}`}
                  x={flip ? rx - 6 : rx + 6}
                  y={TOP + (r.kind === 'operating' ? 12 : 28)}
                  textAnchor={flip ? 'end' : 'start'}
                  fill={UI.textSecondary}
                  fontSize={FONT}
                  stroke={UI.bgPanel}
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {r.label}
                </text>
              );
            })}
          {yAxis.ticks.map((t, i) => (
            <text
              key={`y${t}`}
              x={left - TICK_GAP}
              y={ys(t) + 4}
              textAnchor="end"
              fill={UI.textTertiary}
              fontSize={FONT}
            >
              {yLabels[i]}
            </text>
          ))}
          {xAxis.ticks.map((t, i) => (
            <text
              key={`x${t}`}
              x={xs(t)}
              y={plotBottom + TICK_GAP + 11}
              textAnchor="middle"
              fill={UI.textTertiary}
              fontSize={FONT}
            >
              {xLabels[i]}
            </text>
          ))}
          <text
            x={left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            fill={UI.textSecondary}
            fontSize={FONT}
          >
            {xSpec.title}
          </text>
          {hover && (
            <g pointerEvents="none">
              {chip(formatTick(hover.x, 0.01), hx, plotBottom + TICK_GAP + 7, 'middle')}
              {chip(formatTick(hover.y, 0.01), left - 2, hy, 'end')}
            </g>
          )}
          <rect
            x={left}
            y={TOP}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover && onPick?.(hover)}
            style={{ cursor: onPick ? 'pointer' : 'crosshair' }}
          />
        </svg>
      </div>
      <p id={descId} className="sr-only">
        {summary}
      </p>
      <p className="sr-only" aria-live="polite">
        {readoutText}
      </p>
    </div>
  );
}
