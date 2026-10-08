import { ChevronDown, Info } from 'lucide-react';
import { useId, useState } from 'react';
import { Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { UI } from '@/theme/tokens';
import type { Kpi, MoreMetricRow, Split } from './model';

/** Interval track: the CI (or ± sd) as a bar, the estimate as a dot, the other split as a hollow diamond. */
function IntervalTrack({ kpi, split }: { kpi: Kpi; split: Split }) {
  const [a, b] = kpi.domain;
  const pos = (v: number) => {
    const t = (v - a) / (b - a);
    return Math.min(1, Math.max(0, kpi.higherIsBetter ? t : 1 - t)) * 100;
  };
  if (kpi.value === null) return <div className="h-4" />;
  const lo = kpi.interval ? Math.min(pos(kpi.interval[0]), pos(kpi.interval[1])) : pos(kpi.value);
  const hi = kpi.interval ? Math.max(pos(kpi.interval[0]), pos(kpi.interval[1])) : pos(kpi.value);
  const other = kpi.other !== null ? pos(kpi.other) : null;
  return (
    <svg className="block h-4 w-full overflow-visible" aria-hidden>
      <line x1="0%" x2="100%" y1="8" y2="8" stroke={UI.borderStrong} strokeWidth="1" />
      <line x1="0%" x2="0%" y1="5" y2="11" stroke={UI.borderStrong} />
      <line x1="100%" x2="100%" y1="5" y2="11" stroke={UI.borderStrong} />
      <rect
        x={`${lo}%`}
        y="6"
        width={`${Math.max(0.5, hi - lo)}%`}
        height="4"
        rx="2"
        fill="rgba(255,255,255,0.28)"
      />
      {other !== null && (
        <svg x={`${other}%`} y="0" width="1" height="16" overflow="visible">
          <rect
            x="-3.5"
            y="4.5"
            width="7"
            height="7"
            transform="rotate(45 0 8)"
            fill={UI.bgPanel}
            stroke={UI.textSecondary}
            strokeWidth="1.25"
          />
        </svg>
      )}
      <circle
        cx={`${pos(kpi.value)}%`}
        cy="8"
        r="4.5"
        fill={UI.textPrimary}
        stroke={UI.bgPanel}
        strokeWidth="2"
        style={{ filter: 'drop-shadow(0 0 5px rgba(86,194,230,0.75))' }}
      />
      <title>
        {`${kpi.domainLabels[0]} (left) to ${kpi.domainLabels[1]} (right). Dot: ${split === 'test' ? 'held-out estimate' : 'cross-validation mean'}; bar: ${split === 'test' ? '95 % bootstrap interval' : '± 1 sd'}; diamond: ${split === 'test' ? 'cross-validation mean' : 'held-out estimate'}.`}
      </title>
    </svg>
  );
}

function KpiTile({ kpi, split, index }: { kpi: Kpi; split: Split; index: number }) {
  const interval =
    kpi.interval && split === 'test'
      ? `CI ${formatMetricValue(kpi.interval[0])}–${formatMetricValue(kpi.interval[1])}`
      : kpi.sd !== null
        ? `± ${formatMetricValue(kpi.sd)}`
        : '';
  return (
    <div
      className="card-surface is-interactive spotlight flex min-w-0 animate-fade-up flex-col gap-2 p-4 min-[1440px]:px-5"
      style={{ animationDelay: `${120 + index * 70}ms` }}
    >
      {/* LUMEN 2: a lit hairline along the top edge of every KPI tile. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(86,194,230,0.55),transparent)]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-tertiary">{kpi.label}</span>
        <Tooltip content={kpi.definition} placement="top">
          <button
            type="button"
            aria-label={`What is ${kpi.label}?`}
            className="-m-1 inline-flex size-6 items-center justify-center rounded-sm text-tertiary hover:text-primary"
          >
            <Info aria-hidden className="size-3.5 stroke-[1.5]" />
          </button>
        </Tooltip>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-gradient font-display text-[2.25rem] font-semibold leading-10 tracking-[-0.035em]">
          {formatMetricValue(kpi.value)}
        </span>
        {interval && <span className="num text-label font-normal text-tertiary">{interval}</span>}
      </div>
      <IntervalTrack kpi={kpi} split={split} />
      <p className="num truncate text-label font-normal text-tertiary">{kpi.sub}</p>
    </div>
  );
}

export interface SummaryTilesProps {
  tiles: Kpi[];
  split: Split;
  more: MoreMetricRow[];
}

/** Row 2 of the summary (§6.4 rule 2): four KPI tiles, their shared legend, and "More metrics". */
export function SummaryTiles({ tiles, split, more }: SummaryTilesProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 min-[1440px]:gap-4">
        {tiles.map((k, i) => (
          <KpiTile key={k.id} kpi={k} split={split} index={i} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label font-normal text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="4" fill={UI.textPrimary} />
            </svg>
            {split === 'test' ? 'Held-out estimate' : 'Cross-validation mean'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden>
              <rect x="0" y="1" width="16" height="4" rx="2" fill="rgba(255,255,255,0.28)" />
            </svg>
            {split === 'test' ? 'bootstrap confidence interval' : '± one standard deviation'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <rect
                x="2"
                y="2"
                width="6"
                height="6"
                transform="rotate(45 5 5)"
                fill="none"
                stroke={UI.textSecondary}
                strokeWidth="1.25"
              />
            </svg>
            {split === 'test' ? 'cross-validation mean' : 'held-out estimate'}
          </span>
        </p>
        {more.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-label text-secondary hover:bg-white/[0.07] hover:text-primary"
          >
            More metrics
            <ChevronDown
              aria-hidden
              className={cn('size-4 stroke-[1.5] transition-transform duration-fast', open && 'rotate-180')}
            />
          </button>
        )}
      </div>
      {open && (
        <div id={panelId} className="card-surface animate-fade-up overflow-x-auto">
          <table className="w-full border-collapse text-body-s">
            <caption className="sr-only">Secondary metrics, held-out test and cross-validation</caption>
            <thead>
              <tr className="text-label text-tertiary">
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Metric
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Held-out test
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Confidence interval
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Cross-validation (mean ± sd)
                </th>
              </tr>
            </thead>
            <tbody>
              {more.map((r) => (
                <tr key={r.id} className="border-t border-hairline">
                  <th scope="row" className="px-4 py-1.5 text-left font-normal text-secondary">
                    {r.label}
                  </th>
                  <td className="num px-4 py-1.5 text-right text-primary">{r.test}</td>
                  <td className="num px-4 py-1.5 text-right text-tertiary">{r.testCi}</td>
                  <td className="num px-4 py-1.5 text-right text-primary">{r.cv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
