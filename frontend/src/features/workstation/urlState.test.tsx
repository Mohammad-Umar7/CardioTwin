/** Shareable workstation state (WORKSTATION_V2 §7): codec, store mapping and the router round trip. */
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { parseViewState, serializeViewState, viewStateFromStores, workstationPath, type Vocabulary } from './urlState';
import { applyViewState, currentPreset, useWorkstationUrlState } from './useWorkstationUrlState';

vi.mock('@/hooks/useData', () => ({
  useSchemaIndex: () => null,
  useCohort: () => ({ status: 'ready', data: { patients: [] } }),
}));

const vocab: Vocabulary = { targets: ['LAD', 'LCX', 'RCA'], views: ['AP', 'LAO45', 'RAO30'] };

describe('codec', () => {
  it('parses every key case-insensitively and drops unknown values', () => {
    expect(parseViewState('?t=lad&view=rao30&panel=Explain&tab=WHY&focus=1', vocab)).toEqual({
      target: 'LAD',
      view: 'RAO30',
      panel: 'explain',
      tab: 'why',
      focus: true,
    });
    expect(parseViewState('?t=LM&view=CRA99&panel=menu&tab=x&focus=0', vocab)).toEqual({});
    expect(parseViewState('', vocab)).toEqual({});
  });

  it('serialises in a stable order, writes tab only with the Explain drawer and keeps foreign params', () => {
    const search = serializeViewState(
      { target: 'LAD', view: null, panel: 'explain', tab: 'model', focus: false },
      '?w=1_abc&t=RCA&layout=legacy&focus=1',
    );
    expect(search).toBe('?t=LAD&panel=explain&tab=model&w=1_abc&layout=legacy');
    expect(serializeViewState({ target: null, view: null, panel: 'inputs', tab: 'why', focus: false }, '')).toBe('?panel=inputs');
    expect(serializeViewState({ target: null, view: null, panel: null, tab: null, focus: false }, '?t=LAD')).toBe('');
  });

  it('round-trips a full state', () => {
    const state = { target: 'LCX', view: 'LAO45', panel: 'explain' as const, tab: 'physiology' as const, focus: false };
    expect(parseViewState(serializeViewState(state, ''), vocab)).toEqual({ target: 'LCX', view: 'LAO45', panel: 'explain', tab: 'physiology' });
  });

  it('maps the stores and builds the patient path', () => {
    expect(
      viewStateFromStores({ selectedStructure: 'RCA', preset: null, drawer: 'inputs', explainTab: 'model', chrome: 'focus' }),
    ).toEqual({ target: 'RCA', view: null, panel: 'inputs', tab: null, focus: true });
    expect(workstationPath('/workstation', 'P-011')).toBe('/workstation/P-011');
    expect(workstationPath('/workstation', null)).toBe('/workstation');
  });
});

describe('current preset', () => {
  const cmd = { kind: 'preset' as const, preset: 'RAO30', nonce: 1 };
  it('holds while the C-arm sits on the preset and becomes Custom after a free orbit', () => {
    expect(currentPreset({ cameraCommand: cmd, carm: null, selectedStructure: null })).toBe('RAO30');
    expect(currentPreset({ cameraCommand: cmd, carm: { azimuth: -29, elevation: 1 }, selectedStructure: null })).toBe('RAO30');
    expect(currentPreset({ cameraCommand: cmd, carm: { azimuth: 10, elevation: 0 }, selectedStructure: null })).toBeNull();
    expect(currentPreset({ cameraCommand: { kind: 'home', nonce: 2 }, carm: null, selectedStructure: null })).toBeNull();
  });
});

function Probe({ onLocation }: { onLocation: (path: string) => void }) {
  useWorkstationUrlState();
  const loc = useLocation();
  onLocation(`${loc.pathname}${loc.search}`);
  return null;
}

describe('router round trip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ chrome: 'workstation', drawer: null, explainTab: 'why' });
    useViewerStore.setState({ selectedStructure: null, cameraCommand: null, carm: null });
    usePatientStore.setState({ mode: 'cohort', selectedPatientId: 'P-011' });
  });

  const mount = (url: string) => {
    let last = '';
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/workstation/:patientId?" element={<Probe onLocation={(p) => (last = p)} />} />
        </Routes>
      </MemoryRouter>,
    );
    return () => last;
  };

  it('applies a deep link to the stores on mount', () => {
    mount('/workstation/P-011?t=LAD&panel=explain&tab=model');
    expect(useViewerStore.getState().selectedStructure).toBe('LAD');
    expect(useUiStore.getState()).toMatchObject({ drawer: 'explain', explainTab: 'model' });
    vi.useRealTimers();
  });

  it('writes store changes back with the patient path, keeping foreign params', () => {
    const location = mount('/workstation?w=1_x');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(location()).toBe('/workstation/P-011?w=1_x');
    act(() => {
      useViewerStore.getState().select('RCA');
      useUiStore.getState().setChrome('focus');
      vi.advanceTimersByTime(200);
    });
    expect(location()).toBe('/workstation/P-011?t=RCA&focus=1&w=1_x');
    act(() => {
      useUiStore.getState().openDrawer('explain', { tab: 'why' });
      vi.advanceTimersByTime(200);
    });
    expect(location()).toBe('/workstation/P-011?t=RCA&panel=explain&tab=why&w=1_x');
    vi.useRealTimers();
  });

  it('applies the view to the stores through applyViewState without clearing absent keys', () => {
    useUiStore.setState({ drawer: 'inputs' });
    applyViewState({ target: 'LCX' });
    expect(useUiStore.getState().drawer).toBe('inputs');
    expect(useViewerStore.getState().selectedStructure).toBe('LCX');
    vi.useRealTimers();
  });
});
