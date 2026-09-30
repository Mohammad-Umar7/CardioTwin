import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, SegmentedControl, Skeleton, Stat, Tabs, Tooltip } from '@/design';
import { useMetrics } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatCi, formatMetricValue, formatPercent } from '@/lib/format';
import { ROUTES } from '@/routes';
import { TARGET_ORDER, type TargetMetrics } from '@/types/contracts';
import { LineChart } from './LineChart';

function ChartFrame({ title, howTo, children }: { title: string; howTo: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-title-2 text-primary">{title}</h2>
      <p className="text-label font-normal text-tertiary">How to read: {howTo}</p>
      {children}
    </Card>
  );
}

function Tiles({ m, split }: { m: TargetMetrics; split: 'test' | 'cv' }) {
  const t = m.test;
  const cv = m.cv;
  const cm = m.confusion_matrix;
  const cell = (name: string, label: string, def: string, sub?: ReactNode) => {
    const value = split === 'test' ? t[name]?.value : cv[name]?.mean;
    const extra = split === 'test' ? formatCi(t[name]?.ci) : cv[name] ? `± ${formatMetricValue(cv[name]?.std)}` : '';
    return (
      <Tooltip content={def}>
        <div tabIndex={0} className="rounded-md border border-hairline bg-panel px-4 py-3 outline-none">
          <Stat
            label={label}
            value={
              <span className="num">
                {formatMetricValue(value)} <span className="text-body-s font-medium text-tertiary">{extra}</span>
              </span>
            }
            sub={sub}
          />
        </div>
      </Tooltip>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cell('roc_auc', 'ROC-AUC', 'Probability that a random diseased patient is ranked above a random healthy one.', cv.roc_auc ? `CV ${formatMetricValue(cv.roc_auc.mean)} ± ${formatMetricValue(cv.roc_auc.std)}` : undefined)}
      {cell('pr_auc', 'PR-AUC', 'Average precision across recall levels; compare with the prevalence baseline.')}
      {cell('f1', `F1 @ thr ${formatMetricValue(m.threshold)}`, 'Harmonic mean of precision and recall at the deployed threshold.', t.precision ? `precision ${formatMetricValue(t.precision.value)}` : undefined)}
      {cell('recall', 'Sensitivity', 'Share of diseased patients flagged at the deployed threshold.', `FN ${cm.fn} of ${cm.fn + cm.tp}`)}
      {cell('specificity', 'Specificity', 'Share of healthy patients correctly not flagged.', `FP ${cm.fp} of ${cm.fp + cm.tn}`)}
      {cell('brier', 'Brier · lower = better', 'Mean squared error of the calibrated probabilities.', t.mcc ? `MCC ${formatMetricValue(t.mcc.value)}` : undefined)}
    </div>
  );
}

