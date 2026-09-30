import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cohortResource, schemaResource } from '@/services/staticData';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { jsonResponse, sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import TourLayer from './TourLayer';
import { getSession } from './session';

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

afterAll(() => {
  vi.unstubAllGlobals();
});

let path = '';
function WhereAmI() {
  const loc = useLocation();
  path = `${loc.pathname}${loc.search}`;
  return null;
}

beforeEach(() => {
  // Start from a "used" workstation: a dev patient with an edit, RCA selected, Explain open.
  usePatientStore.getState().loadPatient(sampleCohort.patients[1]!);
  usePatientStore.getState().setFeature('BP', 150);
  usePatientStore.getState().predictionSucceeded(samplePrediction, 5);
  useViewerStore.setState({ selectedStructure: 'RCA', explode: PEEL_REST, isolate: false });
  useUiStore.setState({ chrome: 'workstation', drawer: 'explain', explainTab: 'physiology', tourOpen: false, tourStep: 0 });
});

const renderTour = () =>
  render(
    <MemoryRouter initialEntries={['/workstation']}>
      <Routes>
        <Route path="*" element={<WhereAmI />} />
      </Routes>
      <TourLayer />
    </MemoryRouter>,
  );

describe('TourLayer', () => {
  it('runs the chapters with actions and restores the exact prior state on Esc', async () => {
    renderTour();
    act(() => useUiStore.getState().openTour(0));

    expect(await screen.findByRole('dialog', { name: 'A patient the model never saw' })).toBeInTheDocument();
    expect(useUiStore.getState().chrome).toBe('tour');
    // The showcase test patient is loaded untouched, the drawer closed and the selection cleared.
    expect(usePatientStore.getState().split).toBe('test');
    expect(usePatientStore.getState().features.BP).toBe(sampleCohort.patients[0]!.features.BP);
    expect(useUiStore.getState().drawer).toBeNull();
    expect(useViewerStore.getState().selectedStructure).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Guided demo chapters' })).toBeInTheDocument();

    // → Chapter 1 beat 2, then chapter 2: the highest-risk vessel is selected (the camera flies).
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: 'The answer' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: 'Select an artery' })).toBeInTheDocument();
    expect(useViewerStore.getState().selectedStructure).toBe('LAD');

    // Jump to chapter 4 from the rail: the Inputs drawer opens on typical angina.
    fireEvent.click(screen.getByRole('button', { name: /Chapter 4 of 5/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit inputs' })).toBeInTheDocument();
    expect(useUiStore.getState()).toMatchObject({ drawer: 'inputs', focusField: 'Typical Chest Pain' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: 'Pull a lever' })).toBeInTheDocument();
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(0);

    // Esc: no residual state.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUiStore.getState().tourOpen).toBe(false);
    expect(getSession()).toBeNull();
    expect(usePatientStore.getState()).toMatchObject({ selectedPatientId: sampleCohort.patients[1]!.id, revealed: false });
    expect(usePatientStore.getState().features.BP).toBe(150);
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(0);
    expect(useViewerStore.getState().selectedStructure).toBe('RCA');
    expect(useUiStore.getState()).toMatchObject({ chrome: 'workstation', drawer: 'explain', explainTab: 'physiology' });
    expect(path).toBe('/workstation');
  });

  it('visits Model performance at the end and Finish returns to where the demo started', async () => {
    renderTour();
    act(() => useUiStore.getState().openTour(10));
    expect(await screen.findByRole('dialog', { name: 'How well it performs' })).toBeInTheDocument();
    await vi.waitFor(() => expect(path).toBe('/performance'));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(useUiStore.getState()).toMatchObject({ tourOpen: false, tourCompleted: true });
    await vi.waitFor(() => expect(path).toBe('/workstation'));
  });
});
