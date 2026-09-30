import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as RoutesModule from '@/routes';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cohortResource, metricsResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { jsonResponse, sampleCohort, sampleMetrics, samplePrediction, sampleSchema } from '@/test/fixtures';
import LandingPage from './LandingPage';
import { landingMetricsResource } from './landingMetrics';

vi.mock('@/routes', async (orig) => ({
  ...(await orig<typeof RoutesModule>()),
  // The landing preloads the workstation chunk; tests do not need it.
  loadWorkstation: () => Promise.resolve({}),
}));

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('schema.json')) return Promise.resolve(jsonResponse(sampleSchema));
      if (url.includes('cohort.json')) return Promise.resolve(jsonResponse(sampleCohort));
      if (url.includes('metrics_summary.json')) return Promise.resolve(new Response('', { status: 404 }));
      if (url.includes('metrics.json')) return Promise.resolve(jsonResponse(sampleMetrics));
      return Promise.resolve(new Response('', { status: 404 }));
    }),
  );
  await schemaResource.get();
  await cohortResource.get();
  await metricsResource.get();
  await landingMetricsResource.get();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
  usePatientStore.getState().predictionSucceeded(samplePrediction, 5);
  useUiStore.setState({ chrome: 'workstation', tourOpen: false });
});

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <LandingPage />
    </MemoryRouter>,
  );

describe('LandingPage', () => {
  it('has one H1, exactly one primary call to action and a ghost guided-demo entry', () => {
    renderLanding();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const primary = document.querySelectorAll('[data-cta="primary"]');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Open the workstation');
    expect(document.querySelectorAll('button.bg-accent')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /guided demo/i })).toBeInTheDocument();
  });

  it('switches the chrome to the landing preset and hands it back on leave', () => {
    const { unmount } = renderLanding();
    expect(useUiStore.getState().chrome).toBe('landing');
    unmount();
    expect(useUiStore.getState().chrome).toBe('workstation');
  });

  it('shows KPI values from the artifacts (never "leaked labels") with the honest CV value and protocol line', () => {
    renderLanding();
    const kpis = screen.getByRole('region', { name: 'Key facts' });
    expect(within(kpis).getByText('303')).toBeInTheDocument();
    expect(within(kpis).getByText(String(sampleSchema.features.length))).toBeInTheDocument();
    expect(within(kpis).getByText('0.93')).toBeInTheDocument();
    expect(within(kpis).getByText(/cross-validation/)).toBeInTheDocument();
    expect(within(kpis).queryByText(/leaked/i)).not.toBeInTheDocument();
    const protocol = within(kpis).getByRole('list', { name: 'Validation protocol' });
    expect(within(protocol).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/methodology#leakage',
      '/methodology#validation',
      '/methodology#models',
    ]);
  });

  it('renders four verb pillars that deep-link into the workstation and performance', () => {
    renderLanding();
    const nav = screen.getByRole('navigation', { name: 'What CardioTwin does' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/workstation',
      '/workstation?panel=explain&tab=why',
      '/workstation?t=LAD',
      '/performance',
    ]);
    // The CAD numeral lives only in the Predict pillar on this page (one home per number).
    expect(document.querySelectorAll('[data-prob="CAD"]')).toHaveLength(1);
  });

  it('flips typical angina from the live lever and resets it', async () => {
    renderLanding();
    const lever = screen.getByRole('radiogroup', { name: /What if: Typical chest pain/ });
    await userEvent.click(within(lever).getByRole('radio', { name: 'No' }));
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /Reset Typical chest pain/ }));
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(1);
  });

  it('opens the guided demo from the ghost CTA after the copy exits', async () => {
    vi.useFakeTimers();
    try {
      renderLanding();
      act(() => screen.getByRole('button', { name: /guided demo/i }).click());
      act(() => vi.advanceTimersByTime(300));
      expect(useUiStore.getState().tourOpen).toBe(true);
    } finally {
      vi.useRealTimers();
      useUiStore.setState({ tourOpen: false });
    }
  });
});
