/**
 * TypeScript mirror of docs/CONTRACTS.md v1.0.0 — the binding interface between ml/, backend/,
 * anatomy/ and frontend/. Field names are copied verbatim; producers may ADD fields (typed here as
 * optional), never rename or remove one. Section numbers refer to CONTRACTS.md.
 */

// ------------------------------------------------------------------------------ §0 conventions

/** Targets in contract order. UIs and arrays always use this order. */
export const TARGET_ORDER = ['CAD', 'LAD', 'LCX', 'RCA'] as const;
export type KnownTargetId = (typeof TARGET_ORDER)[number];
/** Open string so targets added to `schema.targets` later flow through without a redesign. */
export type TargetId = KnownTargetId | (string & {});

/** Vessel-level targets (everything except the patient-level CAD target). */
export const VESSEL_TARGETS = ['LAD', 'LCX', 'RCA'] as const;
export type VesselTargetId = (typeof VESSEL_TARGETS)[number];

/** Never model inputs (target leakage) — enforced here too so the form can never send them. */
export const LEAKAGE_KEYS: ReadonlySet<string> = new Set(['LAD', 'LCX', 'RCA', 'Cath']);

export type RiskBandId = 'low' | 'moderate' | 'high' | 'critical';

/** Binary values are 0/1 at the API boundary; categoricals are option strings; numerics are numbers. */
export type FeatureValue = number | string;
export type FeatureVector = Record<string, FeatureValue>;

// ----------------------------------------------------------------------------- §2 feature schema

export type FeatureType = 'numeric' | 'binary' | 'categorical';
export type FeatureGroupId =
  | 'demographics'
  | 'risk_factors'
  | 'symptoms'
  | 'exam'
  | 'ecg'
  | 'labs'
  | 'echo'
  | (string & {});

export interface FeatureGroup {
  id: FeatureGroupId;
  label: string;
  order?: number | null;
  icon?: string | null;
}

export interface FeatureOption {
  value: string | number;
  label: string;
}

export interface NormalRange {
  low: number | null;
  high: number | null;
}

export interface FeatureSpec {
  /** Exact dataset column name; also the API key. */
  key: string;
  label: string;
  group: FeatureGroupId;
  type: FeatureType;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  /** Cohort median (numeric) or mode (binary / categorical). */
  default?: FeatureValue | null;
  normal?: NormalRange | null;
  description?: string | null;
  options?: FeatureOption[] | null;
  /** Additive (DESIGN_SYSTEM §7.8): short phrase for the narrative sentence, e.g. "typical chest pain". */
  phrase?: string | null;
  /** Additive (DESIGN_SYSTEM §7.8): compute an ICE strip for this feature (default true). */
  ice?: boolean | null;
}

export interface TargetSpec {
  id: TargetId;
  label: string;
  short?: string | null;
  /** GLB node names this target colours (e.g. `Coronary_LAD`, `Coronary_LAD_Septal`). */
  anatomy: string[];
  description?: string | null;
  /** Supplied territory in words (vessel targets). */
  territory?: string | null;
  /** Additive: `patient` | `vessel`. */
  kind?: string | null;
  /** Additive: deployed decision threshold. */
  threshold?: number | null;
}

export interface RiskBandSpecContract {
  id: RiskBandId;
  max: number;
  /** Additive: display label. The UI still shows `critical` as "Very high". */
  label?: string | null;
}

export interface DerivedFeatureSpec {
  key: string;
  label: string;
  op: string;
  inputs: string[];
  unit?: string | null;
  description?: string | null;
}

export interface FeatureSchema {
  version: string;
  groups: FeatureGroup[];
  features: FeatureSpec[];
  targets: TargetSpec[];
  risk_bands: RiskBandSpecContract[];
  /** Additive fields written by the ML exporter. */
  model_version?: string;
  derived_features?: DerivedFeatureSpec[];
  dropped_features?: string[];
}

