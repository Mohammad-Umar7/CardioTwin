import { RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { Slider } from '@/design';
import { cn } from '@/lib/cn';
import { formatMetricValue, formatPercent, MINUS } from '@/lib/format';
import type { TargetMetrics } from '@/types/contracts';
import { ChartModule } from './charts/ChartModule';
import { confusionFinding, pointMetrics, type OperatingPoint, type PointMetrics } from './model';

const f2 = (v: number | null | undefined) => formatMetricValue(v);

export interface DecisionProps {
  target: string;
  m: TargetMetrics;
  points: OperatingPoint[];
  deployed: number;
  explore: number | null;
  onExplore(index: number | null): void;
  height: number;
  nTest: number;
}

/** 2 × 2 confusion matrix at the current threshold: correct cells tinted, errors hatched, never red. */
export function ConfusionModule({ target, m, points, deployed, explore, height, nTest }: Omit<DecisionProps, 'onExplore'>) {
  const p = points[explore ?? deployed] ?? points[deployed];
  const noun = target === 'CAD' ? 'CAD' : `${target} stenosis`;
  if (!p) return null;
  const exploring = explore !== null && explore !== deployed;
  const cell = (label: string, n: number, correct: boolean, hint: string) => (
    <td
      className={cn(
        'rounded-md px-3 text-left align-middle',
        correct ? 'bg-[var(--accent-subtle)]' : 'hatch bg-surface-2',
      )}
    >
      <div className="text-label font-normal text-secondary">{label}</div>
      <div className="num font-display text-title-2 text-primary">{n}</div>
      <div className="text-label font-normal text-tertiary">{hint}</div>
    </td>
  );
  return (
    <ChartModule
      id="chart-confusion"
      title={exploring ? `At threshold ${f2(p.threshold)}: ${p.tp} of ${p.tp + p.fn} flagged, ${p.fp} false alarms` : confusionFinding(target, m)}
      howTo={`How to read: rows are the angiography result, columns the model's call ${exploring ? `at the explored threshold ${f2(p.threshold)}` : `at the deployed threshold ${f2(p.threshold)}`}. Correct cells are tinted, errors hatched. Held-out test, ${nTest} patients.`}
      height={height}
      table={{
        caption: `Confusion matrix for ${target}`,
        columns: ['Angiography', 'Flagged', 'Not flagged'],
        numeric: [false, true, true],
        rows: [
          [`${noun}`, p.tp, p.fn],
          [`No ${noun}`, p.fp, p.tn],
        ],
      }}
    >
      <table className="h-full w-full table-fixed border-separate border-spacing-1.5">
        <caption className="sr-only">Confusion matrix</caption>
        <thead>
          <tr className="text-label font-normal text-tertiary">
            <th className="w-[34%]">
              <span className="sr-only">Angiography result</span>
            </th>
            <th scope="col" className="pb-0.5 text-left font-medium">
              Flagged
            </th>
            <th scope="col" className="pb-0.5 text-left font-medium">
              Not flagged
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="pr-2 text-left text-label font-medium text-secondary">
              {noun} at angiography
              <span className="block font-normal text-tertiary">{p.tp + p.fn} patients</span>
            </th>
            {cell('True positive', p.tp, true, 'caught')}
            {cell('False negative', p.fn, false, 'missed')}
          </tr>
          <tr>
            <th scope="row" className="pr-2 text-left text-label font-medium text-secondary">
              No {noun}
              <span className="block font-normal text-tertiary">{p.fp + p.tn} patients</span>
            </th>
            {cell('False positive', p.fp, false, 'false alarm')}
            {cell('True negative', p.tn, true, 'correctly clear')}
          </tr>
        </tbody>
      </table>
    </ChartModule>
  );
}

function Delta({ now, base }: { now: number | null; base: number | null }) {
  if (now === null || base === null) return null;
  const d = now - base;
  if (Math.abs(d) < 0.005) return <span className="text-label font-normal text-tertiary">same</span>;
  return (
    <span className="num text-label font-normal text-secondary">
      {d > 0 ? '▲ +' : `▼ ${MINUS}`}
      {Math.abs(d).toFixed(2)}
    </span>
  );
}

function Metric({ label, now, base, hint, exploring }: { label: string; now: number | null; base: number | null; hint: string; exploring: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface-1 px-3 py-2.5">
      <span className="text-label text-tertiary">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="num font-display text-title-2 text-primary">{f2(now)}</span>
        {exploring && <Delta now={now} base={base} />}
      </span>
      <span className="truncate text-label font-normal text-tertiary">{hint}</span>
    </div>
  );
}

/**
 * Threshold explorer (LUMEN §4.4 "one linked threshold"): a slider over the exact held-out operating
 * points. Moving it updates the confusion matrix and the ROC, PR and decision-curve markers; the
 * deployed threshold never changes, and "Back to deployed" snaps back.
 */
export function ThresholdExplorer({ target, points, deployed, explore, onExplore, height, nTest }: Omit<DecisionProps, 'm'>) {
  const sliderId = useId();
  const idx = explore ?? deployed;
  const p = points[idx];
  const dep = points[deployed];
  if (!p || !dep) return null;
  const now: PointMetrics = pointMetrics(p);
  const base: PointMetrics = pointMetrics(dep);
  const exploring = idx !== deployed;
  const noun = target === 'CAD' ? 'CAD' : `${target} stenosis`;

  const set = (i: number) => onExplore(i === deployed ? null : Math.max(0, Math.min(points.length - 1, i)));

  let title = `The deployed threshold ${f2(dep.threshold)} maximises sensitivity + specificity on development folds`;
  if (exploring) {
    const dCaught = p.tp - dep.tp;
    const dAlarms = p.fp - dep.fp;
    const caught = dCaught === 0 ? 'the same patients caught' : `${Math.abs(dCaught)} ${dCaught > 0 ? 'more' : 'fewer'} with ${noun} caught`;
    const alarms = dAlarms === 0 ? 'no change in false alarms' : `${Math.abs(dAlarms)} ${dAlarms > 0 ? 'more' : 'fewer'} false alarm${Math.abs(dAlarms) === 1 ? '' : 's'}`;
    title = `At ${f2(p.threshold)}: ${caught}, ${alarms}`;
  }

  return (
    <ChartModule
      id="chart-threshold"
      title={title}
      howTo={`How to read: drag to any operating point recorded on the ${nTest} held-out patients; the confusion matrix and every chart marker follow. The deployed model is unchanged.`}
      height={height}
      aside={
        exploring ? (
          <button
            type="button"
            onClick={() => onExplore(null)}
            className="mr-1 inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-accent/60 px-2.5 text-label text-accent hover:bg-surface-2"
          >
            <RotateCcw aria-hidden className="size-3.5 stroke-[1.5]" />
            Back to deployed {f2(dep.threshold)}
          </button>
        ) : null
      }
      table={{
        caption: `Operating points for ${target}`,
        columns: ['Threshold', 'Sensitivity', 'Specificity', 'PPV', 'NPV', 'Net benefit'],
        numeric: [true, true, true, true, true, true],
        rows: points.map((op) => {
          const pm = pointMetrics(op);
          return [
            `${f2(op.threshold)}${op.deployed ? ' (deployed)' : ''}`,
            f2(pm.sensitivity),
            f2(pm.specificity),
            f2(pm.ppv),
            f2(pm.npv),
            f2(pm.netBenefit),
          ];
        }),
      }}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-label font-normal text-tertiary">
            <label htmlFor={sliderId} className="text-secondary">
              Decision threshold <span className="num text-primary">{f2(p.threshold)}</span>
              <span className="text-tertiary"> · flags {formatPercent(now.n ? now.flagged / now.n : null)} of patients</span>
            </label>
            <span>
              {idx + 1} / {points.length}
            </span>
          </div>
          <Slider
            id={sliderId}
            label="Decision threshold"
            value={idx}
            min={0}
            max={points.length - 1}
            step={1}
            ghost={exploring ? deployed : null}
            onChange={set}
            formatBubble={(i) => f2(points[i]?.threshold)}
            valueText={`threshold ${f2(p.threshold)}, sensitivity ${f2(now.sensitivity)}, specificity ${f2(now.specificity)}${p.deployed ? ', deployed' : ''}`}
          />
          <div className="flex justify-between text-label font-normal text-tertiary">
            <span>Flag more (lower threshold)</span>
            <span>Flag fewer</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Metric label="Sensitivity" now={now.sensitivity} base={base.sensitivity} exploring={exploring} hint={`${p.tp} of ${p.tp + p.fn} caught`} />
          <Metric label="Specificity" now={now.specificity} base={base.specificity} exploring={exploring} hint={`${p.tn} of ${p.tn + p.fp} cleared`} />
          <Metric label="PPV" now={now.ppv} base={base.ppv} exploring={exploring} hint="flagged who have it" />
          <Metric label="NPV" now={now.npv} base={base.npv} exploring={exploring} hint="cleared who do not" />
        </div>
      </div>
    </ChartModule>
  );
}
