/**
 * Human names for models, features and data modalities (WORKSTATION_V2 §6.4 rule 3).
 *
 * The ML artifacts speak in internal ids (`lr_elasticnet`, `svm_rbf`, `ensemble`) and raw dataset
 * column names (`EF-TTE`, `Region RWMA`, `Tinversion`). Nothing on screen may show either: every page
 * that names a model or a feature goes through this module, so Performance, Methodology and the
 * Explain drawer's Model tab can never disagree about what the deployed model is called.
 *
 * Feature names come from `schema.features[].label` whenever the schema is loaded; the static map
 * below is only a fallback (and covers columns the schema no longer lists, e.g. dropped constants).
 */
import type { FeatureSpec } from '@/types/contracts';

// -------------------------------------------------------------------------------------- models

/** Leaderboard id of the model that is actually deployed (metrics.json → targets.*.leaderboard). */
export const DEPLOYED_MODEL_ID = 'ensemble';

export type ModelFamily = 'ensemble' | 'linear' | 'tree' | 'kernel' | 'neighbours' | 'reference';

export interface ModelInfo {
  /** Full display name ("Logistic regression (elastic net)"). */
  name: string;
  /** Compact name for tight rows and chart legends. */
  short: string;
  family: ModelFamily;
  /** One plain-language sentence for tooltips. */
  description: string;
}

/** Inputs of the pre-specified clinical baseline (`lr_core`), as human labels. */
export const CLINICAL_CORE_INPUTS = ['Age', 'Sex', 'Typical angina', 'Diabetes', 'Hypertension'] as const;

const MODELS: Record<string, ModelInfo> = {
  ensemble: {
    name: 'Ensemble: logistic regression + gradient-boosted trees',
    short: 'Ensemble (deployed)',
    family: 'ensemble',
    description:
      'A weighted blend of a logistic regression and gradient-boosted trees in log-odds space, Platt-calibrated. This is the deployed model.',
  },
  lr_l2: {
    name: 'Logistic regression (ridge, L2)',
    short: 'Logistic (L2)',
    family: 'linear',
    description: 'Linear model on all inputs with an L2 (ridge) penalty.',
  },
  lr_l1: {
    name: 'Logistic regression (lasso, L1)',
    short: 'Logistic (L1)',
    family: 'linear',
    description: 'Linear model on all inputs with an L1 (lasso) penalty that can drop inputs entirely.',
  },
  lr_elasticnet: {
    name: 'Logistic regression (elastic net)',
    short: 'Logistic (elastic net)',
    family: 'linear',
    description: 'Linear model on all inputs with a blend of L1 and L2 penalties.',
  },
  lr_core: {
    name: 'Clinical baseline: logistic regression on bedside inputs',
    short: 'Clinical baseline',
    family: 'linear',
    description: `Pre-specified bedside model: logistic regression on ${CLINICAL_CORE_INPUTS.join(', ').toLowerCase()} only — what a clinician knows before any test.`,
  },
  xgboost: {
    name: 'Gradient-boosted trees (XGBoost)',
    short: 'Boosted trees',
    family: 'tree',
    description: 'Shallow decision trees added one after another, each correcting the previous ones.',
  },
  hist_gb: {
    name: 'Histogram gradient boosting',
    short: 'Histogram boosting',
    family: 'tree',
    description: 'Gradient-boosted trees on binned inputs (scikit-learn), with fixed literature defaults.',
  },
  random_forest: {
    name: 'Random forest',
    short: 'Random forest',
    family: 'tree',
    description: 'Many deep decision trees on bootstrap samples, averaged.',
  },
  extra_trees: {
    name: 'Extremely randomised trees',
    short: 'Extra trees',
    family: 'tree',
    description: 'Like a random forest, with random split points for extra variance reduction.',
  },
  svm_rbf: {
    name: 'Support vector machine (RBF kernel)',
    short: 'SVM (RBF)',
    family: 'kernel',
    description: 'A non-linear margin classifier with a radial basis function kernel.',
  },
  knn: {
    name: 'k-nearest neighbours',
    short: 'k-nearest neighbours',
    family: 'neighbours',
    description: 'Predicts from the most similar development patients.',
  },
  dummy_prior: {
    name: 'No-skill reference (predicts prevalence)',
    short: 'No-skill reference',
    family: 'reference',
    description:
      'Always predicts the development-set prevalence; it ranks no patient above another (ROC-AUC 0.5).',
  },
};

