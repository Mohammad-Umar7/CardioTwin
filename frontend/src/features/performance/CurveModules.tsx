import { formatMetricValue, formatPercent } from '@/lib/format';
import type { TargetMetrics } from '@/types/contracts';
import { ChartModule } from './charts/ChartModule';
import { XYChart, type HoverPoint, type XYMarker, type XYRule } from './charts/XYChart';
import type { CalibrationSummary } from './extras';
import {
  calibrationFinding,
  dcaFinding,
  pointMetrics,
  prFinding,
  rocFinding,
  type OperatingPoint,
} from './model';

const f2 = (v: number | null | undefined) => formatMetricValue(v);

export interface CurveProps {
  target: string;
  m: TargetMetrics;
  points: OperatingPoint[];
  /** Index into `points` of the deployed operating point. */
  deployed: number;
  /** Index being explored, or null when the deployed threshold is shown. */
  explore: number | null;
  onExplore(index: number | null): void;
  height: number;
  provenance: string;
  nTest: number;
}

function markersFor(
  points: OperatingPoint[],
  deployed: number,
  explore: number | null,
  map: (p: OperatingPoint) => [number, number] | null,
  placement?: { deployed: XYMarker['placement']; explore: XYMarker['placement'] },
): XYMarker[] {
  const out: XYMarker[] = [];
  const dep = points[deployed];
  const depXY = dep ? map(dep) : null;
  if (dep && depXY)
    out.push({ x: depXY[0], y: depXY[1], kind: 'operating', label: `deployed thr ${f2(dep.threshold)}`, placement: placement?.deployed });
  const ex = explore !== null && explore !== deployed ? points[explore] : undefined;
  const exXY = ex ? map(ex) : null;
  if (ex && exXY) out.push({ x: exXY[0], y: exXY[1], kind: 'explore', label: `exploring ${f2(ex.threshold)}`, placement: placement?.explore });
  return out;
}

const heldOut = (n: number) => `Held-out test, ${n} patients.`;

export function RocModule({ target, m, points, deployed, explore, onExplore, height, provenance, nTest }: CurveProps) {
  const P = m.confusion_matrix.tp + m.confusion_matrix.fn;
  const N = m.confusion_matrix.tn + m.confusion_matrix.fp;
  const roc = m.curves.roc;
  const opsSeries = {
    id: 'ops',
    label: 'Operating points',
    kind: 'hidden' as const,
    points: points.map((p) => [N ? p.fp / N : 0, P ? p.tp / P : 0] as const),
  };
  const readout = (h: HoverPoint) => {
    const p = points[h.index];
    if (!p) return '';
    const pm = pointMetrics(p);
    return `thr ${f2(p.threshold)} · sens ${f2(pm.sensitivity)} · spec ${f2(pm.specificity)}`;
  };
  return (
    <ChartModule
      id="chart-roc"
      title={rocFinding(target, m.test.roc_auc?.value)}
      howTo={`How to read: the higher the curve bows toward the top-left, the better; the diagonal is chance. ${heldOut(nTest)} Click a point to explore that threshold.`}
      legend={[
        { kind: 'main', label: 'Model' },
        ...(roc && m.curves.roc_band ? [{ kind: 'band' as const, label: 'Bootstrap confidence band' }] : []),
        { kind: 'reference', label: 'Chance' },
        { kind: 'operating', label: 'Deployed threshold' },
      ]}
      height={height}
      exportName={`cardiotwin-${target.toLowerCase()}-roc`}
      provenance={provenance}
      table={{
        caption: `ROC operating points for ${target}`,
        columns: ['Threshold', 'False-positive rate', 'True-positive rate', 'TP', 'FP'],
        numeric: [true, true, true, true, true],
        rows: [...points].reverse().map((p) => [
          `${f2(p.threshold)}${p.deployed ? ' (deployed)' : ''}`,
          f2(N ? p.fp / N : 0),
          f2(P ? p.tp / P : 0),
          p.tp,
          p.fp,
        ]),
      }}
    >
      <XYChart
        height={height}
        label={`ROC curve for ${target}`}
        summary={`ROC curve on the held-out test set; ROC-AUC ${f2(m.test.roc_auc?.value)}. The deployed threshold ${f2(m.threshold)} is marked.`}
        x={{ title: 'False-positive rate (1 − specificity)', domain: [0, 1], clamp: [0, 1] }}
        y={{ title: 'True-positive rate (sensitivity)', domain: [0, 1], clamp: [0, 1] }}
        band={
          m.curves.roc_band
            ? { label: 'Bootstrap band', x: m.curves.roc_band.fpr, low: m.curves.roc_band.tpr_low, high: m.curves.roc_band.tpr_high }
            : null
        }
        series={[
          { id: 'chance', label: 'Chance', kind: 'reference', points: [[0, 0], [1, 1]] },
          { id: 'roc', label: 'Model', kind: 'main', hover: false, points: roc.fpr.map((x, i) => [x, roc.tpr[i] ?? 0] as const) },
          opsSeries,
        ]}
        // A concave ROC leaves the area below-right and above-left of each point empty.
        markers={markersFor(points, deployed, explore, (p) => [N ? p.fp / N : 0, P ? p.tp / P : 0], {
          deployed: 'below-right',
          explore: 'above-left',
        })}
        readout={readout}
        onPick={(h) => onExplore(h.index)}
      />
    </ChartModule>
  );
}

