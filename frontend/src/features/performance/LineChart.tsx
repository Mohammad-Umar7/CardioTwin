import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { useId } from 'react';
import { UI } from '@/theme/tokens';

export interface ChartSeries {
  id: string;
  label: string;
  x: readonly number[];
  y: readonly number[];
  /** 'main' = text/primary 1.5 px; 'reference' = text/tertiary dashed 4 3; 'secondary' = white 40 %. */
  kind?: 'main' | 'reference' | 'secondary';
  points?: boolean;
  /** Optional point sizes (e.g. calibration bin counts). */
  sizes?: readonly number[];
}

export interface ChartBand {
  x: readonly number[];
  low: readonly number[];
  high: readonly number[];
}

export interface LineChartProps {
  series: ChartSeries[];
  band?: ChartBand | null;
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Operating point (8 px accent dot). */
  marker?: { x: number; y: number; label: string } | null;
  height?: number;
  /** Summary sentence for aria-describedby. */
  summary: string;
}

const W = 520;
const M = { top: 12, right: 16, bottom: 34, left: 40 };

/**
 * Neutral line chart for evaluation curves (DESIGN_SYSTEM §4.4 "Charts are neutral"): main series in
 * text/primary at 1.5 px, CI band white 8 %, references text/tertiary dashed "4 3", operating point an
 * 8 px accent dot. Performance charts never use the risk ramp.
 */
export function LineChart({ series, band, xLabel, yLabel, xDomain = [0, 1], yDomain = [0, 1], marker, height = 240, summary }: LineChartProps) {
  const id = useId();
  const x = scaleLinear().domain(xDomain).range([M.left, W - M.right]);
  const y = scaleLinear().domain(yDomain).range([height - M.bottom, M.top]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => xDomain[0] + t * (xDomain[1] - xDomain[0]));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yDomain[0] + t * (yDomain[1] - yDomain[0]));
  const path = (s: ChartSeries) =>
    line<number>()
      .x((_, i) => x(s.x[i]!))
      .y((v) => y(v))(s.y as number[]) ?? '';

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-describedby={id}>
        {yTicks.map((t) => (
          <line key={`gy${t}`} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={UI.borderHairline} />
        ))}
        {band && (
          <path
            d={
              area<number>()
                .x((_, i) => x(band.x[i]!))
                .y0((_, i) => y(band.low[i]!))
                .y1((_, i) => y(band.high[i]!))(band.x as number[]) ?? ''
            }
            fill="rgba(255,255,255,0.08)"
          />
        )}
        {series.map((s) => (
          <g key={s.id}>
            <path
              d={path(s)}
              fill="none"
              stroke={s.kind === 'reference' ? UI.textTertiary : s.kind === 'secondary' ? 'rgba(255,255,255,0.4)' : UI.textPrimary}
              strokeWidth={s.kind === 'main' || !s.kind ? 1.5 : 1}
              strokeDasharray={s.kind === 'reference' ? '4 3' : undefined}
            />
            {s.points &&
              s.x.map((xv, i) => (
                <circle
                  key={i}
                  cx={x(xv)}
                  cy={y(s.y[i]!)}
                  r={s.sizes ? 2 + 5 * Math.sqrt((s.sizes[i] ?? 0) / Math.max(...s.sizes, 1)) : 3}
                  fill={UI.textPrimary}
                  fillOpacity={0.85}
                />
              ))}
          </g>
        ))}
        {marker && (
          <g>
            <circle cx={x(marker.x)} cy={y(marker.y)} r={4} fill={UI.accent} stroke={UI.bgPanel} strokeWidth={1.5} />
            <text x={x(marker.x) + 8} y={y(marker.y) + 14} fill={UI.textSecondary} fontSize={11}>
              {marker.label}
            </text>
          </g>
        )}
        {ticks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={height - M.bottom + 16} textAnchor="middle" fill={UI.textTertiary} fontSize={11}>
            {Number(t.toFixed(2))}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`y${t}`} x={M.left - 6} y={y(t) + 4} textAnchor="end" fill={UI.textTertiary} fontSize={11}>
            {Number(t.toFixed(2))}
          </text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={height - 4} textAnchor="middle" fill={UI.textSecondary} fontSize={11}>
          {xLabel}
        </text>
        <text transform={`translate(11 ${(M.top + height - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill={UI.textSecondary} fontSize={11}>
          {yLabel}
        </text>
      </svg>
      <figcaption id={id} className="sr-only">
        {summary}
      </figcaption>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-label font-normal text-tertiary">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="0"
                x2="18"
                y1="3"
                y2="3"
                stroke={s.kind === 'reference' ? UI.textTertiary : s.kind === 'secondary' ? 'rgba(255,255,255,0.4)' : UI.textPrimary}
                strokeWidth={1.5}
                strokeDasharray={s.kind === 'reference' ? '4 3' : undefined}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
