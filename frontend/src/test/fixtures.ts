/**
 * Contract-shaped sample payloads for unit tests. Values are illustrative only (they are NOT model
 * outputs) and never ship in the app bundle.
 */
import type {
  CohortResponse,
  FeatureSchema,
  HealthResponse,
  MetricsReport,
  PredictResponse,
  TargetMetrics,
} from '@/types/contracts';

export const sampleSchema: FeatureSchema = {
  version: '1.0.0',
  model_version: '1.0.0',
  groups: [
    { id: 'demographics', label: 'Demographics', order: 1, icon: 'user' },
    { id: 'symptoms', label: 'Symptoms', order: 3, icon: 'activity' },
    { id: 'exam', label: 'Physical examination', order: 4, icon: 'stethoscope' },
    { id: 'ecg', label: 'ECG', order: 5, icon: 'heart-pulse' },
    { id: 'echo', label: 'Echocardiography', order: 7, icon: 'waves' },
  ],
  features: [
    {
      key: 'Age',
      label: 'Age',
      group: 'demographics',
      type: 'numeric',
      unit: 'years',
      min: 30,
      max: 86,
      step: 1,
      default: 58,
      normal: { low: null, high: null },
      description: 'Age in years.',
      options: null,
    },
    {
      key: 'Sex',
      label: 'Sex',
      group: 'demographics',
      type: 'categorical',
      default: 'Male',
      normal: { low: null, high: null },
      description: 'Biological sex recorded in the chart.',
      options: [
        { value: 'Male', label: 'Male' },
        { value: 'Female', label: 'Female' },
      ],
    },
    {
      key: 'Typical Chest Pain',
      label: 'Typical chest pain',
      group: 'symptoms',
      type: 'binary',
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      normal: { low: null, high: null },
      description: 'Typical angina.',
      phrase: 'typical chest pain',
    },
    {
      key: 'BP',
      label: 'Blood pressure',
      group: 'exam',
      type: 'numeric',
      unit: 'mmHg',
      min: 90,
      max: 190,
      step: 1,
      default: 130,
      normal: { low: 90, high: 120 },
      description: 'Systolic blood pressure.',
    },
    {
      key: 'PR',
      label: 'Pulse rate',
      group: 'exam',
      type: 'numeric',
      unit: 'bpm',
      min: 50,
      max: 110,
      step: 1,
      default: 72,
      normal: { low: 60, high: 100 },
      description: 'Resting pulse.',
    },
    {
      key: 'BBB',
      label: 'Bundle branch block',
      group: 'ecg',
      type: 'categorical',
      default: 'N',
      normal: { low: null, high: null },
      description: 'Bundle branch block on ECG.',
      options: [
        { value: 'N', label: 'None' },
        { value: 'LBBB', label: 'Left bundle branch block' },
        { value: 'RBBB', label: 'Right bundle branch block' },
      ],
    },
    {
      key: 'EF-TTE',
      label: 'Ejection fraction',
      group: 'echo',
      type: 'numeric',
      unit: '%',
      min: 15,
      max: 60,
      step: 1,
      default: 50,
      normal: { low: 50, high: 70 },
      description: 'Left ventricular ejection fraction (echo).',
    },
    {
      key: 'Region RWMA',
      label: 'Regional wall motion abnormality',
      group: 'echo',
      type: 'numeric',
      unit: null,
      min: 0,
      max: 4,
      step: 1,
      default: 0,
      normal: { low: null, high: null },
      description: 'Number of regions with abnormal wall motion (echo finding, not a lesion map).',
    },
  ],
  targets: [
    { id: 'CAD', label: 'Coronary artery disease', short: 'CAD', anatomy: ['heart'], kind: 'patient', threshold: 0.46 },
    {
      id: 'LAD',
      label: 'Left anterior descending artery',
      short: 'LAD',
      anatomy: ['Coronary_LAD', 'Coronary_LAD_Septal'],
      territory: 'Anterior wall, anterior septum, apex',
      kind: 'vessel',
      threshold: 0.5,
    },
    {
      id: 'LCX',
      label: 'Left circumflex artery',
      short: 'LCX',
      anatomy: ['Coronary_LCX'],
      territory: 'Lateral and posterolateral wall',
      kind: 'vessel',
      threshold: 0.45,
    },
    {
      id: 'RCA',
      label: 'Right coronary artery',
      short: 'RCA',
      anatomy: ['Coronary_RCA', 'Coronary_RCA_Marginal', 'Coronary_RCA_PDA', 'Coronary_RCA_PL', 'Coronary_RCA_Septal'],
      territory: 'Inferior wall, inferior septum, right ventricle',
      kind: 'vessel',
      threshold: 0.44,
    },
  ],
  risk_bands: [
    { id: 'low', max: 0.25 },
    { id: 'moderate', max: 0.5 },
    { id: 'high', max: 0.75 },
    { id: 'critical', max: 1.0 },
  ],
};