export function PrModule({ target, m, points, deployed, explore, height, provenance, nTest, prevalence }: CurveProps & { prevalence: number | null }) {
  const pr = m.curves.pr;
  return (
    <ChartModule
      id="chart-pr"
      title={prFinding(target, m, prevalence)}
      howTo={`How to read: precision is the share of flagged patients who truly have the condition; the dashed line is the base rate. ${heldOut(nTest)}`}
      legend={[
        { kind: 'main', label: 'Model' },
        { kind: 'reference', label: 'Base rate (prevalence)' },
        { kind: 'operating', label: 'Deployed threshold' },
      ]}
      height={height}
      exportName={`cardiotwin-${target.toLowerCase()}-precision-recall`}
      provenance={provenance}
      table={{
        caption: `Precision–recall curve for ${target}`,
        columns: ['Recall', 'Precision'],
        numeric: [true, true],
        rows: pr.recall.map((r, i) => [f2(r), f2(pr.precision[i])]),
      }}
    >
      <XYChart
        height={height}
        label={`Precision–recall curve for ${target}`}
        summary={`Precision–recall curve on the held-out test set; average precision ${f2(m.test.pr_auc?.value)} against a base rate of ${formatPercent(prevalence)}.`}
        x={{ title: 'Recall (sensitivity)', domain: [0, 1], clamp: [0, 1] }}
        y={{ title: 'Precision (PPV)', domain: [0, 1], clamp: [0, 1] }}
        series={[
          ...(prevalence !== null
            ? [{ id: 'base', label: 'Base rate', kind: 'reference' as const, hover: false, points: [[0, prevalence], [1, prevalence]] as const }]
            : []),
          { id: 'pr', label: 'Model', kind: 'main', curve: 'step', points: pr.recall.map((r, i) => [r, pr.precision[i] ?? 0] as const) },
        ]}
        markers={markersFor(points, deployed, explore, (p) => {
          const pm = pointMetrics(p);
          return pm.sensitivity !== null && pm.ppv !== null ? [pm.sensitivity, pm.ppv] : null;
        })}
        readout={(h) => `recall ${f2(h.x)} · precision ${f2(h.y)}`}
      />
    </ChartModule>
  );
}

