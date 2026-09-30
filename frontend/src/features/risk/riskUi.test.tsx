import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplainDrawer } from '@/features/explain/ExplainDrawer';
import { cohortResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { jsonResponse, sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import type { PredictResponse } from '@/types/contracts';
import { AnswerPill } from './AnswerPill';
import { RiskSummaryCard } from './RiskSummaryCard';
import { VesselInspector } from './VesselInspector';

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('schema.json')) return Promise.resolve(jsonResponse(sampleSchema));
      if (url.includes('cohort.json')) return Promise.resolve(jsonResponse(sampleCohort));
      return Promise.resolve(new Response('', { status: 404 }));
    }),
  );
  await schemaResource.get();
  await cohortResource.get();
});

beforeEach(() => {
  usePatientStore.getState().loadPatient(sampleCohort.patients[0]!); // P-017, held-out TEST
  usePatientStore.setState({ prediction: null, previous: null, recordedPrediction: null, status: 'idle', error: null, engineStatus: 'server' });
  useViewerStore.setState({ selectedStructure: null, hoveredStructure: null, isolate: false, ghostOthers: false });
  useUiStore.setState({ chrome: 'workstation', drawer: null, explainTab: 'why', patientCardOpen: true });
});

const predict = (p: PredictResponse = samplePrediction) => act(() => usePatientStore.getState().predictionSucceeded(p, 5));

/** V2 §10.3 probe 2, over the rendered DOM. */
const probCounts = (root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('[data-prob]')].reduce<Record<string, number>>(
    (a, e) => ((a[e.dataset.prob!] = (a[e.dataset.prob!] ?? 0) + 1), a),
    {},
  );

