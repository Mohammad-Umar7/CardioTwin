/** V2 store additions (WORKSTATION_V2 §9.2): additive fields, their invariants and persistence. */
import { beforeEach, describe, expect, it } from 'vitest';
import { schemaDefaults } from '@/lib/patients';
import { sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import {
  editedKeys,
  selectDisplayedPrediction,
  selectEditCount,
  usePatientStore,
} from './patientStore';
import { safeLocalStorage } from './safeStorage';
import { ZERO_INSETS, selectPatientCardExpanded, useUiStore } from './uiStore';
import { useViewerStore } from './viewerStore';

const other = { ...samplePrediction, model_version: 'what-if' };

beforeEach(() => {
  useUiStore.setState({
    chrome: 'workstation',
    drawer: null,
    explainTab: 'why',
    focusField: null,
    inputsSection: null,
    patientCardOpen: true,
    paletteOpen: false,
    stageInsets: ZERO_INSETS,
    hintSeen: false,
  });
  useViewerStore.setState({
    selectedStructure: null,
    territoryMode: 'selected',
    territories: true,
    isolate: false,
    ghostOthers: false,
    cameraReturn: null,
  });
  usePatientStore.setState({
    features: {},
    recorded: {},
    prediction: null,
    recordedPrediction: null,
    comparing: false,
  });
});

describe('uiStore · chrome and drawers', () => {
  it('toggles focus mode only from the workstation preset', () => {
    const ui = useUiStore.getState();
    ui.toggleFocusMode();
    expect(useUiStore.getState().chrome).toBe('focus');
    useUiStore.getState().toggleFocusMode();
    expect(useUiStore.getState().chrome).toBe('workstation');
    useUiStore.getState().setChrome('tour');
    useUiStore.getState().toggleFocusMode();
    expect(useUiStore.getState().chrome).toBe('tour');
  });

  it('closes drawers on entering focus mode and leaves focus mode when a drawer opens', () => {
    const ui = useUiStore.getState();
    ui.openDrawer('explain', { tab: 'why' });
    ui.toggleFocusMode();
    expect(useUiStore.getState()).toMatchObject({ chrome: 'focus', drawer: null });
    ui.openDrawer('inputs', { field: 'Age' });
    expect(useUiStore.getState()).toMatchObject({ chrome: 'workstation', drawer: 'inputs', focusField: 'Age' });
    ui.setChrome('focus');
    expect(useUiStore.getState()).toMatchObject({ chrome: 'focus', drawer: null, focusField: null });
    ui.setChrome('tour');
    ui.openDrawer('explain');
    expect(useUiStore.getState().chrome).toBe('tour');
  });

  it('keeps one drawer open at a time and carries its options', () => {
    useUiStore.getState().openDrawer('inputs', { field: 'EF-TTE', section: 'abnormal' });
    expect(useUiStore.getState()).toMatchObject({ drawer: 'inputs', focusField: 'EF-TTE', inputsSection: 'abnormal' });
    useUiStore.getState().openDrawer('explain', { tab: 'model' });
    expect(useUiStore.getState()).toMatchObject({ drawer: 'explain', explainTab: 'model', focusField: null, inputsSection: null });
    useUiStore.getState().closeDrawer();
    expect(useUiStore.getState().drawer).toBeNull();
  });

  it('toggleDrawer closes an open drawer and opens a closed one', () => {
    useUiStore.getState().toggleDrawer('explain');
    expect(useUiStore.getState().drawer).toBe('explain');
    useUiStore.getState().toggleDrawer('inputs');
    expect(useUiStore.getState().drawer).toBe('inputs');
    useUiStore.getState().toggleDrawer('inputs');
    expect(useUiStore.getState().drawer).toBeNull();
  });

  it('auto-collapses the patient card while Explain is open and restores the user choice', () => {
    expect(selectPatientCardExpanded(useUiStore.getState())).toBe(true);
    useUiStore.getState().openDrawer('explain');
    expect(selectPatientCardExpanded(useUiStore.getState())).toBe(false);
    useUiStore.getState().closeDrawer();
    expect(selectPatientCardExpanded(useUiStore.getState())).toBe(true);
    useUiStore.getState().setPatientCardOpen(false);
    expect(selectPatientCardExpanded(useUiStore.getState())).toBe(false);
  });

  it('publishes stage insets without churning identical values', () => {
    const insets = { left: 304, right: 376, top: 12, bottom: 64 };
    useUiStore.getState().setStageInsets(insets);
    const first = useUiStore.getState().stageInsets;
    expect(first).toEqual(insets);
    useUiStore.getState().setStageInsets({ ...insets });
    expect(useUiStore.getState().stageInsets).toBe(first);
  });

  it('persists the patient card choice and the first-run hint, never transient chrome', () => {
    useUiStore.getState().setPatientCardOpen(false);
    useUiStore.getState().setHintSeen();
    useUiStore.getState().setPaletteOpen(true);
    const saved = JSON.parse(safeLocalStorage.getItem('cardiotwin.ui') as string) as { state: Record<string, unknown> };
    expect(saved.state).toMatchObject({ patientCardOpen: false, hintSeen: true });
    expect(saved.state).not.toHaveProperty('paletteOpen');
    expect(saved.state).not.toHaveProperty('drawer');
    expect(saved.state).not.toHaveProperty('stageInsets');
  });
});

describe('safeLocalStorage', () => {
  it('swallows storage failures', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('viewerStore · territory mode, isolate and ghost', () => {
  it('cycles territories off → selected → all and mirrors the legacy boolean', () => {
    const v = () => useViewerStore.getState();
    v().setTerritoryMode('off');
    expect(v().territories).toBe(false);
    v().cycleTerritoryMode();
    expect(v()).toMatchObject({ territoryMode: 'selected', territories: true });
    v().cycleTerritoryMode();
    expect(v()).toMatchObject({ territoryMode: 'all', territories: true });
    v().cycleTerritoryMode();
    expect(v()).toMatchObject({ territoryMode: 'off', territories: false });
  });

  it('keeps territoryMode in sync when legacy code toggles or sets `territories`', () => {
    const v = () => useViewerStore.getState();
    v().setTerritoryMode('all');
    v().toggle('territories');
    expect(v()).toMatchObject({ territoryMode: 'off', territories: false });
    v().toggle('territories');
    expect(v()).toMatchObject({ territoryMode: 'selected', territories: true });
    v().setTerritoryMode('all');
    v().set('territories', true);
    expect(v().territoryMode).toBe('all');
    v().set('territories', false);
    expect(v().territoryMode).toBe('off');
  });

  it('allows isolate and ghost only while a vessel is selected, and clears them with the selection', () => {
    const v = () => useViewerStore.getState();
    v().setIsolate(true);
    v().setGhostOthers(true);
    expect(v()).toMatchObject({ isolate: false, ghostOthers: false });
    v().select('LAD');
    v().setIsolate(true);
    v().setGhostOthers(true);
    expect(v()).toMatchObject({ isolate: true, ghostOthers: true });
    v().select(null);
    expect(v()).toMatchObject({ isolate: false, ghostOthers: false });
    v().select('RCA');
    v().setIsolate(true);
    v().flyHome();
    expect(v()).toMatchObject({ selectedStructure: null, isolate: false });
  });

  it('stores the camera return pose', () => {
    const pose = { position: [0, 0, 6], target: [0, 0, 0] };
    useViewerStore.getState().setCameraReturn(pose);
    expect(useViewerStore.getState().cameraReturn).toBe(pose);
  });
});

describe('viewerStore · render tier lock', () => {
  it('locks on a user choice and unlocks for Auto without changing the tier', () => {
    useViewerStore.setState({ tier: 'B', tierLocked: false });
    useViewerStore.getState().setTier('C', true);
    expect(useViewerStore.getState()).toMatchObject({ tier: 'C', tierLocked: true });
    useViewerStore.getState().unlockTier();
    expect(useViewerStore.getState()).toMatchObject({ tier: 'C', tierLocked: false });
  });
});

describe('patientStore · blank patient, automatic baseline, compare', () => {
  it('starts a blank patient with zero edits', () => {
    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    usePatientStore.getState().setFeature('BP', 180);
    usePatientStore.getState().startBlank(schemaDefaults(sampleSchema));
    const s = usePatientStore.getState();
    expect(s.mode).toBe('blank');
    expect(s.selectedPatientId).toBeNull();
    expect(s.split).toBeNull();
    expect(editedKeys(s.features, s.recorded)).toEqual([]);
    expect(s.features).toEqual(s.recorded);
    expect(s.features).not.toBe(s.recorded);
  });

  it('captures the recorded prediction while there are no edits and keeps it through what-ifs', () => {
    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    usePatientStore.getState().predictionSucceeded(samplePrediction, 5);
    expect(usePatientStore.getState().recordedPrediction).toBe(samplePrediction);
    usePatientStore.getState().setFeature('BP', 180);
    usePatientStore.getState().predictionSucceeded(other, 5);
    expect(usePatientStore.getState().recordedPrediction).toBe(samplePrediction);
    expect(usePatientStore.getState().prediction).toBe(other);
    expect(selectEditCount(usePatientStore.getState())).toBe(1);
  });

  it('shows the recorded prediction only while comparing', () => {
    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    usePatientStore.getState().predictionSucceeded(samplePrediction, 5);
    usePatientStore.getState().setFeature('BP', 180);
    usePatientStore.getState().predictionSucceeded(other, 5);
    expect(selectDisplayedPrediction(usePatientStore.getState())).toBe(other);
    usePatientStore.getState().setComparing(true);
    expect(selectDisplayedPrediction(usePatientStore.getState())).toBe(samplePrediction);
    usePatientStore.getState().setComparing(false);
    expect(selectDisplayedPrediction(usePatientStore.getState())).toBe(other);
  });

  it('forgets the baseline and compare state when another patient loads', () => {
    usePatientStore.getState().loadPatient(sampleCohort.patients[0]!);
    usePatientStore.getState().predictionSucceeded(samplePrediction, 5);
    usePatientStore.getState().setComparing(true);
    usePatientStore.getState().loadPatient(sampleCohort.patients[1] ?? sampleCohort.patients[0]!);
    expect(usePatientStore.getState()).toMatchObject({ recordedPrediction: null, comparing: false });
  });
});