function Confusion({ m }: { m: TargetMetrics }) {
  const { tn, fp, fn, tp } = m.confusion_matrix;
  const c = (label: string, n: number, correct: boolean) => (
    <td className={cn('h-14 rounded-sm text-center', correct ? 'bg-[var(--accent-subtle)]' : 'hatch bg-surface-2')}>
      <div className="text-label font-normal text-secondary">{label}</div>
      <div className="num font-numeral text-numeral-l text-primary">{n}</div>
    </td>
  );
  return (
    <table className="w-full border-separate border-spacing-1 text-body-s">
      <caption className="sr-only">Confusion matrix at the deployed threshold</caption>
      <thead>
        <tr className="text-label text-tertiary">
          <th />
          <th scope="col" className="font-medium">
            predicted −
          </th>
          <th scope="col" className="font-medium">
            predicted +
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="pr-2 text-left text-label font-medium text-tertiary">
            actual −
          </th>
          {c('TN', tn, true)}
          {c('FP', fp, false)}
        </tr>
        <tr>
          <th scope="row" className="pr-2 text-left text-label font-medium text-tertiary">
            actual +
          </th>
          {c('FN', fn, false)}
          {c('TP', tp, true)}
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Model performance (DESIGN_SYSTEM §4.4), foundation version: every number is read from metrics.json —
 * KPI tiles with CIs (held-out test) or mean ± sd (5-fold CV), neutral ROC / PR / calibration / decision
 * curves, the confusion matrix, the CV leaderboard and the validation protocol. Phase 2 adds the linked
 * what-if threshold, table views and exports.
 */
export default function PerformancePage() {
  const metrics = useMetrics();
  const [target, setTarget] = useState<string>('CAD');
  const [split, setSplit] = useState<'test' | 'cv'>('test');
  const m = metrics.data?.targets[target];
  const ds = metrics.data?.dataset;

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-6 py-6">
      <header className="flex flex-col gap-3 animate-rise-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="overline text-accent">Model performance</p>
            <h1 className="font-display text-display-2 text-primary">How well does it separate diseased from healthy?</h1>
            <p className="mt-1 text-body text-secondary">On patients it never saw: the held-out test split was scored once, after every decision was frozen.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              idBase="perf-target"
              label="Target"
              value={target}
              onChange={setTarget}
              items={TARGET_ORDER.map((t) => ({ value: t, label: t }))}
            />
            <SegmentedControl
              label="Evaluation split"
              value={split}
              onChange={(v) => setSplit(v as 'test' | 'cv')}
              options={[
                { value: 'test', label: `Held-out test${ds ? ` n=${ds.n_test}` : ''}` },
                { value: 'cv', label: `5-fold CV${ds ? ` · dev n=${ds.n_dev}` : ''}` },
              ]}
            />
          </div>
        </div>
        {m && <p className="text-label font-normal text-tertiary">{m.selected_model} · deployed threshold {formatPercent(m.threshold)}</p>}
      </header>

      {metrics.status === 'loading' && (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {(metrics.status === 'missing' || metrics.status === 'error') && (
        <EmptyState title="Evaluation report not published yet">
          <span className="mono">model/metrics.json</span> is produced by the ML pipeline (<span className="mono">ml/</span>). Run
          the training pipeline or start the API to see the numbers here.
        </EmptyState>
      )}

      {m && (
        <>
          <Tiles m={m} split={split} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartFrame title="ROC · 95 % bootstrap band" howTo="the closer the curve hugs the top-left corner, the better; the diagonal is chance.">
              <LineChart
                xLabel="False-positive rate"
                yLabel="True-positive rate"
                band={
                  m.curves.roc_band
                    ? { x: m.curves.roc_band.fpr, low: m.curves.roc_band.tpr_low, high: m.curves.roc_band.tpr_high }
                    : null
                }
                series={[
                  { id: 'roc', label: `${target} model`, x: m.curves.roc.fpr, y: m.curves.roc.tpr },
                  { id: 'chance', label: 'Chance', x: [0, 1], y: [0, 1], kind: 'reference' },
                ]}
                summary={`ROC curve for ${target}; test ROC-AUC ${formatMetricValue(m.test.roc_auc?.value)}.`}
              />
            </ChartFrame>
            <ChartFrame title="Precision–recall · baseline = prevalence" howTo="precision stays high across recall when the model ranks well; the dashed line is prevalence.">
              <LineChart
                xLabel="Recall"
                yLabel="Precision"
                series={[
                  { id: 'pr', label: `${target} model`, x: m.curves.pr.recall, y: m.curves.pr.precision },
                  {
                    id: 'base',
                    label: `Prevalence ${formatMetricValue(ds?.prevalence[target])}`,
                    x: [0, 1],
                    y: [ds?.prevalence[target] ?? 0, ds?.prevalence[target] ?? 0],
                    kind: 'reference',
                  },
                ]}
                summary={`Precision-recall curve for ${target}; test PR-AUC ${formatMetricValue(m.test.pr_auc?.value)}.`}
              />
            </ChartFrame>
            <ChartFrame title="Calibration · reliability" howTo="points on the diagonal mean predicted probabilities match observed frequencies; point size = patients in the bin.">
              <LineChart
                xLabel="Predicted probability"
                yLabel="Observed frequency"
                series={[
                  {
                    id: 'cal',
                    label: 'Quantile bins',
                    x: m.curves.calibration.mean_predicted,
                    y: m.curves.calibration.fraction_positive,
                    points: true,
                    sizes: m.curves.calibration.count,
                  },
                  { id: 'perfect', label: 'Perfect calibration', x: [0, 1], y: [0, 1], kind: 'reference' },
                ]}
                summary={`Calibration curve for ${target}; Brier score ${formatMetricValue(m.test.brier?.value)}.`}
              />
            </ChartFrame>
            <ChartFrame title="Decision curve · net benefit" howTo="the model helps wherever its curve is above both 'treat all' and 'treat none'.">
              <LineChart
                xLabel="Threshold probability"
                yLabel="Net benefit"
                yDomain={[
                  Math.min(0, ...m.curves.dca.model, ...m.curves.dca.treat_all.filter((v) => v > -0.5)),
                  Math.max(0.05, ...m.curves.dca.model, ...m.curves.dca.treat_all),
                ]}
                series={[
                  { id: 'model', label: 'Model', x: m.curves.dca.thresholds, y: m.curves.dca.model },
                  { id: 'all', label: 'Treat all', x: m.curves.dca.thresholds, y: m.curves.dca.treat_all.map((v) => Math.max(v, -0.5)), kind: 'secondary' },
                  { id: 'none', label: 'Treat none', x: m.curves.dca.thresholds, y: m.curves.dca.treat_none, kind: 'reference' },
                ]}
                summary={`Decision curve for ${target}.`}
              />
            </ChartFrame>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartFrame title={`Confusion @ thr ${formatMetricValue(m.threshold)}`} howTo="correct cells are tinted; errors are hatched (never red).">
              <Confusion m={m} />
            </ChartFrame>
            <ChartFrame title="Leaderboard · 5-fold CV ROC-AUC" howTo="mean ± sd over repeated cross-validation on the development set; identical folds for every model.">
              <ol className="flex flex-col gap-1">
                {[...m.leaderboard]
                  .sort((a, b) => b.roc_auc_mean - a.roc_auc_mean)
                  .map((row, i) => (
                    <li key={row.model} className={cn('flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-body-s', i === 0 && 'border-l-2 border-accent bg-surface-2')}>
                      <span className="truncate text-secondary">{row.label ?? row.model}</span>
                      <span className="num whitespace-nowrap text-primary">
                        {formatMetricValue(row.roc_auc_mean)} <span className="text-tertiary">± {formatMetricValue(row.roc_auc_std)}</span>
                      </span>
                    </li>
                  ))}
              </ol>
            </ChartFrame>
            <ChartFrame title="Global drivers · mean |SHAP|" howTo="average absolute contribution across patients, in log-odds.">
              <ul className="flex flex-col gap-1">
                {m.global_importance.slice(0, 8).map((g) => {
                  const max = m.global_importance[0]?.mean_abs_shap || 1;
                  return (
                    <li key={g.feature} className="grid grid-cols-[minmax(0,1fr)_120px_44px] items-center gap-2 text-body-s">
                      <span className="truncate text-secondary">{g.feature}</span>
                      <span className="h-2 rounded-xs bg-secondary/70" style={{ width: `${(g.mean_abs_shap / max) * 100}%` }} />
                      <span className="num text-right text-numeral-m text-primary">{g.mean_abs_shap.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
            </ChartFrame>
          </div>
          <Card className="flex flex-col gap-2" id="protocol">
            <h2 className="overline text-tertiary">Protocol</h2>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body-s text-secondary md:grid-cols-2">
              {[
                'LAD / LCX / RCA / Cath are never inputs (unit-tested)',
                `Stratified hold-out ${ds ? `${ds.n_dev} / ${ds.n_test}` : ''}, seed ${metrics.data?.protocol.seed ?? 42}`,
                'Test split scored once, after every decision was frozen',
                'Label check: Cath = CAD ⇔ ≥ 1 stenotic vessel',
                'Edge / server parity on fixtures: |Δp| < 1e-6',
                'Thresholds tuned on development folds only',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
            <Link to={ROUTES.methodology} className="self-end text-label font-semibold text-accent hover:text-accent-hover">
              Methodology ›
            </Link>
          </Card>
          <p className="text-label font-normal text-tertiary">
            Single-centre cohort (n = {ds?.n ?? 303}), not externally validated · decision support and education only, not a
            diagnosis.
          </p>
        </>
      )}
    </div>
  );
}