/** Logistic variants the ensemble can carry as its linear part, in words for the deployed name. */
const LINEAR_PART: Record<string, string> = {
  lr_l2: 'ridge logistic regression',
  lr_l1: 'lasso logistic regression',
  lr_elasticnet: 'elastic-net logistic regression',
  lr_core: 'bedside logistic regression',
};

function titleFromId(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unnamed model';
}

/** Everything known about a model id; unknown ids get a readable fallback, never the raw id. */
export function modelInfo(id: string): ModelInfo {
  const known = MODELS[id];
  if (known) return known;
  const name = titleFromId(id);
  return { name, short: name, family: 'reference', description: name };
}

export const modelName = (id: string): string => modelInfo(id).name;
export const modelShortName = (id: string): string => modelInfo(id).short;
export const isDeployedModel = (id: string): boolean => id === DEPLOYED_MODEL_ID;

/**
 * Name of the deployed ensemble for one target, naming its linear part when known
 * (`targets.<t>.components.logistic.name`): "Ensemble: elastic-net logistic regression + gradient-boosted trees".
 */
export function deployedModelName(logisticId?: string | null): string {
  const linear = logisticId ? LINEAR_PART[logisticId] : undefined;
  return linear ? `Ensemble: ${linear} + gradient-boosted trees` : modelName(DEPLOYED_MODEL_ID);
}

/**
 * The deployed ensemble as a noun phrase for running prose ("Deployed: an ensemble of elastic-net
 * logistic regression and gradient-boosted trees, …"), so sentences never read "Deployed: Ensemble: …".
 */
export function deployedModelPhrase(logisticId?: string | null): string {
  const linear = (logisticId ? LINEAR_PART[logisticId] : undefined) ?? 'logistic regression';
  return `an ensemble of ${linear} and gradient-boosted trees`;
}

const LINEAR_PART_SHORT: Record<string, string> = {
  lr_l2: 'Ridge logistic',
  lr_l1: 'Lasso logistic',
  lr_elasticnet: 'Elastic-net logistic',
  lr_core: 'Bedside logistic',
};

/** Table-cell name of one target's deployed ensemble: "Elastic-net logistic + boosted trees". */
export function deployedModelShort(logisticId?: string | null): string {
  return `${(logisticId ? LINEAR_PART_SHORT[logisticId] : undefined) ?? 'Logistic'} + boosted trees`;
}

/** Row-sized name of the deployed ensemble (leaderboards, legends); the full name goes in tooltips. */
export const DEPLOYED_SHORT_NAME = 'Deployed ensemble';

/** Every internal id this module knows, longest first (so `lr_elasticnet` wins over `lr_l`). */
export const KNOWN_MODEL_IDS: readonly string[] = Object.keys(MODELS).sort((a, b) => b.length - a.length);

/**
 * Replace internal model ids inside free text (protocol strings written by the ML pipeline) with
 * their short names. Only whole tokens are replaced, so "xgboost" in a URL-like context is untouched
 * only if it is part of a longer word.
 */
export function humanizeModelIds(text: string): string {
  let out = text;
  for (const id of KNOWN_MODEL_IDS) {
    if (id === DEPLOYED_MODEL_ID) continue; // "ensemble" is an ordinary English word in prose
    const re = new RegExp(
      `(?<![A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`,
      'g',
    );
    out = out.replace(re, modelShortName(id));
  }
  return out;
}

// ------------------------------------------------------------------------------------ features

/**
 * Fallback labels for raw dataset keys (the schema's `label` wins whenever it is loaded). Also names
 * the constant columns the pipeline drops, which no longer appear in the schema.
 */
