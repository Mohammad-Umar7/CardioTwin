import { Download, Table2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { IconButton, Popover, Skeleton } from '@/design';
import { cn } from '@/lib/cn';
import { exportChart, exportCsv } from './exportChart';
import { SeriesKey, type SeriesKind } from './XYChart';

export interface ChartTableData {
  caption: string;
  columns: string[];
  /** Cells; numeric columns are right-aligned when `numeric[i]` is true. */
  rows: ReactNode[][];
  numeric?: boolean[];
}

export interface LegendItem {
  kind: SeriesKind | 'band' | 'operating';
  label: string;
}

export interface ChartModuleProps {
  id: string;
  /** Takeaway title: states the finding, not the method (§6.4 rule 1). */
  title: string;
  /** "How to read" line: the method, in label / tertiary. */
  howTo: string;
  legend?: LegendItem[];
  table?: ChartTableData | null;
  /** Body height; identical for every state (§6.4 rule 6). */
  height: number;
  status?: 'ready' | 'loading' | 'empty';
  emptyText?: string;
  /** File name stem and provenance line for exports. Omit to hide export. */
  exportName?: string;
  provenance?: string;
  /** PNG / SVG export of the drawn chart (SVG charts only); CSV of the table is offered whenever a table exists. */
  exportImage?: boolean;
  /** Right-aligned header extras (e.g. a reset chip). */
  aside?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * One chart module (§6.4): takeaway title (title-2) and everything else at `label` — two text sizes
 * only. Every module offers "View as table" and a watermarked export, and keeps one fixed body
 * height across loading, empty and ready states so nothing below it shifts.
 */
export function ChartModule({
  id,
  title,
  howTo,
  legend,
  table,
  height,
  status = 'ready',
  emptyText = 'Not published in this model release.',
  exportName,
  provenance = 'CardioTwin',
  exportImage = true,
  aside,
  footer,
  className,
  children,
}: ChartModuleProps) {
  const [asTable, setAsTable] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const doExport = (format: 'svg' | 'png' | 'csv', close: () => void) => {
    close();
    if (!exportName) return;
    if (format === 'csv') {
      if (table) exportCsv(table, { title, provenance, filename: exportName });
      return;
    }
    const svg = bodyRef.current?.querySelector<SVGSVGElement>('svg[data-chart-root]');
    if (!svg) return;
    void exportChart(svg, { title, provenance, filename: exportName, format }).catch((e: unknown) =>
      console.warn('Chart export failed', e),
    );
  };
  const formats: { id: 'png' | 'svg' | 'csv'; label: string }[] = [
    ...(exportImage && !asTable
      ? [
          { id: 'png' as const, label: 'PNG image' },
          { id: 'svg' as const, label: 'SVG vector' },
        ]
      : []),
    ...(table ? [{ id: 'csv' as const, label: 'CSV data' }] : []),
  ];

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-panel p-4 min-[1440px]:p-5',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={titleId} className="text-title-2 text-primary text-pretty">
            {title}
          </h3>
          <p className="text-label font-normal text-tertiary">{howTo}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {aside}
          {table && status === 'ready' && (
            <IconButton
              label={asTable ? 'View as chart' : 'View as table'}
              icon={<Table2 />}
              size="sm"
              active={asTable}
              aria-pressed={asTable}
              onClick={() => setAsTable((v) => !v)}
            />
          )}
          {exportName && status === 'ready' && formats.length > 0 && (
            <Popover
              label="Export chart"
              width={184}
              placement="bottom"
              className="p-1"
              trigger={(props) => (
                <IconButton label="Export chart" icon={<Download />} size="sm" {...props} />
              )}
            >
              {(close) => (
                <div role="menu" aria-label="Export format" className="flex flex-col">
                  {formats.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="menuitem"
                      onClick={() => doExport(f.id, close)}
                      className="flex h-8 items-center justify-between rounded-sm px-2 text-left text-label text-secondary hover:bg-surface-2 hover:text-primary focus-visible:bg-surface-2"
                    >
                      {f.label}
                      <span className="text-tertiary">watermarked</span>
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          )}
        </div>
      </header>
      {legend && legend.length > 0 && status === 'ready' && !asTable && (
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label font-normal text-tertiary"
          aria-label="Legend"
        >
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <SeriesKey kind={l.kind} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={bodyRef} style={{ height }} className="relative min-w-0">
        {status === 'loading' && <Skeleton className="h-full w-full rounded-md" label={`Loading ${title}`} />}
        {status === 'empty' && (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-line text-label font-normal text-tertiary">
            {emptyText}
          </div>
        )}
        {status === 'ready' && !asTable && children}
        {status === 'ready' && asTable && table && (
          <div className="panel-scroll relative h-full overflow-auto rounded-md border border-hairline">
            <table className="w-full border-collapse text-label font-normal">
              <caption className="sr-only">{table.caption}</caption>
              <thead className="sticky top-0 bg-surface-1">
                <tr>
                  {table.columns.map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        'px-3 py-1.5 font-medium text-tertiary',
                        table.numeric?.[i] ? 'text-right' : 'text-left',
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-hairline">
                    {r.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          'px-3 py-1 text-secondary',
                          table.numeric?.[ci] && 'num text-right text-primary',
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {footer}
    </section>
  );
}