// ------------------------------------------------------------------------------ §3 REST API

/** §3.1 GET /api/health (backend adds service fields; all optional here). */
export interface HealthResponse {
  status: 'ok';
  model_version: string;
  targets: TargetId[];
  engine: 'server';
  predictor?: 'real' | 'fake';
  schema_version?: string;
  n_features?: number;
  uptime_s?: number;
  frontend_served?: boolean;
  disclaimer?: string;
}

/** §3.2 POST /api/predict request. Missing keys are imputed with the schema default. */
export interface PredictRequest {
  features: FeatureVector;
}

export interface TargetPrediction {
  /** Calibrated probability in [0, 1]. */
  probability: number;
  /** 1 when probability ≥ threshold. */
  label: 0 | 1;
  threshold: number;
  risk_band: RiskBandId;
  /** Uncalibrated ensemble margin (log-odds). */
  logit: number;
}

export interface Contribution {
  /** Raw feature key (one-hot columns already summed). */
  feature: string;
  value: FeatureValue | boolean | null;
  /** Log-odds (margin-space) contribution. */
  shap: number;
}

export interface Explanation {
  space: 'log-odds' | (string & {});
  /** E[f(x)] in margin space. */
  base_value: number;
  /** Equals `predictions[t].logit`; base_value + Σ shap = output_value (to 1e-6). */
  output_value: number;
  /** Sorted by |shap| descending. */
  contributions: Contribution[];
}

export interface PredictionSummary {
  expected_diseased_vessels: number;
  highest_risk_vessel: TargetId;
}

export type EngineKind = 'server' | 'edge';

export interface PredictResponse {
  model_version: string;
  engine: EngineKind;
  imputed: string[];
  predictions: Record<TargetId, TargetPrediction>;
  explanations: Record<TargetId, Explanation>;
  summary: PredictionSummary;
}

/** §3.3 GET /api/cohort */
export type CohortSplit = 'test' | 'dev';

export interface CohortPatient {
  id: string;
  split: CohortSplit | (string & {});
  summary: string;
  features: FeatureVector;
  /** Catheterisation ground truth, 1 = CAD / stenotic. */
  labels: Record<TargetId, 0 | 1>;
}

export interface CohortResponse {
  patients: CohortPatient[];
  version?: string;
  note?: string;
}

/** Error body returned by the backend for 4xx/5xx. */
export interface ApiErrorItem {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown> | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  detail?: ApiErrorItem[] | null;
  request_id?: string | null;
}

// --------------------------------------------------------------------------- §4 metrics.json

export interface MetricWithCi {
  value: number;
  ci?: [number, number] | null;
}

export interface CvStat {
  mean: number;
  std: number;
}

export interface ConfusionMatrix {
  tn: number;
  fp: number;
  fn: number;
  tp: number;
}

export interface EvaluationCurves {
  roc: { fpr: number[]; tpr: number[]; thresholds?: number[] };
  pr: { recall: number[]; precision: number[]; thresholds?: number[] };
  calibration: { mean_predicted: number[]; fraction_positive: number[]; count: number[] };
  dca: { thresholds: number[]; model: number[]; treat_all: number[]; treat_none: number[] };
}

export interface LeaderboardRow {
  model: string;
  roc_auc_mean: number;
  roc_auc_std: number;
  f1_mean?: number;
  [extra: string]: unknown;
}

export interface GlobalImportance {
  feature: string;
  mean_abs_shap: number;
}

export interface BeeswarmFeature {
  feature: string;
  /** v = min-max-normalised feature value, s = SHAP. */
  points: { v: number | null; s: number }[];
}

export type TestMetricName =
  | 'roc_auc'
  | 'accuracy'
  | 'precision'
  | 'recall'
  | 'specificity'
  | 'f1'
  | 'pr_auc'
  | 'brier'
  | 'mcc';