export const FEATURE_FALLBACK_NAMES: Readonly<Record<string, string>> = {
  Age: 'Age',
  Weight: 'Weight',
  Length: 'Height',
  Sex: 'Sex',
  BMI: 'Body-mass index',
  DM: 'Diabetes',
  HTN: 'Hypertension',
  'Current Smoker': 'Current smoker',
  'EX-Smoker': 'Former smoker',
  FH: 'Family history',
  Obesity: 'Obesity',
  CRF: 'Chronic renal failure',
  CVA: 'Previous stroke',
  'Airway disease': 'Airway disease',
  'Thyroid Disease': 'Thyroid disease',
  CHF: 'Congestive heart failure',
  DLP: 'Dyslipidaemia',
  'Typical Chest Pain': 'Typical angina',
  Atypical: 'Atypical angina',
  Nonanginal: 'Non-anginal chest pain',
  'Exertional CP': 'Exertional chest pain',
  'LowTH Ang': 'Low-threshold angina',
  Dyspnea: 'Shortness of breath',
  'Function Class': 'Functional class',
  BP: 'Blood pressure',
  PR: 'Pulse rate',
  Edema: 'Leg swelling',
  'Weak Peripheral Pulse': 'Weak peripheral pulse',
  'Lung rales': 'Lung crackles',
  'Systolic Murmur': 'Systolic murmur',
  'Diastolic Murmur': 'Diastolic murmur',
  'Q Wave': 'Q waves',
  'St Elevation': 'ST elevation',
  'St Depression': 'ST depression',
  Tinversion: 'T-wave inversion',
  LVH: 'Left ventricular hypertrophy',
  'Poor R Progression': 'Poor R-wave progression',
  BBB: 'Bundle branch block',
  FBS: 'Fasting blood sugar',
  CR: 'Creatinine',
  TG: 'Triglycerides',
  LDL: 'LDL cholesterol',
  HDL: 'HDL cholesterol',
  BUN: 'Blood urea nitrogen',
  ESR: 'Erythrocyte sedimentation rate',
  HB: 'Haemoglobin',
  K: 'Potassium',
  Na: 'Sodium',
  WBC: 'White blood cells',
  Lymph: 'Lymphocytes',
  Neut: 'Neutrophils',
  PLT: 'Platelets',
  'EF-TTE': 'Ejection fraction',
  'Region RWMA': 'Regional wall-motion abnormality',
  VHD: 'Valvular heart disease',
  Cath: 'Angiography result',
  LAD: 'LAD stenosis',
  LCX: 'LCX stenosis',
  RCA: 'RCA stenosis',
};

type FeatureLookup = ReadonlyMap<string, Pick<FeatureSpec, 'label'>> | null | undefined;

/** Human label of a raw feature key: schema label → fallback map → the key with separators cleaned. */
export function featureName(key: string, byKey?: FeatureLookup): string {
  const fromSchema = byKey?.get(key)?.label;
  if (fromSchema) return fromSchema;
  return FEATURE_FALLBACK_NAMES[key] ?? titleFromId(key);
}

// ----------------------------------------------------------------------------------- modalities

export interface ModalityInfo {
  name: string;
  short: string;
  /** Bedside = available at the first consultation without instruments beyond a cuff and stethoscope. */
  bedside: boolean;
}

/** The seven clinical data modalities (schema group ids), in acquisition order. */
export const MODALITIES: Readonly<Record<string, ModalityInfo>> = {
  demographics: { name: 'Demographics', short: 'Demographics', bedside: true },
  risk_factors: { name: 'Risk factors & history', short: 'History', bedside: true },
  symptoms: { name: 'Symptoms', short: 'Symptoms', bedside: true },
  exam: { name: 'Physical examination', short: 'Exam', bedside: true },
  ecg: { name: 'Resting ECG', short: 'ECG', bedside: false },
  labs: { name: 'Laboratory', short: 'Labs', bedside: false },
  echo: { name: 'Echocardiography', short: 'Echo', bedside: false },
};

export const MODALITY_ORDER: readonly string[] = Object.keys(MODALITIES);

export function modalityName(id: string, variant: 'name' | 'short' = 'name'): string {
  const info = MODALITIES[id];
  return info ? info[variant] : titleFromId(id);
}

// -------------------------------------------------------------------------------------- targets

/** How each target's positive / negative class reads in a sentence. */
export function targetClassNames(target: string): { positive: string; negative: string; noun: string } {
  if (target === 'CAD') return { positive: 'CAD', negative: 'no CAD', noun: 'coronary artery disease' };
  return {
    positive: `a stenotic ${target}`,
    negative: `a non-stenotic ${target}`,
    noun: `${target} stenosis`,
  };
}