export function CalibrationModule({ target, m, height, provenance, nTest, summary }: Omit<CurveProps, 'points' | 'deployed' | 'explore' | 'onExplore'> & { summary: CalibrationSummary | null }) {
  const c = m.curves.calibration;
  const facts = [
    summary?.slope !== null && summary?.slope !== undefined ? `calibration slope ${f2(summary.slope)} (1 = ideal)` : null,
    summary?.ece !== null && summary?.ece !== undefined ? `expected calibration error ${f2(summary.ece)}` : null,
  ].filter(Boolean);
  return (
    <ChartModule
      id="chart-calibration"
      title={calibrationFinding(summary)}
      howTo={`How to read: dots on the diagonal mean the estimated probability matches how often the condition was present; dot size = patients per bin. ${heldOut(nTest)}${facts.length ? ` ${facts.join(', ')}.` : ''}`}
      legend={[
        { kind: 'main', label: 'Quantile bins' },
        { kind: 'reference', label: 'Perfect calibration' },
      ]}
      height={height}
      exportName={`cardiotwin-${target.toLowerCase()}-calibration`}
      provenance={provenance}
      table={{
        caption: `Calibration bins for ${target}`,
        columns: ['Mean estimate', 'Observed rate', 'Patients'],
        numeric: [true, true, true],
        rows: c.mean_predicted.map((p, i) => [f2(p), f2(c.fraction_positive[i]), c.count[i] ?? '–']),
      }}
    >
      <XYChart
        height={height}
        label={`Calibration plot for ${target}`}
        summary={`Reliability diagram with ${c.mean_predicted.length} quantile bins on the held-out test set.`}
        x={{ title: 'Estimated probability', domain: [0, 1], clamp: [0, 1] }}
        y={{ title: 'Observed rate', domain: [0, 1], clamp: [0, 1] }}
        series={[
          { id: 'perfect', label: 'Perfect calibration', kind: 'reference', hover: false, points: [[0, 0], [1, 1]] },
          {
            id: 'bins',
            label: 'Quantile bins',
            kind: 'main',
            dots: c.count,
            points: c.mean_predicted.map((p, i) => [p, c.fraction_positive[i] ?? 0] as const),
          },
        ]}
        readout={(h) => `estimated ${f2(h.x)} · observed ${f2(h.y)} · ${c.count[h.index] ?? '–'} patients`}
      />
    </ChartModule>
  );
}

export function DecisionCurveModule({ target, m, points, deployed, explore, height, provenance, nTest }: CurveProps) {
  const d = m.curves.dca;
  // Net benefit below zero is never useful; show a sliver under zero and clip the rest (Vickers' convention).
  const floor = -0.05;
  const allPts = d.thresholds
    .map((t, i) => [t, d.treat_all[i] ?? 0] as const)
    .filter(([, v]) => v >= floor);
  const rules: XYRule[] = [];
  const dep = points[deployed];
  if (dep) rules.push({ x: dep.threshold, kind: 'operating', label: `deployed thr ${f2(dep.threshold)}` });
  const ex = explore !== null && explore !== deployed ? points[explore] : undefined;
  if (ex) rules.push({ x: ex.threshold, kind: 'explore', label: `exploring ${f2(ex.threshold)}` });
  const yMax = Math.max(...d.model, ...allPts.map((p) => p[1]), 0.05);
  return (
    <ChartModule
      id="chart-dca"
      title={dcaFinding(m)}
      howTo={`How to read: net benefit counts true positives minus false positives weighted by the threshold's odds; the model helps wherever its curve is above both references. ${heldOut(nTest)}`}
      legend={[
        { kind: 'main', label: 'Model' },
        { kind: 'secondary', label: 'Treat all' },
        { kind: 'reference', label: 'Treat none' },
      ]}
      height={height}
      exportName={`cardiotwin-${target.toLowerCase()}-decision-curve`}
      provenance={provenance}
      table={{
        caption: `Decision curve for ${target}`,
        columns: ['Threshold', 'Model', 'Treat all', 'Treat none'],
        numeric: [true, true, true, true],
        rows: d.thresholds
          .map((t, i) => [f2(t), f2(d.model[i]), f2(d.treat_all[i]), f2(d.treat_none[i])])
          .filter((_, i) => i % 5 === 0),
      }}
    >
      <XYChart
        height={height}
        label={`Decision curve for ${target}`}
        summary={`Net benefit of the model against treat-all and treat-none across threshold probabilities, held-out test set.`}
        hoverMode="x"
        x={{ title: 'Threshold probability', domain: [0, 1], clamp: [0, 1] }}
        y={{ title: 'Net benefit', domain: [floor, yMax], clamp: [floor, 1] }}
        series={[
          { id: 'none', label: 'Treat none', kind: 'reference', hover: false, points: d.thresholds.map((t, i) => [t, d.treat_none[i] ?? 0] as const) },
          { id: 'all', label: 'Treat all', kind: 'secondary', hover: false, points: allPts },
          { id: 'model', label: 'Model', kind: 'main', points: d.thresholds.map((t, i) => [t, d.model[i] ?? 0] as const) },
        ]}
        rules={rules}
        readout={(h) => {
          const i = h.index;
          return `thr ${f2(d.thresholds[i])} · model ${f2(d.model[i])} · treat all ${f2(d.treat_all[i])}`;
        }}
      />
    </ChartModule>
  );
}
