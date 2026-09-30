/**
 * The registry the palette searches (WORKSTATION_V2 §9.3 A accept: "the palette opens in < 50 ms with
 * ≥ 60 commands registered"). Mounts the shell and workstation registrations against the real artifacts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkstationCommands } from '@/features/workstation/useWorkstationCommands';
import { cohortResource, schemaResource } from '@/services/staticData';
import { CMD } from '@/state/commandIds';
import { getCommands, isCommandEnabled, useCommandStore } from '@/state/commandStore';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { jsonResponse } from '@/test/fixtures';
import type { CohortResponse, FeatureSchema } from '@/types/contracts';
import CommandPalette from './CommandPalette';
import { useShellCommands } from './useShellCommands';

const artifact = <T,>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../public/model', name), 'utf-8')) as T;

const schema = artifact<FeatureSchema>('schema.json');
const cohort = artifact<CohortResponse>('cohort.json');

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

function Harness() {
  useShellCommands();
  useWorkstationCommands();
  return <CommandPalette />;
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/workstation']}>
      <Harness />
    </MemoryRouter>,
  );

beforeEach(() => {
  useCommandStore.setState({ sources: {}, recent: [] });
  useUiStore.setState({ paletteOpen: false, drawer: null, chrome: 'workstation' });
  usePatientStore.getState().loadPatient(cohort.patients[0]!);
});

describe('command registry on the workstation', () => {
  it('registers at least 60 enabled commands: every patient, every input, views, actions and pages', () => {
    mount();
    const enabled = getCommands().filter(isCommandEnabled);
    expect(enabled.length).toBeGreaterThanOrEqual(60);
    const ids = new Set(enabled.map((c) => c.id));
    for (const p of cohort.patients) expect(ids.has(CMD.openPatient(p.id))).toBe(true);
    for (const f of schema.features) expect(ids.has(CMD.editInput(f.key))).toBe(true);
    for (const id of [CMD.paletteOpen, CMD.focusMode, CMD.inputsDrawer, CMD.explainDrawer, CMD.copyLink, CMD.pagePerformance]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('never shows a raw dataset key as an input title, and gives every input its group and value', () => {
    mount();
    const inputs = getCommands().filter((c) => c.id.startsWith('input.edit.'));
    const labels = new Map(schema.features.map((f) => [f.key, f.label]));
    for (const c of inputs) {
      const key = c.id.slice('input.edit.'.length);
      expect(c.title).toBe(labels.get(key));
      expect(c.subtitle).toBeTruthy();
      if (key.toLowerCase() !== c.title.toLowerCase()) expect(c.keywords).toContain(key);
    }
  });

  it('opens the palette with a bounded number of rows, whatever the registry size', async () => {
    mount();
    const t0 = performance.now();
    act(() => useUiStore.getState().setPaletteOpen(true));
    await screen.findByRole('combobox');
    const elapsed = performance.now() - t0;
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBeLessThanOrEqual(45);
    // jsdom is several times slower than a browser; this only guards against O(registry) rendering.
    expect(elapsed).toBeLessThan(1000);
  });

  it('runs an input command by opening the Inputs drawer on that field', async () => {
    mount();
    const ef = getCommands().find((c) => c.id === CMD.editInput('EF-TTE'));
    act(() => ef?.run());
    expect(useUiStore.getState()).toMatchObject({ drawer: 'inputs', focusField: 'EF-TTE' });
  });
});
