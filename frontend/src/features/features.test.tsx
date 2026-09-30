import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cohortResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { jsonResponse, sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import { NarrativeSentence } from './explain/NarrativeSentence';
import { ClinicalForm } from './patient/ClinicalForm';
import { WhatIfBar } from './patient/WhatIfBar';
import { CADHeroCard } from './risk/CADHeroCard';
import { VesselList } from './risk/VesselList';
import { StatusLine } from './shell/DisclaimerBanner';
import { DisclaimerModal } from './shell/DisclaimerModal';

beforeAll(async () => {
  // Prime the memoised loaders so components render synchronously with the sample contract data.
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
  vi.unstubAllGlobals();
});

beforeEach(() => {
  usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
  usePatientStore.setState({ prediction: null, previous: null, baseline: null, status: 'idle', error: null, engineStatus: 'server' });
  useViewerStore.setState({ selectedStructure: null, hoveredStructure: null });
  useUiStore.setState({ detailsOpen: false, panels: { ...useUiStore.getState().panels, openGroups: ['exam'] } });
});

describe('ClinicalForm (schema-driven)', () => {
  it('renders one accordion per schema group and every feature of an open group', () => {
    render(<ClinicalForm />);
    for (const g of sampleSchema.groups) expect(screen.getByRole('button', { name: new RegExp(g.label, 'i') })).toBeInTheDocument();
    const bp = screen.getByRole('slider', { name: 'Blood pressure' });
    expect(bp).toHaveAttribute('aria-valuetext', expect.stringContaining('above normal'));
    expect(screen.getByText(/ref 90–120/)).toBeInTheDocument();
  });

  it('edits flow into the patient store and are counted by the what-if bar', () => {
    render(
      <>
        <WhatIfBar />
        <ClinicalForm />
      </>,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Blood pressure' }), { target: { value: '160' } });
    expect(usePatientStore.getState().features.BP).toBe(160);
    expect(screen.getByText(/edit vs recorded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset blood pressure/i })).toBeInTheDocument();
  });
});

describe('risk panel', () => {
  it('shows the CAD estimate with band word, verdict and the not-a-diagnosis microcopy', () => {
    usePatientStore.getState().predictionSucceeded(samplePrediction, 10);
    render(<CADHeroCard />);
    expect(screen.getByText('87 percent')).toBeInTheDocument();
    expect(screen.getByText('Very high')).toBeInTheDocument();
    expect(screen.getByText(/CAD likely · above threshold 46/)).toBeInTheDocument();
    expect(screen.getByText(/Model estimate, not a diagnosis/)).toBeInTheDocument();
  });

  it('never shows a number when no engine can produce one', () => {
    usePatientStore.setState({ status: 'error', error: 'server offline', engineStatus: 'unavailable' });
    render(<CADHeroCard />);
    expect(screen.getByText('Estimate unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/percent/)).not.toBeInTheDocument();
  });

  it('lists every vessel target and selecting a row selects it in 3D', async () => {
    usePatientStore.getState().predictionSucceeded(samplePrediction, 10);
    render(<VesselList />);
    const lad = screen.getByRole('button', { name: /Left anterior descending artery, 72 percent, High/ });
    await userEvent.click(lad);
    expect(useViewerStore.getState().selectedStructure).toBe('LAD');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('builds the WHY sentence from the contributions', () => {
    usePatientStore.getState().predictionSucceeded(samplePrediction, 10);
    render(<NarrativeSentence target="LAD" />);
    expect(screen.getByText(/^typical chest pain$/i)).toHaveClass('underline');
  });
});

describe('disclaimer', () => {
  it('keeps the status line permanent and opens Details on demand (no blocking modal)', async () => {
    render(
      <MemoryRouter>
        <StatusLine />
        <DisclaimerModal />
      </MemoryRouter>,
    );
    const line = screen.getByRole('contentinfo', { name: 'Clinical safety disclaimer' });
    expect(within(line).getByText('not a diagnosis')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(within(line).getByRole('button', { name: /details/i }));
    expect(await screen.findByRole('dialog', { name: 'About these estimates' })).toBeInTheDocument();
    act(() => useUiStore.getState().closeDetails());
  });
});
