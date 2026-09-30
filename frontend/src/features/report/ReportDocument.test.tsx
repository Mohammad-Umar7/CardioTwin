import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sampleCohort, sampleMetrics, samplePrediction, sampleSchema } from '@/test/fixtures';
import type { Explanation, PredictResponse } from '@/types/contracts';
import { ReportDocument } from './ReportDocument';
import { normalisePerformance } from './performance';
import { buildReport, type ReportInput } from './reportModel';

const logit = (p: number) => Math.log(p / (1 - p));
function withCalibration(pred: PredictResponse, a = 1.25): PredictResponse {
  const explanations: Record<string, Explanation> = {};
  for (const [t, e] of Object.entries(pred.explanations)) {
    const b = logit(pred.predictions[t]!.probability) - a * e.output_value;
    explanations[t] = {
      ...e,
      calibrated_base_value: a * e.base_value + b,
      calibrated_output_value: a * e.output_value + b,
      contributions: e.contributions.map((c) => ({ ...c, shap_calibrated: a * c.shap })),
    } as Explanation;
  }
  return { ...pred, explanations };
}

const patient = sampleCohort.patients[0]!;
const base: ReportInput = {
  schema: sampleSchema,
  features: { ...patient.features },
  recorded: { ...patient.features },
  prediction: withCalibration(samplePrediction),
  status: 'ready',
  engineStatus: 'server',
  patient: { id: patient.id, split: patient.split, summary: patient.summary },
  mode: 'cohort',
  generatedAt: new Date(2026, 8, 30, 10, 42),
};
const perf = normalisePerformance(sampleMetrics);

function renderReport(overrides: Partial<ReportInput> = {}) {
  return render(<ReportDocument model={buildReport({ ...base, ...overrides })} perf={perf} />);
}

describe('ReportDocument (clinical-safety invariants)', () => {
  it('prints the disclaimer prominently and on every page', () => {
    const { container } = renderReport();
    expect(screen.getByRole('complementary', { name: 'Clinical safety disclaimer' })).toHaveTextContent(
      'Decision support & education only — not a diagnosis; not a substitute for angiography, CTCA or formal diagnostic imaging',
    );
    const footers = container.querySelectorAll('footer');
    expect(footers).toHaveLength(2);
    footers.forEach((f) => expect(f).toHaveTextContent('Not a diagnosis.'));
    expect(screen.getAllByText('NOT FOR DIAGNOSTIC USE')).toHaveLength(2);
    expect(screen.getByText('Model estimate')).toBeInTheDocument();
  });

  it('never uses "diagnosis" except to say it is not one', () => {
    const text = renderReport().container.textContent ?? '';
    const all = text.match(/diagnosis/gi) ?? [];
    const negated = text.match(/not a diagnosis/gi) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBe(negated.length);
    expect(text).not.toMatch(/critical/i);
  });

  it('renders each probability numeral exactly once (data-prob contract)', () => {
    const { container } = renderReport();
    const probs = [...container.querySelectorAll('[data-prob]')].map((e) => e.getAttribute('data-prob'));
    expect(probs.sort()).toEqual(['CAD', 'LAD', 'LCX', 'RCA']);
  });

  it('keeps risk colour off text: no inline text colour, and schematic text is ink', () => {
    const { container } = renderReport();
    const coloured = [...container.querySelectorAll<HTMLElement>('[style]')].filter((e) =>
      /(^|;)\s*color\s*:/.test(e.getAttribute('style') ?? ''),
    );
    expect(coloured).toEqual([]);
    const fills = [...container.querySelectorAll('svg text')].map((t) => t.getAttribute('fill'));
    expect(fills.length).toBeGreaterThan(0);
    fills.forEach((f) => expect(['#0B0E12', '#58626F']).toContain(f));
  });

  it('uses the V2 vocabulary for decisions and bands', () => {
    renderReport();
    expect(screen.getByText(/Flagged — above the 46\s%\sthreshold/)).toBeInTheDocument();
    expect(screen.getAllByText('Very high').length).toBeGreaterThan(0);
    expect(screen.getByText('2 of 3 flagged')).toBeInTheDocument();
  });

  it('shows no estimate while an update is in flight', () => {
    const { container } = renderReport({ status: 'loading' });
    expect(container.querySelectorAll('[data-prob]')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Updating.');
    expect(screen.queryByText(/What drives each estimate/i)).toBeNull();
  });
});