export const sampleCohort: CohortResponse = {
  patients: [
    {
      id: 'P-017',
      split: 'test',
      summary: '62 y · Male · typical angina · DM, HTN',
      features: {
        Age: 62,
        Sex: 'Male',
        'Typical Chest Pain': 1,
        BP: 140,
        PR: 72,
        BBB: 'N',
        'EF-TTE': 45,
        'Region RWMA': 2,
      },
      labels: { CAD: 1, LAD: 1, LCX: 0, RCA: 1 },
    },
    {
      id: 'P-120',
      split: 'dev',
      summary: '48 y · Female · atypical angina · no major risk factors',
      features: {
        Age: 48,
        Sex: 'Female',
        'Typical Chest Pain': 0,
        BP: 118,
        PR: 80,
        BBB: 'N',
        'EF-TTE': 58,
        'Region RWMA': 0,
      },
      labels: { CAD: 0, LAD: 0, LCX: 0, RCA: 0 },
    },
  ],
};

const explanation = (base: number, output: number) => ({
  space: 'log-odds' as const,
  base_value: base,
  output_value: output,
  contributions: [
    { feature: 'Typical Chest Pain', value: 1, shap: 0.94 },
    { feature: 'Age', value: 62, shap: 0.41 },
    { feature: 'Region RWMA', value: 2, shap: 0.3 },
    { feature: 'EF-TTE', value: 45, shap: 0.12 },
    { feature: 'BP', value: 140, shap: -0.05 },
    { feature: 'Sex', value: 'Male', shap: -0.18 },
    { feature: 'PR', value: 72, shap: 0.01 },
    { feature: 'BBB', value: 'N', shap: 0.0 },
  ],
});

export const samplePrediction: PredictResponse = {
  model_version: '1.0.0',
  engine: 'server',
  imputed: [],
  predictions: {
    CAD: { probability: 0.87, label: 1, threshold: 0.46, risk_band: 'critical', logit: 1.93 },
    LAD: { probability: 0.72, label: 1, threshold: 0.5, risk_band: 'high', logit: 1.26 },
    LCX: { probability: 0.38, label: 0, threshold: 0.45, risk_band: 'moderate', logit: -0.5 },
    RCA: { probability: 0.61, label: 1, threshold: 0.44, risk_band: 'high', logit: 0.53 },
  },
  explanations: {
    CAD: explanation(0.38, 1.93),
    LAD: explanation(-0.29, 1.26),
    LCX: explanation(-1.05, -0.5),
    RCA: explanation(-1.02, 0.53),
  },
  summary: { expected_diseased_vessels: 1.71, highest_risk_vessel: 'LAD' },
};

export const sampleHealth: HealthResponse = {
  status: 'ok',
  model_version: '1.0.0',
  targets: ['CAD', 'LAD', 'LCX', 'RCA'],
  engine: 'server',
  predictor: 'real',
};

const targetMetrics = (auc: number): TargetMetrics => ({
  selected_model: 'LR+XGB margin ensemble (Platt-calibrated)',
  cv: { roc_auc: { mean: auc - 0.01, std: 0.03 }, f1: { mean: 0.86, std: 0.04 } },
  test: {
    roc_auc: { value: auc, ci: [auc - 0.06, Math.min(1, auc + 0.04)] },
    pr_auc: { value: 0.95, ci: [0.9, 0.99] },
    f1: { value: 0.88, ci: [0.8, 0.94] },
    recall: { value: 0.93, ci: [0.84, 0.99] },
    specificity: { value: 0.8, ci: [0.6, 0.94] },
    precision: { value: 0.9, ci: [0.82, 0.97] },
    brier: { value: 0.09, ci: [0.06, 0.13] },
    mcc: { value: 0.7, ci: [0.52, 0.85] },
    accuracy: { value: 0.89, ci: [0.8, 0.95] },
  },
  threshold: 0.46,
  confusion_matrix: { tn: 14, fp: 3, fn: 2, tp: 42 },
  curves: {
    roc: { fpr: [0, 0.1, 1], tpr: [0, 0.8, 1] },
    pr: { recall: [0, 1], precision: [1, 0.7] },
    calibration: { mean_predicted: [0.2, 0.8], fraction_positive: [0.25, 0.78], count: [20, 41] },
    dca: { thresholds: [0.1, 0.5], model: [0.6, 0.4], treat_all: [0.68, 0.42], treat_none: [0, 0] },
  },
  leaderboard: [{ model: 'ensemble', roc_auc_mean: auc - 0.01, roc_auc_std: 0.03 }],
  global_importance: [{ feature: 'Typical Chest Pain', mean_abs_shap: 1.21 }],
  beeswarm: [],
});

export const sampleMetrics: MetricsReport = {
  version: '1.0.0',
  generated_at: '2026-09-30T00:00:00Z',
  dataset: {
    name: 'Extension of Z-Alizadeh Sani',
    n: 303,
    n_dev: 242,
    n_test: 61,
    prevalence: { CAD: 0.713, LAD: 0.584, LCX: 0.393, RCA: 0.376 },
  },
  protocol: { holdout: 'stratified 80/20', cv: '5-fold', seed: 42 },
  targets: { CAD: targetMetrics(0.93), LAD: targetMetrics(0.85), LCX: targetMetrics(0.78), RCA: targetMetrics(0.8) },
};

/** Minimal `Response` for fetch mocks. */
export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