describe('Risk summary card (WORKSTATION_V2 §5.8)', () => {
  it('answers with the numeral, band chip, verdict line and "k of 3 flagged"', () => {
    predict();
    render(<RiskSummaryCard />);
    const card = screen.getByRole('region', { name: /coronary artery disease/i });
    expect(within(card).getByText('87 percent')).toBeInTheDocument();
    expect(within(card).getByText('Very high')).toBeInTheDocument();
    expect(card).toHaveTextContent(/● ?Flagged — above the 46\s% threshold/);
    // sample: LAD label 1, LCX 0, RCA 1
    expect(within(card).getByText('2 of 3 flagged')).toBeInTheDocument();
    expect(within(card).getByText('Model estimate')).toBeInTheDocument();
  });

  it('never uses the retired vocabulary or the expected-vessels sum', () => {
    predict();
    render(<RiskSummaryCard />);
    const text = screen.getByRole('region', { name: /coronary artery disease/i }).textContent ?? '';
    expect(text).not.toMatch(/likely|positive|diagnos|≈|expected|P\(stenosis\)/i);
  });

  it('gives every probability exactly one data-prob home, and none while the Explain drawer covers the card', () => {
    predict();
    const { rerender } = render(<RiskSummaryCard />);
    expect(probCounts()).toEqual({ CAD: 1, LAD: 1, LCX: 1, RCA: 1 });
    act(() => useUiStore.getState().openDrawer('explain'));
    rerender(<RiskSummaryCard />);
    expect(probCounts()).toEqual({});
  });

  it('marks the recorded value as a baseline, not a second home of P(CAD)', () => {
    predict();
    act(() => usePatientStore.getState().setFeature('BP', 180));
    predict({ ...samplePrediction, predictions: { ...samplePrediction.predictions, CAD: { ...samplePrediction.predictions.CAD!, probability: 0.8 } } });
    render(<RiskSummaryCard />);
    const was = document.querySelector('[data-baseline="CAD"]');
    expect(was).toHaveTextContent(/^87\s%$/);
    expect(screen.getByText(/▼ −7/)).toBeInTheDocument();
    expect(probCounts().CAD).toBe(1);
  });

  it('shows "Estimate unavailable" and no number when no engine can answer', () => {
    usePatientStore.setState({ status: 'error', error: 'server offline', engineStatus: 'unavailable' });
    render(<RiskSummaryCard />);
    expect(screen.getByText('Estimate unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/percent/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  });

  it('selects a vessel from its row and hides the narrative while one is selected', async () => {
    predict();
    render(<RiskSummaryCard />);
    const lad = screen.getByRole('button', { name: /Left anterior descending artery, 72 percent, flagged, above the 50 percent threshold/ });
    expect(screen.getByText(/Driven mostly by/)).toBeInTheDocument();
    await userEvent.click(lad);
    expect(useViewerStore.getState().selectedStructure).toBe('LAD');
    expect(lad).toHaveAttribute('aria-pressed', 'true');
  });

  it('reveals the cath result for a TEST patient and counts agreement against the recorded inputs', async () => {
    predict();
    render(<RiskSummaryCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Reveal cath result' }));
    // P-017 truth: CAD 1, LAD 1, LCX 0, RCA 1; sample labels: 1, 1, 0, 1 → 4 of 4
    expect(screen.getByRole('button', { name: 'Cath agrees on 4 of 4' })).toBeInTheDocument();
    expect(screen.getAllByText('agrees ✓').length).toBeGreaterThanOrEqual(3);
  });

  it('offers no Reveal for a development patient', () => {
    act(() => usePatientStore.getState().loadPatient(sampleCohort.patients[1]!));
    predict();
    render(<RiskSummaryCard />);
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
  });
});

describe('Vessel inspector (§5.9)', () => {
  it('reconciles the band with the vessel threshold in one sentence and carries no probability numeral', () => {
    predict();
    act(() => useViewerStore.getState().select('LAD'));
    render(<VesselInspector />);
    const card = document.querySelector('[data-region="inspector"]')!;
    expect(card).toHaveTextContent(/High probability band \(50–75\s%\)\. ● ?Flagged: above LAD's 50\s% threshold/);
    expect(card.querySelector('[data-prob]')).toBeNull();
    expect(card).not.toHaveTextContent('72');
  });

  it('shows the top drivers only while the patient card is collapsed', () => {
    predict();
    act(() => useViewerStore.getState().select('LAD'));
    const { rerender } = render(<VesselInspector />);
    expect(screen.queryByText('Top drivers')).not.toBeInTheDocument();
    act(() => useUiStore.getState().setPatientCardOpen(false));
    rerender(<VesselInspector />);
    expect(screen.getByText('Top drivers')).toBeInTheDocument();
  });

  it('renders nothing without a selection', () => {
    predict();
    render(<VesselInspector />);
    expect(document.querySelector('[data-region="inspector"]')).toBeNull();
  });
});

describe('Answer pill (§5.16)', () => {
  it('is the only home of P(CAD) in focus mode', () => {
    predict();
    act(() => useUiStore.getState().setChrome('focus'));
    render(
      <>
        <RiskSummaryCard />
        <AnswerPill />
      </>,
    );
    expect(probCounts()).toEqual({ CAD: 1 });
    expect(screen.getByText('2 of 3 flagged')).toBeInTheDocument();
    expect(document.querySelector('[data-region="risk-card"]')).toBeNull();
  });
});

describe('Explain drawer (§5.10)', () => {
  it('titles the Why tab with the takeaway and makes it the home of the target probability', () => {
    predict();
    act(() => useUiStore.getState().openDrawer('explain', { tab: 'why' }));
    render(
      <MemoryRouter>
        <ExplainDrawer />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(/CAD .*87.* is driven mostly by typical chest pain/);
    expect(probCounts(dialog)).toEqual({ CAD: 1 });
    expect(within(dialog).getByText('Raising risk')).toBeInTheDocument();
    expect(within(dialog).getByText('Lowering risk')).toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: /data modality/ })).toBeInTheDocument();
  });

  it('follows the selection and switches tabs with takeaway titles', async () => {
    predict();
    act(() => {
      useViewerStore.getState().select('LAD');
      useUiStore.getState().openDrawer('explain', { tab: 'why' });
    });
    render(
      <MemoryRouter>
        <ExplainDrawer />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog');
    expect(probCounts(dialog)).toEqual({ LAD: 1 });
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Model' }));
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('How this estimate is made');
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Physiology' }));
    // P-017: BP 140 (above 90–120) and EF 45 (below 50–70) are outside the sample ranges
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('2 values outside the normal range');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'CAD' }));
    expect(useViewerStore.getState().selectedStructure).toBeNull();
  });
});
