import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as RoutesModule from '@/routes';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cohortResource, metricsResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { jsonResponse, sampleCohort, sampleMetrics, samplePrediction, sampleSchema } from '@/test/fixtures';
import { enterWorkstationFromLanding } from './entry';
import LandingPage from './LandingPage';
import { landingMetricsResource } from './landingMetrics';
import { SIMPLE_FADE_MS } from './useEnterWorkstation';

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

/** The landing, with a stand-in for the existing workstation route so navigation can be observed. */
const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/workstation" element={<p>existing workstation</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('LandingPage', () => {
  it('says what the product does in one headline, one sentence and one dominant call to action', () => {
    renderLanding();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Coronary risk, made explainable.');
    const primary = document.querySelectorAll('[data-cta="primary"]');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Enter Workstation');
    expect(screen.getByText(/vessel-level risk from routine clinical data/)).toBeInTheDocument();
    expect(screen.getByText('Research and educational decision support · Not a diagnosis')).toBeInTheDocument();
    // The existing guided demo stays as a quiet secondary action.
    expect(screen.getByRole('button', { name: /guided demo/i })).toBeInTheDocument();
  });

  it('carries no KPI tiles, pillars, live lever, telemetry or patient caption', () => {
    renderLanding();
    expect(screen.queryByRole('region', { name: 'Key facts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'What CardioTwin does' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText(/bpm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/held-out test patient$/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-prob]')).toHaveLength(0);
  });

  it('keeps the 3D stage out of the reading order (a presentation, not a control)', () => {
    renderLanding();
    const stage = document.querySelector<HTMLElement>('[data-region="landing-stage"]')!;
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage.inert).toBe(true);
  });

  it('switches the chrome to the landing preset and hands it back on leave', () => {
    const { unmount } = renderLanding();
    expect(useUiStore.getState().chrome).toBe('landing');
    unmount();
    expect(useUiStore.getState().chrome).toBe('workstation');
  });

  it('states the evidence from the artifacts, with the CI, the n and the cross-validation value beside it', () => {
    renderLanding();
    const evidence = screen.getByRole('region', { name: 'What the estimates rest on' });
    expect(within(evidence).getByText(/303 patients/)).toBeInTheDocument();
    expect(within(evidence).getByText(new RegExp(`${sampleSchema.features.length} routine clinical variables`))).toBeInTheDocument();
    const validation = within(evidence).getByText(/ROC-AUC 0\.93 for coronary artery disease/).closest('dd')!;
    expect(validation).toHaveTextContent(/95\s% CI 0\.87–0\.97/);
    expect(validation).toHaveTextContent(/61 held-out test patients/);
    expect(validation).toHaveTextContent(/0\.92\s±\s0\.03 in cross-validation/);
    expect(within(evidence).getByText(/not a reconstruction of the patient’s arteries/)).toBeInTheDocument();
    expect(within(evidence).getByRole('link', { name: /Model performance/ })).toHaveAttribute('href', '/performance');
  });

  it('opens the existing workstation route from the call to action (simple path without 3D), once', async () => {
    vi.useFakeTimers();
    try {
      renderLanding();
      const cta = document.querySelector<HTMLButtonElement>('[data-cta="primary"]')!;
      act(() => cta.click());
      act(() => cta.click());
      expect(cta).toHaveAttribute('aria-disabled', 'true');
      act(() => vi.advanceTimersByTime(SIMPLE_FADE_MS + 20));
      expect(screen.getByText('existing workstation')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays the same entry from the top bar's Workstation link while the landing is up", () => {
    vi.useFakeTimers();
    try {
      renderLanding();
      let handled = false;
      act(() => {
        handled = enterWorkstationFromLanding();
      });
      expect(handled).toBe(true);
      act(() => vi.advanceTimersByTime(SIMPLE_FADE_MS + 20));
      expect(screen.getByText('existing workstation')).toBeInTheDocument();
      // The landing is gone: the link navigates on its own again.
      expect(enterWorkstationFromLanding()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the guided demo from the secondary action after the copy exits', () => {
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
