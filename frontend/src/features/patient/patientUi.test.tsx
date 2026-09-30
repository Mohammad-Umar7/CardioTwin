import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import cohortRaw from '../../../public/model/cohort.json?raw';
import schemaRaw from '../../../public/model/schema.json?raw';
import { cohortResource, schemaResource } from '@/services/staticData';
import { useCommandStore } from '@/state/commandStore';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { jsonResponse } from '@/test/fixtures';
import type { CohortResponse, FeatureSchema, PredictResponse, TargetId } from '@/types/contracts';
import { InputsDrawer } from './InputsDrawer';
import { PatientCard } from './PatientCard';
import { PatientSwitcher } from './PatientSwitcher';
import { WhatIfPill } from './WhatIfPill';
import type * as WhatIfEngine from './lib/whatIfEngine';

type WhatIfEngineModule = typeof WhatIfEngine;

// Deterministic what-if engine: CAD depends on typical angina only.
vi.mock('./lib/whatIfEngine', async (importOriginal) => {
  const actual = await importOriginal<WhatIfEngineModule>();
  const score = (r: Record<string, unknown>) => ({ CAD: r['Typical Chest Pain'] === 1 ? 0.98 : 0.91, LAD: 0.6, LCX: 0.5, RCA: 0.4 });
  return {
    ...actual,
    scoreRows: vi.fn(async (rows: Record<string, unknown>[]) => rows.map(score)),
    iceStrip: vi.fn(async () => null),
  };
});

const schema = JSON.parse(schemaRaw) as FeatureSchema;
const cohort = JSON.parse(cohortRaw) as CohortResponse;
const p011 = cohort.patients.find((p) => p.id === 'P-011')!;

function prediction(contribs: [string, number][]): PredictResponse {
  const explanation = {
    space: 'log-odds',
    base_value: 0,
    output_value: contribs.reduce((s, [, v]) => s + v, 0),
    contributions: contribs.map(([feature, shap]) => ({ feature, shap, value: p011.features[feature] ?? null })),
  };
  const targets: TargetId[] = ['CAD', 'LAD', 'LCX', 'RCA'];
  return {
    model_version: '1.0.0',
    engine: 'server',
    imputed: [],
    predictions: Object.fromEntries(targets.map((t) => [t, { probability: 0.9, label: 1, threshold: 0.5, risk_band: 'critical', logit: 2 }])),
    explanations: Object.fromEntries(targets.map((t) => [t, explanation])),
    summary: { expected_diseased_vessels: 1.7, highest_risk_vessel: 'LAD' },
  } as unknown as PredictResponse;
}

const CONTRIBS: [string, number][] = [
  ['Typical Chest Pain', 1.34],
  ['Age', 0.9],
  ['HTN', 0.62],
  ['Region RWMA', -0.52],
  ['BP', 0.25],
  ['EF-TTE', -0.2],
  ['FBS', 0.1],
  ['Sex', 0.3],
];

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('schema.json')) return Promise.resolve(jsonResponse(schema));
      if (url.includes('cohort.json')) return Promise.resolve(jsonResponse(cohort));
      return Promise.resolve(new Response('', { status: 404 }));
    }),
  );
  await schemaResource.get();
  await cohortResource.get();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  usePatientStore.getState().loadPatient(p011);
  usePatientStore.getState().predictionSucceeded(prediction(CONTRIBS), 5);
  useViewerStore.setState({ selectedStructure: null });
  useUiStore.setState({ drawer: null, focusField: null, inputsSection: null, patientCardOpen: true, toasts: [], highlightedFeature: null });
});

afterEach(() => {
  vi.useRealTimers();
});

const renderIn = (ui: React.ReactElement) => render(<MemoryRouter initialEntries={['/workstation/P-011']}>{ui}</MemoryRouter>);

