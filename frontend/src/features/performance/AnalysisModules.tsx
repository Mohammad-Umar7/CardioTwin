import { Fragment, useRef } from 'react';
import { cn } from '@/lib/cn';
import { formatMetricValue, formatPercent, MINUS } from '@/lib/format';
import { modalityName } from '@/lib/modelNames';
import { UI } from '@/theme/tokens';
import { ChartModule } from './charts/ChartModule';
import { formatTick, niceAxis } from './charts/scale';
import { useElementWidth } from './charts/useElementWidth';
import type { BaselineResult, ModalityAblation, ModalityRow, RobustnessResult, SubgroupSource, Subgroups } from './extras';
import { modalityFinding, modalityInSentence, ordinal, robustnessFinding, subgroupFinding } from './model';

const f2 = (v: number | null | undefined) => formatMetricValue(v);
/** Signed two-decimal delta; anything that rounds to zero reads "0.00" (no "−0.00"). */
const signed = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : `${v > 0 ? '+' : MINUS}${Math.abs(v).toFixed(2)}`);
const excludesZero = (ci: [number, number] | null | undefined) => !!ci && (ci[0] > 0 || ci[1] < 0);

// ------------------------------------------------------------------------------------ shared bits

function AxisRow({ ticks, step, pos, label, grid }: { ticks: number[]; step: number; pos: (v: number) => number; label: string; grid: string }) {
  return (
    <div className={cn('grid items-start gap-3 pt-1.5 text-label font-normal text-tertiary', grid)} aria-hidden>
      <span>{label}</span>
      <span className="relative h-4">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(t)}%` }}>
            {formatTick(t, step)}
          </span>
        ))}
      </span>
    </div>
  );
}

function GridLines({ ticks, pos }: { ticks: number[]; pos: (v: number) => number }) {
  return (
    <>
      {ticks.map((t) => (
        <line key={t} x1={`${pos(t)}%`} x2={`${pos(t)}%`} y1="0" y2="100%" stroke="rgba(255,255,255,0.06)" />
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------- multimodal headline

export interface MultimodalHeadlineProps {
  target: string;
  modality: ModalityAblation | null;
  baseline: BaselineResult | null;
  testAuc: number | null;
  robustness: RobustnessResult | null;
  nFolds: number | null;
}

/** Three evidence stats that answer "does multimodal data help?" — each shown only when published. */
export function MultimodalHeadline({ target, modality, baseline, testAuc, robustness, nFolds }: MultimodalHeadlineProps) {
  const stats: { value: string; label: string; sub: string; title?: string }[] = [];
  const inst = modality?.instrumental;
  if (inst) {
    const added = inst.addedGroups.map((g) => modalityInSentence(g));
    const list = added.length > 1 ? `${added.slice(0, -1).join(', ')} and ${added.at(-1)}` : (added[0] ?? 'instrumental data');
    const clear = excludesZero(inst.delta?.ci);
    stats.push({
      value: signed(inst.full.mean - inst.bedside.mean),
      label: `ROC-AUC added by ${list} on top of bedside data`,
      sub: `Cross-validation, paired by fold; the interval ${clear ? 'excludes' : 'includes'} zero`,
      title: `${f2(inst.bedside.mean)} → ${f2(inst.full.mean)}${inst.delta?.ci ? `, interval ${signed(inst.delta.ci[0])} to ${signed(inst.delta.ci[1])}` : ''}${inst.delta?.shareFoldsImproved != null ? `, ${formatPercent(inst.delta.shareFoldsImproved)} of ${nFolds ?? 'all'} folds improved` : ''}`,
    });
  }
  if (baseline?.testAuc && testAuc !== null) {
    stats.push({
      value: signed(testAuc - baseline.testAuc.value),
      label: 'Held-out ROC-AUC over the bedside clinical baseline',
      sub: 'Baseline: age, sex, typical angina, diabetes and hypertension',
      title: `${f2(testAuc)} with all modalities vs ${f2(baseline.testAuc.value)} for the baseline`,
    });
  }
  const d = robustness?.deltaVsBaseline;
  if (d && d.sharePositive !== null) {
    stats.push({
      value: formatPercent(d.sharePositive),
      label: 'of random re-splits favour the full panel over the baseline',
      sub: `Median gain ${signed(d.p50)} ROC-AUC; the whole recipe re-run on every split`,
      title: `5th–95th percentile of the gain: ${signed(d.p05)} to ${signed(d.p95)}`,
    });
  }
  if (stats.length === 0) return null;
  return (
    <div
      className={cn(
        'grid gap-px overflow-clip rounded-lg border border-line bg-line',
        stats.length === 3 ? 'md:grid-cols-3' : stats.length === 2 ? 'md:grid-cols-2' : '',
      )}
      aria-label={`Multimodal evidence for ${target}`}
      role="group"
    >
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1.5 bg-panel p-4 min-[1440px]:p-5">
          <span className="font-display text-[2rem] font-semibold leading-9 tracking-[-0.03em] text-primary">{s.value}</span>
          <span className="text-body-s font-medium text-primary text-pretty">{s.label}</span>
          <span className="num text-label font-normal text-tertiary text-pretty" title={s.title}>
            {s.sub}
          </span>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------------- modality charts

const MOD_GRID = 'grid-cols-[minmax(0,34%)_minmax(0,1fr)_92px]';

const inSentence = modalityInSentence;

function looFinding(rows: ModalityRow[]): string {
  const needed = rows
    .filter((r) => r.delta?.ci && r.delta.ci[1] < 0)
    .sort((a, b) => a.delta!.mean - b.delta!.mean);
  if (needed.length === 0) return 'No single modality is irreplaceable: the others compensate when one is removed';
  const names = needed.map((r) => inSentence(r.group));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const worst = needed[0]!;
  return `${list!.charAt(0).toUpperCase()}${list!.slice(1)} ${needed.length > 1 ? 'carry' : 'carries'} signal the others cannot replace (without ${inSentence(worst.group)}: ${signed(worst.delta!.mean)})`;
}

export function CumulativeModule({ target, a, height, provenance }: { target: string; a: ModalityAblation; height: number; provenance: string }) {
  const rows = a.cumulative;
  const lo = Math.min(...rows.map((r) => r.auc.ci?.[0] ?? r.auc.mean));
  const hi = Math.max(...rows.map((r) => r.auc.ci?.[1] ?? r.auc.mean));
  const axis = niceAxis(lo, Math.min(1, hi), [0, 1]);
  const pos = (v: number) => ((v - axis.domain[0]) / (axis.domain[1] - axis.domain[0])) * 100;
  const firstInstrument = rows.findIndex((r) => ['ecg', 'labs', 'echo'].includes(r.group));
  return (
    <ChartModule
      id="chart-modality-cumulative"
      title={modalityFinding(a)}
      exportName={`cardiotwin-${target.toLowerCase()}-modality-cumulative`}
      exportImage={false}
      provenance={provenance}
      howTo="How to read: each row adds one modality to the ones above it, in the order a clinician acquires them. Dot = cross-validated ROC-AUC, whisker = corrected confidence interval; the right column is the gain of that step (● = interval excludes zero)."
      height={height}
      table={{
        caption: `Cumulative modality ablation for ${target}`,
        columns: ['Step', 'ROC-AUC', 'Interval', 'Gain', 'Gain interval'],
        numeric: [false, true, true, true, true],
        rows: rows.map((r, i) => [
          `${i === 0 ? '' : '+ '}${modalityName(r.group)}`,
          f2(r.auc.mean),
          r.auc.ci ? `${f2(r.auc.ci[0])}–${f2(r.auc.ci[1])}` : '',
          r.delta ? signed(r.delta.mean) : '–',
          r.delta?.ci ? `${signed(r.delta.ci[0])} to ${signed(r.delta.ci[1])}` : '',
        ]),
      }}
    >
      <div className="flex h-full flex-col">
        <ol className="relative flex flex-1 flex-col justify-between">
          {rows.map((r, i) => (
            <Fragment key={r.group}>
              {i === firstInstrument && firstInstrument > 0 && (
                <li aria-hidden className={cn('grid items-center gap-3 text-label font-normal text-tertiary', MOD_GRID)}>
                  <span className="border-t border-dashed border-line pt-0.5">Instrumental data</span>
                  <span className="border-t border-dashed border-line" />
                  <span className="border-t border-dashed border-line" />
                </li>
              )}
              <li className={cn('grid items-center gap-3 text-label font-normal', MOD_GRID, i === rows.length - 1 ? 'text-primary' : 'text-secondary')}>
                <span className="truncate">
                  {i === 0 ? '' : '+ '}
                  {modalityName(r.group)}
                </span>
                <svg className="h-3.5 w-full overflow-visible" aria-hidden>
                  <GridLines ticks={axis.ticks} pos={pos} />
                  {r.auc.ci && (
                    <line x1={`${pos(r.auc.ci[0])}%`} x2={`${pos(r.auc.ci[1])}%`} y1="7" y2="7" stroke={UI.textTertiary} strokeWidth="1.5" strokeLinecap="round" />
                  )}
                  <circle cx={`${pos(r.auc.mean)}%`} cy="7" r="4.5" fill={UI.textPrimary} stroke={UI.bgPanel} strokeWidth="2" />
                </svg>
                <span className="num flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <span className="text-primary">{f2(r.auc.mean)}</span>
                  {r.delta ? (
                    <span className="inline-flex w-12 items-center justify-end gap-1 text-secondary">
                      {signed(r.delta.mean)}
                      <span aria-label={excludesZero(r.delta.ci) ? 'interval excludes zero' : 'interval includes zero'} className="text-[0.625rem] leading-none text-tertiary">
                        {excludesZero(r.delta.ci) ? '●' : '○'}
                      </span>
                    </span>
                  ) : (
                    <span className="inline-block w-12" />
                  )}
                </span>
              </li>
            </Fragment>
          ))}
        </ol>
        <AxisRow ticks={axis.ticks} step={axis.step} pos={pos} label="ROC-AUC" grid={MOD_GRID} />
      </div>
    </ChartModule>
  );
}

export function LeaveOneOutModule({ target, a, height, provenance }: { target: string; a: ModalityAblation; height: number; provenance: string }) {
  const rows = a.leaveOneOut.filter((r) => r.delta);
  const vals = rows.flatMap((r) => [r.delta!.mean, ...(r.delta!.ci ?? [])]);
  const axis = niceAxis(Math.min(0, ...vals), Math.max(0, ...vals));
  const pos = (v: number) => ((v - axis.domain[0]) / (axis.domain[1] - axis.domain[0])) * 100;
  const zero = pos(0);
  return (
    <ChartModule
      id="chart-modality-loo"
      title={looFinding(rows)}
      exportName={`cardiotwin-${target.toLowerCase()}-modality-leave-one-out`}
      exportImage={false}
      provenance={provenance}
      howTo="How to read: change in cross-validated ROC-AUC when one modality is removed from the full panel. Bars left of zero mean the model needs that modality; whiskers are corrected confidence intervals."
      height={height}
      table={{
        caption: `Leave-one-modality-out ablation for ${target}`,
        columns: ['Removed', 'ROC-AUC without it', 'Change', 'Interval'],
        numeric: [false, true, true, true],
        rows: rows.map((r) => [
          modalityName(r.group),
          f2(r.auc.mean),
          signed(r.delta!.mean),
          r.delta!.ci ? `${signed(r.delta!.ci[0])} to ${signed(r.delta!.ci[1])}` : '',
        ]),
      }}
    >
      <div className="flex h-full flex-col">
        <ol className="flex flex-1 flex-col justify-between">
          {rows.map((r) => {
            const d = r.delta!;
            const x0 = Math.min(zero, pos(d.mean));
            const w = Math.abs(pos(d.mean) - zero);
            return (
              <li key={r.group} className={cn('grid items-center gap-3 text-label font-normal text-secondary', 'grid-cols-[minmax(0,34%)_minmax(0,1fr)_52px]')}>
                <span className="truncate">without {inSentence(r.group)}</span>
                <svg className="h-3.5 w-full overflow-visible" aria-hidden>
                  <GridLines ticks={axis.ticks} pos={pos} />
                  <rect x={`${x0}%`} y="3" width={`${Math.max(0.4, w)}%`} height="8" rx="2" fill={excludesZero(d.ci) ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'} />
                  {d.ci && <line x1={`${pos(d.ci[0])}%`} x2={`${pos(d.ci[1])}%`} y1="7" y2="7" stroke={UI.textSecondary} strokeWidth="1" />}
                  <line x1={`${zero}%`} x2={`${zero}%`} y1="-2" y2="16" stroke={UI.textTertiary} />
                </svg>
                <span className="num text-right text-primary">{signed(d.mean)}</span>
              </li>
            );
          })}
        </ol>
        <AxisRow ticks={axis.ticks} step={axis.step} pos={pos} label="Change in ROC-AUC" grid="grid-cols-[minmax(0,34%)_minmax(0,1fr)_52px]" />
      </div>
    </ChartModule>
  );
}

// ------------------------------------------------------------------------------------- robustness

export function RobustnessModule({ target, r, height, provenance }: { target: string; r: RobustnessResult; height: number; provenance: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrap);
  const d = r.rocAuc;
  const values = r.samples.length > 0 ? r.samples : [];
  const lo = Math.min(d.min ?? d.p05, d.fixed ?? d.p05, r.cvEstimate?.rocAuc ?? d.p05, ...values);
  const hi = Math.max(d.max ?? d.p95, d.fixed ?? d.p95, r.cvEstimate?.rocAuc ?? d.p95, ...values);
  const axis = niceAxis(lo, Math.min(1, hi), [0, 1]);
  const TOP = 28;
  const BOTTOM = 40;
  const L = 8;
  const R = 8;
  const plotW = Math.max(40, width - L - R);
  const plotH = height - TOP - BOTTOM;
  const x = (v: number) => L + ((v - axis.domain[0]) / (axis.domain[1] - axis.domain[0])) * plotW;
  const binW = axis.step <= 0.05 ? axis.step / 5 : 0.02;
  const nBins = Math.max(1, Math.round((axis.domain[1] - axis.domain[0]) / binW));
  const counts = Array.from({ length: nBins }, () => 0);
  for (const v of values) counts[Math.min(nBins - 1, Math.max(0, Math.floor((v - axis.domain[0]) / binW)))]! += 1;
  const maxCount = Math.max(1, ...counts);
  // Bars use the lower 78 % of the plot so the reference labels above them never sit on a bar.
  const y = (c: number) => TOP + plotH - (c / maxCount) * plotH * 0.78;
  const bars = values.length > 0;
  const pct = r.fixedPercentile;

  return (
    <ChartModule
      id="chart-robustness"
      title={robustnessFinding(r)}
      howTo={`How to read: the whole recipe was re-run on ${r.nSplits} random stratified 80/20 splits of all patients and scored once on each test part. Bars = how often each held-out ROC-AUC occurred; the band spans the 5th–95th percentile.`}
      height={height}
      exportName={`cardiotwin-${target.toLowerCase()}-robustness`}
      provenance={provenance}
      table={{
        caption: `Monte-Carlo hold-out distribution for ${target}`,
        columns: ['Statistic', 'ROC-AUC'],
        numeric: [false, true],
        rows: [
          ['Median', f2(d.p50)],
          ['Mean ± sd', `${f2(d.mean)} ± ${f2(d.sd)}`],
          ['5th–95th percentile', `${f2(d.p05)}–${f2(d.p95)}`],
          ['Published split', f2(d.fixed)],
          ['Published split percentile', pct !== null ? ordinal(pct) : '–'],
          ...(r.cvEstimate ? [['Cross-validation estimate', f2(r.cvEstimate.rocAuc)]] : []),
        ],
      }}
    >
      <div ref={wrap} className="h-full w-full">
        <svg data-chart-root="" width={width} height={height} aria-hidden="true" fontFamily="Inter Variable, Inter, system-ui, sans-serif" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <text x={0} y={12} fill={UI.textSecondary} fontSize={12}>
            {bars ? 'Re-splits' : 'Distribution'}
          </text>
          <rect x={x(d.p05)} y={TOP} width={Math.max(1, x(d.p95) - x(d.p05))} height={plotH} fill="rgba(255,255,255,0.04)" />
          {axis.ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={TOP} y2={TOP + plotH} stroke="rgba(255,255,255,0.06)" />
          ))}
          {bars
            ? counts.map((c, i) =>
                c > 0 ? (
                  <rect
                    key={i}
                    x={x(axis.domain[0] + i * binW) + 1}
                    y={y(c)}
                    width={Math.max(1, x(axis.domain[0] + (i + 1) * binW) - x(axis.domain[0] + i * binW) - 2)}
                    height={TOP + plotH - y(c)}
                    rx={2}
                    fill="rgba(255,255,255,0.35)"
                  />
                ) : null,
              )
            : (
              <g>
                <line x1={x(d.p05)} x2={x(d.p95)} y1={TOP + plotH / 2} y2={TOP + plotH / 2} stroke={UI.textTertiary} strokeWidth={1.5} />
                {d.p25 !== null && d.p75 !== null && (
                  <rect x={x(d.p25)} y={TOP + plotH / 2 - 12} width={x(d.p75) - x(d.p25)} height={24} rx={3} fill="rgba(255,255,255,0.2)" />
                )}
                <line x1={x(d.p50)} x2={x(d.p50)} y1={TOP + plotH / 2 - 12} y2={TOP + plotH / 2 + 12} stroke={UI.textPrimary} strokeWidth={2} />
              </g>
            )}
          <line x1={TOP * 0 + L} x2={L + plotW} y1={TOP + plotH} y2={TOP + plotH} stroke={UI.borderStrong} />
          {r.cvEstimate && (
            <g>
              <line x1={x(r.cvEstimate.rocAuc)} x2={x(r.cvEstimate.rocAuc)} y1={TOP} y2={TOP + plotH} stroke={UI.textTertiary} strokeDasharray="4 3" />
              <text x={x(r.cvEstimate.rocAuc) + 6} y={TOP + 12} fill={UI.textSecondary} fontSize={12} stroke={UI.bgPanel} strokeWidth={3} paintOrder="stroke">
                CV {f2(r.cvEstimate.rocAuc)}
              </text>
            </g>
          )}
          {d.fixed !== null && (
            <g>
              <line x1={x(d.fixed)} x2={x(d.fixed)} y1={TOP - 4} y2={TOP + plotH} stroke={UI.textPrimary} strokeWidth={1.5} />
              <text
                x={x(d.fixed) > L + plotW * 0.6 ? x(d.fixed) - 6 : x(d.fixed) + 6}
                y={TOP + 30}
                textAnchor={x(d.fixed) > L + plotW * 0.6 ? 'end' : 'start'}
                fill={UI.textPrimary}
                fontSize={12}
                stroke={UI.bgPanel}
                strokeWidth={3}
                paintOrder="stroke"
              >
                published split {f2(d.fixed)}
              </text>
            </g>
          )}
          {axis.ticks.map((t) => (
            <text key={`t${t}`} x={x(t)} y={TOP + plotH + 18} textAnchor="middle" fill={UI.textTertiary} fontSize={12}>
              {formatTick(t, axis.step)}
            </text>
          ))}
          <text x={L + plotW / 2} y={height - 4} textAnchor="middle" fill={UI.textSecondary} fontSize={12}>
            Held-out ROC-AUC
          </text>
        </svg>
      </div>
    </ChartModule>
  );
}

export function RobustnessStatsModule({ target, r, height }: { target: string; r: RobustnessResult; height: number }) {
  const rows = [
    { label: 'ROC-AUC', d: r.rocAuc, lowerBetter: false },
    { label: 'F1', d: r.f1, lowerBetter: false },
    { label: 'Brier score', d: r.brier, lowerBetter: true },
    { label: 'Clinical baseline ROC-AUC', d: r.baselineRocAuc, lowerBetter: false },
  ].filter((x) => x.d);
  const title =
    r.deltaVsBaseline?.sharePositive !== null && r.deltaVsBaseline?.sharePositive !== undefined
      ? `The full panel beats the bedside baseline in ${formatPercent(r.deltaVsBaseline.sharePositive)} of re-splits`
      : 'Every metric, re-scored on every re-split';
  return (
    <ChartModule
      id="chart-robustness-stats"
      title={title}
      howTo={`How to read: median and 5th–95th percentile over ${r.nSplits} re-splits; the last column places the published split in that distribution.`}
      height={height}
    >
      <table className="w-full border-collapse text-label font-normal">
        <caption className="sr-only">Monte-Carlo hold-out summary for {target}</caption>
        <thead>
          <tr className="text-tertiary">
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">
              Metric
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Median
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Middle 90 %
            </th>
            <th scope="col" className="py-1.5 pl-2 text-right font-medium">
              Published
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, d }) => (
            <tr key={label} className="border-t border-hairline">
              <th scope="row" className="py-2 pr-2 text-left font-normal text-secondary">
                {label}
              </th>
              <td className="num px-2 py-2 text-right text-primary">{f2(d!.p50)}</td>
              <td className="num px-2 py-2 text-right text-tertiary">
                {f2(d!.p05)}–{f2(d!.p95)}
              </td>
              <td className="num py-2 pl-2 text-right text-secondary">
                {f2(d!.fixed)}
                {d!.fixedPercentile !== null && <span className="text-tertiary"> · {ordinal(d!.fixedPercentile)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartModule>
  );
}

// -------------------------------------------------------------------------------------- subgroups

const SUB_GRID = 'grid-cols-[minmax(0,22%)_72px_minmax(0,1fr)_112px_64px_64px]';

export function SubgroupsModule({ target, s, source, height, provenance }: { target: string; s: Subgroups; source: SubgroupSource; height: number; provenance: string }) {
  const overall = s.overall[source];
  const all = s.factors.flatMap((f) => f.levels.map((l) => l[source])).filter(Boolean);
  const lo = Math.min(...all.map((b) => b!.rocAuc?.ci?.[0] ?? b!.rocAuc?.value ?? 1), overall?.rocAuc?.value ?? 1);
  const axis = niceAxis(Math.max(0.3, lo), 1, [0, 1]);
  const pos = (v: number) => ((Math.max(axis.domain[0], Math.min(axis.domain[1], v)) - axis.domain[0]) / (axis.domain[1] - axis.domain[0])) * 100;
  const sourceText = source === 'test' ? 'the deployed model on the held-out test set' : 'cross-fitted out-of-fold predictions on the development set';
  return (
    <ChartModule
      id="chart-subgroups"
      title={subgroupFinding(s, source)}
      exportName={`cardiotwin-${target.toLowerCase()}-subgroups`}
      exportImage={false}
      provenance={provenance}
      howTo={`How to read: ROC-AUC within each subgroup for ${sourceText}, with bootstrap confidence intervals; the dashed line is the overall value. Hollow dots mark small subgroups (descriptive only). No subgroup-specific thresholds or recalibration are used.`}
      height={height}
      table={{
        caption: `Subgroup performance for ${target}`,
        columns: ['Subgroup', 'Patients', 'With condition', 'ROC-AUC', 'Interval', 'Sensitivity', 'Specificity'],
        numeric: [false, true, true, true, true, true, true],
        rows: s.factors.flatMap((f) =>
          f.levels.map((l) => {
            const b = l[source];
            return [
              `${f.label}: ${l.label}${b?.smallN ? ' (small n)' : ''}`,
              b?.n ?? '–',
              b?.nPos ?? '–',
              f2(b?.rocAuc?.value),
              b?.rocAuc?.ci ? `${f2(b.rocAuc.ci[0])}–${f2(b.rocAuc.ci[1])}` : '',
              f2(b?.sensitivity?.value),
              f2(b?.specificity?.value),
            ];
          }),
        ),
      }}
    >
      <div className="flex h-full flex-col">
        <div className={cn('grid gap-3 pb-1 text-label font-normal text-tertiary', SUB_GRID)}>
          <span>Subgroup</span>
          <span className="text-right">Patients</span>
          <span>ROC-AUC with interval</span>
          <span className="text-right">ROC-AUC</span>
          <span className="text-right">Sens.</span>
          <span className="text-right">Spec.</span>
        </div>
        <div className="relative flex flex-1 flex-col justify-between">
          {s.factors.map((f) => (
            <div key={f.id} role="group" aria-label={f.label} className="flex flex-col">
              <div className="border-t border-hairline pt-1 text-label font-medium text-secondary">{f.label}</div>
              {f.levels.map((l) => {
                const b = l[source];
                const auc = b?.rocAuc;
                return (
                  <div key={l.id} className={cn('grid items-center gap-3 text-label font-normal', SUB_GRID)}>
                    <span className="truncate pl-3 text-secondary">
                      {l.label}
                      {b?.smallN && <span className="ml-1.5 text-tertiary">small n</span>}
                    </span>
                    <span className="num text-right text-tertiary">
                      {b ? `${b.n}` : '–'}
                      {b?.nPos !== null && b?.nPos !== undefined && <span className="text-tertiary"> ({b.nPos})</span>}
                    </span>
                    <svg className="h-3.5 w-full overflow-visible" aria-hidden>
                      <GridLines ticks={axis.ticks} pos={pos} />
                      {overall?.rocAuc && (
                        <line x1={`${pos(overall.rocAuc.value)}%`} x2={`${pos(overall.rocAuc.value)}%`} y1="-3" y2="17" stroke={UI.textTertiary} strokeDasharray="3 3" />
                      )}
                      {auc?.ci && <line x1={`${pos(auc.ci[0])}%`} x2={`${pos(auc.ci[1])}%`} y1="7" y2="7" stroke={UI.textTertiary} strokeWidth="1.5" strokeLinecap="round" />}
                      {auc && (
                        <circle
                          cx={`${pos(auc.value)}%`}
                          cy="7"
                          r="4.5"
                          fill={b?.smallN ? UI.bgPanel : UI.textPrimary}
                          stroke={b?.smallN ? UI.textPrimary : UI.bgPanel}
                          strokeWidth={b?.smallN ? 1.5 : 2}
                        />
                      )}
                    </svg>
                    <span className="num text-right">
                      <span className="text-primary">{f2(auc?.value)}</span>
                      {auc?.ci && (
                        <span className="text-tertiary">
                          {' '}
                          {f2(auc.ci[0])}–{f2(auc.ci[1])}
                        </span>
                      )}
                    </span>
                    <span className="num text-right text-secondary">{f2(b?.sensitivity?.value)}</span>
                    <span className="num text-right text-secondary">{f2(b?.specificity?.value)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={cn('grid gap-3 pt-1.5 text-label font-normal text-tertiary', SUB_GRID)} aria-hidden>
          <span />
          <span />
          <span className="relative h-4">
            {axis.ticks.map((t) => (
              <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${pos(t)}%` }}>
                {formatTick(t, axis.step)}
              </span>
            ))}
          </span>
        </div>
      </div>
    </ChartModule>
  );
}