export interface TargetMetrics {
  selected_model: string;
  cv: Partial<Record<'roc_auc' | 'f1' | 'accuracy' | 'precision' | 'recall' | (string & {}), CvStat>>;
  test: Partial<Record<TestMetricName | (string & {}), MetricWithCi>>;
  threshold: number;
  confusion_matrix: ConfusionMatrix;
  curves: EvaluationCurves;
  leaderboard: LeaderboardRow[];
  global_importance: GlobalImportance[];
  beeswarm: BeeswarmFeature[];
}

export interface MetricsReport {
  version: string;
  generated_at?: string;
  dataset: {
    name: string;
    n: number;
    n_dev: number;
    n_test: number;
    prevalence: Partial<Record<TargetId, number>>;
    [extra: string]: unknown;
  };
  protocol: {
    holdout?: string;
    cv?: string;
    tuning?: string;
    calibration?: string;
    threshold?: string;
    seed?: number;
    [extra: string]: unknown;
  };
  targets: Partial<Record<TargetId, TargetMetrics>>;
}

// ------------------------------------------------------------------ §5 portable model (subset)

/**
 * The subset of `model.json` the UI reads directly (calibration for the "typical → this patient"
 * footer, thresholds, bands). The full format — encoders and trees — is owned by the edge engine
 * (services/edge/), documented in ml/README.md#portable-model-format.
 */
export interface PortableTargetModel {
  calibration: { method: 'platt' | (string & {}); a: number; b: number };
  threshold: number;
  base_value: number;
  components?: unknown[];
  [extra: string]: unknown;
}

export interface PortableModel {
  format?: string;
  format_version?: string;
  model_version: string;
  targets?: TargetId[];
  vessel_targets?: TargetId[];
  risk_bands?: RiskBandSpecContract[];
  models: Record<TargetId, PortableTargetModel>;
  [extra: string]: unknown;
}

/** `fixtures.json`: cross-engine parity pairs. */
export interface ParityFixture {
  features: FeatureVector;
  expected: PredictResponse;
  id?: string;
}

// ------------------------------------------------------------------------ §6 anatomy assets

export type Vec3 = [number, number, number];

export interface CameraPose {
  position: Vec3 | number[];
  target: Vec3 | number[];
}

/** Additive (DESIGN_SYSTEM §7.8): C-arm view in degrees; +azimuth = LAO, +elevation = cranial. */
export interface BestView {
  azimuth: number;
  elevation: number;
  distance: number;
}

export interface ManifestLayer {
  id: string;
  node: string;
  label: string;
  explode: Vec3;
  order: number;
  /** Additive (§7.8). */
  pivot?: Vec3;
  hingeAxis?: Vec3;
  hingeDeg?: number;
  [extra: string]: unknown;
}

export interface ManifestStructure {
  id: string;
  node: string;
  label: string;
  layer: string;
  /** Target this structure is coloured by; absent/null = not predicted (e.g. left main). */
  target?: TargetId | null;
  explode?: Vec3;
  description?: string;
  territory?: string;
  /** Additive (§7.8). */
  bestView?: BestView;
  labelAnchor?: Vec3;
  labelNormal?: Vec3;
  rides?: string;
  [extra: string]: unknown;
}

export interface AnatomyManifest {
  version: string;
  glb: string;
  credits: string;
  layers: ManifestLayer[];
  structures: ManifestStructure[];
  camera: {
    home: CameraPose;
    focus?: Record<string, CameraPose>;
    [extra: string]: unknown;
  };
  [extra: string]: unknown;
}

/** `vessels.json`: centrelines, points ordered proximal → distal (direction of flow). */
export interface VesselCenterline {
  id: string;
  target?: TargetId | null;
  node: string;
  segments: { points: Vec3[]; radius: number[] }[];
}

export interface VesselsFile {
  version: string;
  units: 'scene' | (string & {});
  vessels: VesselCenterline[];
}
