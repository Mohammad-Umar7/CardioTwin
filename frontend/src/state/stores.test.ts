import { beforeEach, describe, expect, it } from 'vitest';
import { compactSummary, pickDefaultPatient, schemaDefaults } from '@/lib/patients';
import { sampleCohort, samplePrediction, sampleSchema } from '@/test/fixtures';
import { editedKeys, usePatientStore } from './patientStore';
import { PEEL_REST, useViewerStore } from './viewerStore';
import { useUiStore } from './uiStore';

beforeEach(() => {
  usePatientStore.setState({ features: {}, recorded: {}, prediction: null, baseline: null, revealed: false });
});

describe('patientStore', () => {
  it('loads a cohort patient and tracks what-if edits against the recorded values', () => {
    const s = usePatientStore.getState();
    s.loadPatient(sampleCohort.patients[0]!);
    expect(usePatientStore.getState().selectedPatientId).toBe('P-017');
    usePatientStore.getState().setFeature('EF-TTE', 35);
    usePatientStore.getState().setFeature('BP', 150);
    const { features, recorded } = usePatientStore.getState();
    expect(editedKeys(features, recorded).sort()).toEqual(['BP', 'EF-TTE']);
    usePatientStore.getState().resetFeature('BP');
    expect(editedKeys(usePatientStore.getState().features, recorded)).toEqual(['EF-TTE']);
    usePatientStore.getState().resetAll();
    expect(editedKeys(usePatientStore.getState().features, recorded)).toEqual([]);
  });

  it('pins a baseline and keeps the previous prediction for deltas', () => {
    const s = usePatientStore.getState();
    s.predictionSucceeded(samplePrediction, 12);
    usePatientStore.getState().pinBaseline();
    usePatientStore.getState().predictionSucceeded({ ...samplePrediction, model_version: 'next' }, 8);
    const state = usePatientStore.getState();
    expect(state.baseline).toBe(samplePrediction);
    expect(state.previous).toBe(samplePrediction);
    expect(state.prediction?.model_version).toBe('next');
    expect(state.predictionSeq).toBeGreaterThanOrEqual(2);
  });

  it('switches to a Custom patient seeded from schema defaults', () => {
    usePatientStore.getState().startCustom(schemaDefaults(sampleSchema));
    const state = usePatientStore.getState();
    expect(state.mode).toBe('custom');
    expect(state.features.Age).toBe(58);
    expect(state.selectedPatientId).toBeNull();
  });
});

describe('viewerStore', () => {
  it('rests the peel at 0.60 and clamps it', () => {
    expect(useViewerStore.getState().explode).toBe(PEEL_REST);
    useViewerStore.getState().setExplode(2);
    expect(useViewerStore.getState().explode).toBe(1);
  });

  it('selecting a vessel issues a camera focus command; clearing does not', () => {
    useViewerStore.getState().select('LAD');
    const cmd = useViewerStore.getState().cameraCommand;
    expect(cmd).toMatchObject({ kind: 'focus', target: 'LAD' });
    useViewerStore.getState().select(null);
    expect(useViewerStore.getState().selectedStructure).toBeNull();
    expect(useViewerStore.getState().cameraCommand?.nonce).toBe(cmd?.nonce);
  });
});

describe('uiStore', () => {
  it('opening Details marks the disclaimer as read (no blocking modal)', () => {
    expect(useUiStore.getState().disclaimerAccepted).toBe(false);
    useUiStore.getState().openDetails();
    expect(useUiStore.getState().disclaimerAccepted).toBe(true);
  });

  it('remembers the compact-layout tab', () => {
    useUiStore.getState().setPanels({ mobileTab: 'why' });
    expect(useUiStore.getState().panels.mobileTab).toBe('why');
    useUiStore.getState().setPanels({ mobileTab: 'risk' });
  });
});

describe('patient helpers', () => {
  it('opens on a held-out TEST patient', () => {
    expect(pickDefaultPatient(sampleCohort.patients)?.split).toBe('test');
  });

  it('compacts summaries for the patient chip', () => {
    expect(compactSummary('62 y · Male · typical angina · DM')).toBe('62 y · M');
  });
});
