/**
 * Types of the portable model (`model.json`, format `cardiotwin-portable-model` 1.x) and of the edge
 * engine's output. The layout is specified field by field in `ml/README.md` ("Portable model format");
 * the reference evaluator is `ml/src/cardiotwin_ml/portable.py`. `types/contracts.ts` only mirrors the
 * subset the UI reads; everything the evaluator needs lives here.
 */
import type {
  Contribution,
  Explanation,
  FeatureValue,
  PredictResponse,
  PredictionSummary,
  RiskBandId,
  TargetId,
  TargetPrediction,
} from '@/types/contracts';

// ------------------------------------------------------------------------------------ model.json

export const PORTABLE_MODEL_FORMAT = 'cardiotwin-portable-model';
/** Major version of the layout this evaluator implements; a different major is rejected. */
export const SUPPORTED_FORMAT_MAJOR = 1;

export type RawFeatureType = 'numeric' | 'binary' | 'categorical';

/** One raw API input, in encoding order. */
export interface PortableFeature {
  key: string;
  type: RawFeatureType;
  /** Cohort median / mode used when the request omits the key (reported in `imputed`). */
  default: number | string;
  /** Categorical only: canonical option spellings. */
  options?: string[];
  /** Categorical only: dataset spelling → canonical option (matched case-insensitively). */
  aliases?: Record<string, string>;
}

export type EncodingSpec =
  | { kind: 'numeric' | 'binary'; feature: string; column: string }
  | { kind: 'ordinal'; feature: string; column: string; map: Record<string, number> }
  | { kind: 'onehot'; feature: string; categories: string[]; columns: string[] };

export type DerivedOp = 'ratio' | 'sum' | 'ckd_epi_2021';

export interface DerivedSpec {
  feature: string;
  column: string;
  op: DerivedOp | (string & {});
  inputs: string[];
}

export interface AttributionGroup {
  feature: string;
  columns: string[];
  column_indices: number[];
  /** Present on derived rows: the raw inputs the derived value was computed from. */
  derived_from?: string[] | null;
}

export interface LogisticComponentSpec {
  type: 'logistic';
  name: string;
  weight: number;
  intercept: number;
  coef: number[];
  scaler: { mean: number[]; scale: number[] };
  /** Development-set column means: the SHAP background of the linear explainer. */
  background_mean: number[];
  base_value: number;
}

/** A node of an XGBoost JSON dump. Internal nodes carry the split fields, leaves carry `leaf`. */
export interface XGBoostNodeSpec {
  nodeid: number;
  cover: number;
  split?: string;
  split_index?: number;
  /** float32 threshold stored as the exact double. */
  split_condition?: number;
  yes?: number;
  no?: number;
  missing?: number;
  leaf?: number;
  children?: XGBoostNodeSpec[];
}

export interface XGBoostComponentSpec {
  type: 'xgboost';
  name: string;
  weight: number;
  objective: string;
  /** Probability-space base score, as stored by XGBoost 3.x. */
  base_score: number;
  n_trees: number;
  base_value: number;
  trees: XGBoostNodeSpec[];
}

export type ComponentSpec = LogisticComponentSpec | XGBoostComponentSpec;

export interface TargetModelSpec {
  components: ComponentSpec[];
  calibration: { method: 'platt' | (string & {}); a: number; b: number };
  threshold: number;
  threshold_f1?: number;
  base_value: number;
}

export interface RiskBandSpec {
  id: RiskBandId;
  max: number;
}

export interface PortableModelSpec {
  format: string;
  format_version: string;
  model_version: string;
  margin_space: 'log-odds' | (string & {});
  targets: TargetId[];
  vessel_targets: TargetId[];
  features: PortableFeature[];
  columns: string[];
  encoding: EncodingSpec[];
  derived: DerivedSpec[];
  constants: { ratio_min_denominator: number; ckd_epi_min_creatinine: number; [extra: string]: number };
  attribution: AttributionGroup[];
  risk_bands: RiskBandSpec[];
  models: Record<TargetId, TargetModelSpec>;
}

// ------------------------------------------------------------------------------ engine inputs

/**
 * What callers may send: the contract's `FeatureVector` plus the spellings the reference evaluator
 * also accepts (booleans for binaries, `null`/`undefined` = "impute the default").
 */
export type EdgeFeatureValue = FeatureValue | boolean | null | undefined;
export type EdgeFeatureInput = Readonly<Record<string, EdgeFeatureValue>>;

/** API-normalised value: 0/1 for binaries, the canonical option for categoricals, a float otherwise. */
export type NormalisedValue = number | string;

// ----------------------------------------------------------------------------- engine outputs

/** §3.2 contribution plus the v1.1 calibrated-space field (CONTRACTS §7.3) and derived provenance. */
export interface EdgeContribution extends Contribution {
  value: number | string;
  /** `calibration.a · shap`: the same attribution on the calibrated log-odds scale. */
  shap_calibrated: number;
  derived_from?: string[];
}

export interface EdgeExplanation extends Explanation {
  space: 'log-odds';
  contributions: EdgeContribution[];
  /** `a · base_value + b`. */
  calibrated_base_value: number;
  /** `a · output_value + b`; `σ(calibrated_output_value)` is the displayed probability. */
  calibrated_output_value: number;
}

/** Exactly the §3.2 `PredictResponse`, produced in the browser (`engine = "edge"`). */
export interface EdgePredictResponse extends PredictResponse {
  engine: 'edge';
  explanations: Record<TargetId, EdgeExplanation>;
}

/**
 * Explanation-free result for high-volume sweeps (ICE strips, counterfactual search): the same
 * predictions and summary as `EdgePredictResponse`, computed without TreeSHAP (≈ 5–10× cheaper).
 */
export interface EdgeScore {
  model_version: string;
  engine: 'edge';
  imputed: string[];
  predictions: Record<TargetId, TargetPrediction>;
  summary: PredictionSummary;
}