describe('PatientCard', () => {
  it('shows who, what drives the target most (Age and Sex excluded) and a way into the inputs', () => {
    renderIn(<PatientCard />);
    const card = screen.getByRole('complementary', { name: 'Patient record' });
    expect(within(card).getByRole('heading', { name: 'Male · 58 y' })).toBeInTheDocument();
    expect(within(card).getByText('Drives CAD most')).toBeInTheDocument();
    const rows = within(card).getAllByRole('button', { name: /risk (strongly|moderately|slightly)/ });
    expect(rows.map((r) => r.dataset.feature)).toEqual(['Typical Chest Pain', 'HTN', 'Region RWMA', 'BP', 'EF-TTE']);
    expect(rows[0]).toHaveAccessibleName(/^Typical angina, yes, raises CAD risk strongly\./);
    expect(within(card).getByRole('button', { name: /abnormal findings/ })).toBeInTheDocument();
  });

  it('opens the Inputs drawer on the clicked field, and on the abnormal section from the link', async () => {
    renderIn(<PatientCard />);
    await userEvent.click(screen.getByRole('button', { name: /^Blood pressure/ }));
    expect(useUiStore.getState()).toMatchObject({ drawer: 'inputs', focusField: 'BP' });
    act(() => useUiStore.getState().closeDrawer());
    await userEvent.click(screen.getByRole('button', { name: /abnormal findings/ }));
    expect(useUiStore.getState()).toMatchObject({ drawer: 'inputs', inputsSection: 'abnormal' });
  });

  it('re-ranks for the selected vessel', () => {
    renderIn(<PatientCard />);
    act(() => useViewerStore.setState({ selectedStructure: 'LAD' }));
    expect(screen.getByText('Drives LAD most')).toBeInTheDocument();
  });

  it('collapses to the rail, and auto-collapses while Explain is open', async () => {
    renderIn(<PatientCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the patient card' }));
    expect(await screen.findByRole('navigation', { name: 'Patient record' })).toBeInTheDocument();
    expect(useUiStore.getState().patientCardOpen).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show the patient record' }));
    expect(await screen.findByRole('complementary', { name: 'Patient record' })).toBeInTheDocument();
    act(() => useUiStore.getState().openDrawer('explain'));
    expect(await screen.findByRole('navigation', { name: 'Patient record' })).toBeInTheDocument();
    expect(useUiStore.getState().patientCardOpen).toBe(true);
  });

  it('registers palette commands for every patient, every input and the patient actions', () => {
    renderIn(<PatientCard />);
    const ids = Object.values(useCommandStore.getState().sources).flatMap((s) => s.commands.map((c) => c.id));
    expect(ids).toEqual(expect.arrayContaining(['patient.open.P-003', 'input.EF-TTE', 'input.Typical Chest Pain', 'inputs.reset', 'patient.blank', 'patient.random-test', 'patient.share-link', 'patient.export', 'patient.import']));
    expect(ids.filter((id) => /^input\.[^.]+$/.test(id) || /^input\.[^.]+ [^.]+$/.test(id)).length).toBeGreaterThan(0);
    expect(schema.features.every((f) => ids.includes(`input.${f.key}`))).toBe(true);
    expect(cohort.patients.every((p) => ids.includes(`patient.open.${p.id}`))).toBe(true);
  });
});

describe('InputsDrawer', () => {
  const openDrawer = (opts?: Parameters<ReturnType<typeof useUiStore.getState>['openDrawer']>[1]) =>
    act(() => useUiStore.getState().openDrawer('inputs', opts));

  it('lays out Outside normal range, Most influential and All inputs, with a single filled button', async () => {
    renderIn(<InputsDrawer />);
    openDrawer();
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    expect(within(drawer).getByRole('region', { name: 'Outside normal range' })).toBeInTheDocument();
    expect(within(drawer).getByRole('region', { name: 'Most influential for CAD' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('region', { name: 'Changed inputs' })).not.toBeInTheDocument();
    for (const g of schema.groups) expect(within(drawer).getByRole('button', { name: new RegExp(g.label) })).toBeInTheDocument();
    expect(within(drawer).getByText('Changes apply instantly')).toBeInTheDocument();
    expect(within(drawer).getByRole('group', { name: 'Present findings' })).toBeInTheDocument();
  });

  it('expands a numeric row on focus only, with the track, reference range and ± buttons', async () => {
    renderIn(<InputsDrawer />);
    openDrawer();
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    const bp = within(drawer).getByLabelText('Blood pressure', { selector: 'input:not([type="range"])' });
    const row = bp.closest('[data-row-id]') as HTMLElement;
    expect(row).not.toHaveAttribute('data-expanded');
    act(() => bp.focus());
    expect(row).toHaveAttribute('data-expanded', 'true');
    expect(within(row).getByText(/ref 90–120/)).toBeInTheDocument();
    expect(within(row).getByRole('slider', { name: 'Blood pressure' })).toHaveAttribute('aria-valuetext', expect.stringContaining('above normal'));
    // one row at a time
    const ef = within(drawer).getByLabelText('Ejection fraction', { selector: 'input:not([type="range"])' });
    act(() => ef.focus());
    expect(row).not.toHaveAttribute('data-expanded');
    expect(ef.closest('[data-row-id]')).toHaveAttribute('data-expanded', 'true');
  });

  it('commits typed values on Enter, nudges with the arrows and rejects out-of-range values', async () => {
    renderIn(<InputsDrawer />);
    openDrawer();
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    const ef = within(drawer).getByLabelText('Ejection fraction', { selector: 'input:not([type="range"])' });
    act(() => ef.focus());
    fireEvent.keyDown(ef, { key: 'ArrowUp' });
    expect(usePatientStore.getState().features['EF-TTE']).toBe(55);
    fireEvent.change(ef, { target: { value: '35' } });
    fireEvent.keyDown(ef, { key: 'Enter' });
    expect(usePatientStore.getState().features['EF-TTE']).toBe(35);
    expect(within(drawer).getAllByText('was 50').length).toBeGreaterThan(0);
    fireEvent.change(ef, { target: { value: '99' } });
    fireEvent.keyDown(ef, { key: 'Enter' });
    expect(within(drawer).getByRole('alert')).toHaveTextContent('Allowed 15–60');
    expect(usePatientStore.getState().features['EF-TTE']).toBe(35);
    // Esc reverts the uncommitted text and keeps the drawer open
    fireEvent.keyDown(ef, { key: 'Escape' });
    expect(ef).toHaveValue('35');
    expect(useUiStore.getState().drawer).toBe('inputs');
  });

  it('toggles findings as pressed chips and lists the edit under Changed after 1.2 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderIn(<InputsDrawer />);
    openDrawer();
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    const chip = within(within(drawer).getByRole('group', { name: 'Present findings' })).getByRole('button', { name: /Typical angina/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(0);
    expect(within(drawer).queryByRole('region', { name: 'Changed inputs' })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    const changed = within(drawer).getByRole('region', { name: 'Changed inputs' });
    expect(within(changed).getByText('was Yes')).toBeInTheDocument();
    expect(within(drawer).getByText(/1 change/)).toBeInTheDocument();
    fireEvent.click(within(changed).getByRole('button', { name: 'Reset all' }));
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(1);
    expect(useUiStore.getState().toasts.at(-1)?.action?.label).toBe('Undo');
  });

  it('searches labels, aliases and raw keys; Esc clears the query before closing', async () => {
    renderIn(<InputsDrawer />);
    openDrawer();
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    const search = within(drawer).getByRole('searchbox', { name: 'Find an input' });
    fireEvent.change(search, { target: { value: 'rwma' } });
    const results = within(drawer).getByRole('region', { name: 'Search results' });
    expect(within(results).getByText('Regional wall-motion abnormality')).toBeInTheDocument();
    expect(within(results).getByText('Echocardiography')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(useUiStore.getState().drawer).toBe('inputs');
  });

  it('focuses the requested field, opening its group when it is not listed above', async () => {
    renderIn(<InputsDrawer />);
    openDrawer({ field: 'Na' });
    const drawer = await screen.findByRole('dialog', { name: /Edit inputs/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(within(drawer).getByLabelText('Sodium', { selector: 'input:not([type="range"])' })));
    expect(within(drawer).getByRole('button', { name: /Laboratory/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('WhatIfPill', () => {
  it('exists only while edits exist; hold to compare shows the recorded prediction', async () => {
    const { rerender } = renderIn(<WhatIfPill />);
    expect(screen.queryByRole('group', { name: 'What-if' })).not.toBeInTheDocument();
    act(() => usePatientStore.getState().setFeature('Typical Chest Pain', 0));
    rerender(
      <MemoryRouter>
        <WhatIfPill />
      </MemoryRouter>,
    );
    const pill = await screen.findByRole('group', { name: 'What-if' });
    expect(within(pill).getByRole('button', { name: /1 change/ })).toBeInTheDocument();
    const hold = within(pill).getByRole('button', { name: 'Hold to compare' });
    fireEvent.pointerDown(hold, { button: 0, pointerId: 1 });
    expect(usePatientStore.getState().comparing).toBe(true);
    expect(hold).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerUp(hold, { pointerId: 1 });
    expect(usePatientStore.getState().comparing).toBe(false);
    fireEvent.keyDown(hold, { key: ' ' });
    expect(usePatientStore.getState().comparing).toBe(true);
    fireEvent.keyUp(hold, { key: ' ' });
    expect(usePatientStore.getState().comparing).toBe(false);
  });

  it('resets without asking and offers Undo', async () => {
    act(() => usePatientStore.getState().setFeature('Typical Chest Pain', 0));
    renderIn(<WhatIfPill />);
    await userEvent.click(within(await screen.findByRole('group', { name: 'What-if' })).getByRole('button', { name: 'Reset' }));
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(1);
    act(() => useUiStore.getState().toasts.at(-1)?.action?.onClick());
    expect(usePatientStore.getState().features['Typical Chest Pain']).toBe(0);
  });
});

describe('PatientSwitcher', () => {
  it('lists curated cases first, then the held-out and development cohorts, without cath results', async () => {
    const onClose = vi.fn();
    renderIn(<PatientSwitcher onClose={onClose} />);
    const list = screen.getByRole('listbox', { name: 'Patients' });
    const groups = within(list).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
      'Curated cases',
      'Held-out test·61',
      'Development·20',
    ]);
    expect(list.textContent).not.toMatch(/cath|stenos|positive|negative/i);
    expect(within(groups[0]!).getAllByRole('option')).toHaveLength(6);
  });

  it('filters by ID, age, sex and findings and opens the chosen patient', async () => {
    const onClose = vi.fn();
    renderIn(<PatientSwitcher onClose={onClose} />);
    const search = screen.getByRole('combobox', { name: /Find a patient/ });
    fireEvent.change(search, { target: { value: 'P-035' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
    expect(usePatientStore.getState().selectedPatientId).toBe('P-035');
    fireEvent.change(search, { target: { value: 'female lbbb' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('P-296')]));
  });

  it('starts a blank patient from the schema defaults', async () => {
    renderIn(<PatientSwitcher onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /New blank patient/ }));
    await vi.waitFor(() => expect(usePatientStore.getState().mode).toBe('blank'));
    const s = usePatientStore.getState();
    expect(s.features).toEqual(s.recorded);
    expect(s.features.Age).toBe(schema.features.find((f) => f.key === 'Age')!.default);
  });
});
