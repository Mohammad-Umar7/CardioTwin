import { Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { featureName } from '@/lib/modelNames';
import { UI } from '@/theme/tokens';
import type { FeatureSpec, TargetMetrics } from '@/types/contracts';
import { ChartModule } from './charts/ChartModule';
import { niceAxis, formatTick } from './charts/scale';
import { challengerNote, driversFinding, leaderboard, leaderboardFinding } from './model';

const f2 = (v: number | null | undefined) => formatMetricValue(v);

export interface ModelModulesProps {
  target: string;
  m: TargetMetrics;
  logisticId: string | null;
  byKey?: ReadonlyMap<string, FeatureSpec>;
  height: number;
  nFolds: number | null;
  provenance: string;
}

/** Cross-validated leaderboard as a dot-and-whisker list; the deployed row (id `ensemble`) is highlighted. */
export function LeaderboardModule({ target, m, logisticId, height, nFolds, provenance }: ModelModulesProps) {
  const { rows, reference } = leaderboard(m, logisticId);
  const note = challengerNote(rows, logisticId);
  const lo = Math.min(...rows.map((r) => r.mean - r.sd));
  const hi = Math.max(...rows.map((r) => r.mean + r.sd));
  const axis = niceAxis(lo, Math.min(1, hi), [0, 1]);
  const pos = (v: number) => ((Math.min(axis.domain[1], Math.max(axis.domain[0], v)) - axis.domain[0]) / (axis.domain[1] - axis.domain[0])) * 100;
  return (
    <ChartModule
      id="chart-leaderboard"
      title={leaderboardFinding(rows)}
      exportName={`cardiotwin-${target.toLowerCase()}-leaderboard`}
      exportImage={false}
      provenance={provenance}
      howTo={`How to read: cross-validated ROC-AUC, mean ± sd over ${nFolds ?? 'the'} identical folds for every model (paired comparison on the development set).${reference ? ` A no-skill reference scores ${f2(reference.mean)}.` : ''}`}
      height={height}
      table={{
        caption: `Cross-validated leaderboard for ${target}`,
        columns: ['Model', 'ROC-AUC mean', 'sd', 'Log-loss'],
        numeric: [false, true, true, true],
        rows: [...rows, ...(reference ? [reference] : [])].map((r) => [
          `${r.name}${r.deployed ? ' (deployed)' : ''}`,
          f2(r.mean),
          f2(r.sd),
          f2(r.logLoss),
        ]),
      }}
      footer={note ? <p className="text-label font-normal text-secondary text-pretty">{note}</p> : null}
    >
      <div className="flex h-full flex-col">
        <ol className="flex flex-1 flex-col justify-between" aria-label="Models ranked by cross-validated ROC-AUC">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                'relative grid grid-cols-[minmax(0,1fr)_minmax(96px,44%)_84px] items-center gap-3 rounded-sm py-px pl-2.5 pr-1 text-label font-normal',
                r.deployed ? 'bg-surface-2 text-primary' : 'text-secondary',
              )}
            >
              {r.deployed && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-accent" />}
              <Tooltip content={`${r.name}. ${r.description}`} placement="top">
                <span
                  tabIndex={0}
                  aria-label={`${r.name}${r.deployed ? ', deployed' : ''}`}
                  className={cn('min-w-0 truncate rounded-xs outline-none focus-visible:shadow-focus', r.deployed && 'font-semibold')}
                >
                  {r.short}
                </span>
              </Tooltip>
              <svg className="h-3 w-full overflow-visible" aria-hidden>
                <line x1={`${pos(r.mean - r.sd)}%`} x2={`${pos(r.mean + r.sd)}%`} y1="6" y2="6" stroke={r.deployed ? UI.textPrimary : UI.textTertiary} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx={`${pos(r.mean)}%`} cy="6" r="4" fill={r.deployed ? UI.accent : UI.textPrimary} stroke={UI.bgPanel} strokeWidth="2" />
              </svg>
              <span className="num whitespace-nowrap text-right">
                <span className={r.deployed ? 'text-primary' : 'text-secondary'}>{f2(r.mean)}</span>
                <span className="text-tertiary"> ± {f2(r.sd)}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(96px,44%)_84px] gap-3 pl-2.5 pr-1 pt-1.5 text-label font-normal text-tertiary" aria-hidden>
          <span>ROC-AUC</span>
          <span className="relative h-4">
            {axis.ticks.map((t) => (
              <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${pos(t)}%` }}>
                {formatTick(t, axis.step)}
              </span>
            ))}
          </span>
          <span />
        </div>
      </div>
    </ChartModule>
  );
}

/** Mean |SHAP| per input, human names only; values on hover (and in the table), never on the bars. */
export function DriversModule({ target, m, byKey, height, provenance }: ModelModulesProps) {
  const rows = m.global_importance.slice(0, 9);
  const max = Math.max(...rows.map((g) => g.mean_abs_shap), 1e-9);
  return (
    <ChartModule
      id="chart-drivers"
      title={driversFinding(target, m, byKey)}
      exportName={`cardiotwin-${target.toLowerCase()}-global-drivers`}
      exportImage={false}
      provenance={provenance}
      howTo="How to read: average absolute SHAP contribution across patients (log-odds); longer bars move estimates more, in either direction. Hover a bar for its value."
      height={height}
      table={{
        caption: `Global drivers for ${target}`,
        columns: ['Input', 'Mean |SHAP| (log-odds)'],
        numeric: [false, true],
        rows: m.global_importance.map((g) => [featureName(g.feature, byKey), f2(g.mean_abs_shap)]),
      }}
    >
      <ul className="flex h-full flex-col justify-between" aria-label={`Inputs that move ${target} estimates most`}>
        {rows.map((g) => {
          const name = featureName(g.feature, byKey);
          return (
            <li key={g.feature}>
              <Tooltip content={`${name}: mean |SHAP| ${f2(g.mean_abs_shap)} log-odds`} placement="right">
                <div
                  tabIndex={0}
                  aria-label={`${name}, mean absolute SHAP ${f2(g.mean_abs_shap)} log-odds`}
                  className="group grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] items-center gap-3 rounded-sm px-1 py-0.5 outline-none hover:bg-surface-1 focus-visible:shadow-focus"
                >
                  <span className="truncate text-label font-normal text-secondary group-hover:text-primary">{name}</span>
                  <span className="relative h-2.5">
                    <span
                      className="absolute inset-y-0 left-0 rounded-r-sm bg-[rgba(255,255,255,0.55)] group-hover:bg-[rgba(255,255,255,0.8)]"
                      style={{ width: `${(g.mean_abs_shap / max) * 100}%` }}
                    />
                  </span>
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </ChartModule>
  );
}
