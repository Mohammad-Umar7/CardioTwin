import { describe, expect, it } from 'vitest';
import {
  DEPLOYED_MODEL_ID,
  FEATURE_FALLBACK_NAMES,
  KNOWN_MODEL_IDS,
  MODALITY_ORDER,
  deployedModelName,
  featureName,
  humanizeModelIds,
  isDeployedModel,
  modalityName,
  modelInfo,
  modelName,
  targetClassNames,
} from './modelNames';

/** Every id the ML leaderboard emits today (metrics.json → targets.*.leaderboard[].model). */
const LEADERBOARD_IDS = [
  'ensemble',
  'random_forest',
  'extra_trees',
  'xgboost',
  'lr_elasticnet',
  'lr_l2',
  'svm_rbf',
  'hist_gb',
  'lr_core',
  'lr_l1',
  'knn',
  'dummy_prior',
];

describe('model names', () => {
  it('names every leaderboard id without leaking the id', () => {
    for (const id of LEADERBOARD_IDS) {
      const info = modelInfo(id);
      expect(info.name).not.toContain(id);
      expect(info.short).not.toContain(id);
      expect(info.name).not.toMatch(/_/);
    }
  });

  it('marks only the ensemble as deployed', () => {
    expect(DEPLOYED_MODEL_ID).toBe('ensemble');
    expect(LEADERBOARD_IDS.filter(isDeployedModel)).toEqual(['ensemble']);
  });

  it('uses the spec wording for the ensemble and the elastic-net model', () => {
    expect(modelName('ensemble')).toBe('Ensemble: logistic regression + gradient-boosted trees');
    expect(modelName('lr_elasticnet')).toBe('Logistic regression (elastic net)');
  });

  it('names the deployed ensemble after its linear part', () => {
    expect(deployedModelName('lr_elasticnet')).toBe('Ensemble: elastic-net logistic regression + gradient-boosted trees');
    expect(deployedModelName('lr_core')).toContain('bedside');
    expect(deployedModelName(undefined)).toBe(modelName('ensemble'));
    expect(deployedModelName('something_new')).toBe(modelName('ensemble'));
  });

  it('never shows a raw id for unknown models', () => {
    expect(modelName('light_gbm')).toBe('Light gbm');
  });

  it('replaces internal ids in protocol prose, longest first and on token boundaries', () => {
    const text = 'Nested CV for lr_l2, lr_core, lr_l1, lr_elasticnet, svm_rbf, knn, xgboost: RandomizedSearchCV';
    const out = humanizeModelIds(text);
    for (const id of KNOWN_MODEL_IDS.filter((id) => id !== 'ensemble')) expect(out).not.toContain(id);
    expect(out).toContain('Logistic (elastic net)');
    expect(out).toContain('RandomizedSearchCV');
    expect(humanizeModelIds('a margin ensemble')).toBe('a margin ensemble');
    expect(humanizeModelIds('myxgboostish')).toBe('myxgboostish');
  });
});

describe('feature names', () => {
  it('prefers the schema label', () => {
    const byKey = new Map([['EF-TTE', { label: 'Ejection fraction (echo)' }]]);
    expect(featureName('EF-TTE', byKey)).toBe('Ejection fraction (echo)');
  });

  it('falls back to a human label for every raw key, including dropped constants', () => {
    expect(featureName('Region RWMA')).toBe('Regional wall-motion abnormality');
    expect(featureName('Tinversion')).toBe('T-wave inversion');
    expect(featureName('CHF')).toBe('Congestive heart failure');
    expect(featureName('Exertional CP')).toBe('Exertional chest pain');
    expect(featureName('brand_new_key')).toBe('Brand new key');
    // The raw keys WORKSTATION_V2 §6.4 rule 3 names explicitly never survive as labels.
    for (const raw of ['Typical Chest Pain', 'Region RWMA', 'EF-TTE', 'HTN', 'Tinversion', 'FBS']) {
      const label = FEATURE_FALLBACK_NAMES[raw];
      expect(label).toBeDefined();
      expect(label).not.toContain(raw);
    }
  });
});

describe('modalities and targets', () => {
  it('orders the seven modalities from bedside to instrumental', () => {
    expect(MODALITY_ORDER).toEqual(['demographics', 'risk_factors', 'symptoms', 'exam', 'ecg', 'labs', 'echo']);
    expect(modalityName('ecg', 'short')).toBe('ECG');
    expect(modalityName('unknown_group')).toBe('Unknown group');
  });

  it('phrases the classes of each target', () => {
    expect(targetClassNames('CAD')).toMatchObject({ positive: 'CAD', negative: 'no CAD' });
    expect(targetClassNames('LAD').positive).toBe('a stenotic LAD');
  });
});
