import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cohortResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { jsonResponse, sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import { NarrativeSentence } from './explain/NarrativeSentence';
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
  useUiStore.setState({ detailsOpen: false });
});

// The V2 cards have their own suites: features/patient/patientUi.test.tsx (patient card, Inputs drawer,
// what-if pill, switcher) and features/risk/riskUi.test.tsx (Risk card, inspector, answer pill, Explain).
describe('narrative', () => {
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
