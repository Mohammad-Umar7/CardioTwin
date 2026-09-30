/**
 * The edge model — port of `portable.PortableModel`: compile `model.json` once, then evaluate
 * predictions and exact SHAP explanations synchronously (≈ 0.1–0.5 ms per full prediction).
 *
 * Per patient:
 *   features → normalise + impute → encode (float64) → per target, per component margin m_k
 *   → ensemble m = Σ w_k·m_k → p = σ(a·m + b) (Platt) → label (p ≥ threshold), risk band
 *   → SHAP Σ w_k·φ_k, one-hot columns summed per raw feature → calibrated scale a·φ, a·base + b
 *
 * Arithmetic order matches the reference line by line; `fixtures.json` is reproduced to ~1e-15.
 */
import type { PredictionSummary, RiskBandId, TargetId, TargetPrediction } from '@/types/contracts';
import { encode } from './encode';
import { ModelFormatError } from './errors';
import { accumulateLogisticShap, compileLogistic, logisticMargin, type CompiledLogistic } from './logistic';
import { normaliseFeatures, type NormalisedFeatures } from './normalise';
import { sigmoid } from './numeric';
import {
  PORTABLE_MODEL_FORMAT,
  SUPPORTED_FORMAT_MAJOR,
  type EdgeContribution,
  type EdgeExplanation,
  type EdgeFeatureInput,
  type EdgePredictResponse,
  type EdgeScore,
  type NormalisedValue,
  type PortableModelSpec,
  type RiskBandSpec,
  type TargetModelSpec,
} from './types';
import { TreeShapWorkspace, compileXGBoost, toFloat32Row, xgboostMargin, xgboostShap, type CompiledXGBoost } from './xgboost';

type CompiledComponent = CompiledLogistic | CompiledXGBoost;

interface CompiledTarget {
  readonly id: TargetId;
  readonly components: readonly CompiledComponent[];
  readonly a: number;
  readonly b: number;
  readonly threshold: number;
}

/** First band with `p < max`, else the last band — `portable.risk_band`. */
export function riskBand(bands: readonly RiskBandSpec[], p: number): RiskBandId {
  for (const band of bands) if (p < band.max) return band.id;
  const last = bands[bands.length - 1];
  if (!last) throw new ModelFormatError('model.json defines no risk bands');
  return last.id;
}

/** Structural validation with actionable messages; throws `ModelFormatError`. */
export function assertPortableModelSpec(spec: unknown): asserts spec is PortableModelSpec {
  const s = spec as Partial<PortableModelSpec> | null;
  if (!s || typeof s !== 'object') throw new ModelFormatError('model.json is not an object');
  if (s.format !== PORTABLE_MODEL_FORMAT) throw new ModelFormatError(`unexpected format '${String(s.format)}'`);
  const major = Number(String(s.format_version ?? '').split('.')[0]);
  if (major !== SUPPORTED_FORMAT_MAJOR) {
    throw new ModelFormatError(`format_version ${String(s.format_version)} is not supported (need ${SUPPORTED_FORMAT_MAJOR}.x)`);
  }
  if (s.margin_space !== 'log-odds') throw new ModelFormatError(`unsupported margin_space '${String(s.margin_space)}'`);
  for (const key of ['targets', 'vessel_targets', 'features', 'columns', 'encoding', 'derived', 'attribution', 'risk_bands'] as const) {
    if (!Array.isArray(s[key])) throw new ModelFormatError(`model.json: '${key}' must be an array`);
  }
  if (!s.models || typeof s.models !== 'object') throw new ModelFormatError("model.json: 'models' is missing");
  if (!s.constants || typeof s.constants !== 'object') throw new ModelFormatError("model.json: 'constants' is missing");
  for (const t of s.targets!) if (!s.models[t]) throw new ModelFormatError(`model.json: no model for target '${t}'`);
  for (const v of s.vessel_targets!) {
    if (!s.targets!.includes(v)) throw new ModelFormatError(`model.json: vessel target '${v}' is not a target`);
  }
  const d = s.columns!.length;
  for (const group of s.attribution!) {
    for (const j of group.column_indices) {
      if (!Number.isInteger(j) || j < 0 || j >= d) throw new ModelFormatError(`attribution '${group.feature}': bad column index ${j}`);
    }
  }
}

function compileTarget(id: TargetId, spec: TargetModelSpec, nColumns: number): CompiledTarget {
  if (spec.calibration?.method !== 'platt') {
    throw new ModelFormatError(`${id}: unsupported calibration '${String(spec.calibration?.method)}'`);
  }
  const components = spec.components.map((comp): CompiledComponent => {
    if (comp.type === 'logistic') return compileLogistic(comp, nColumns);
    if (comp.type === 'xgboost') return compileXGBoost(comp, nColumns);
    throw new ModelFormatError(`${id}: unknown component type '${(comp as { type: string }).type}'`);
  });
  return { id, components, a: spec.calibration.a, b: spec.calibration.b, threshold: spec.threshold };
}

/** Everything `encode` produces for one request, exposed for tests and debugging. */
export interface EncodedRequest extends NormalisedFeatures {
  x: Float64Array;
  derived: Record<string, number>;
}

export class EdgeModel {
  readonly spec: PortableModelSpec;
  readonly modelVersion: string;
  readonly targets: readonly TargetId[];
  private readonly compiled: readonly CompiledTarget[];
  private readonly workspace: TreeShapWorkspace;
  private readonly nColumns: number;

  constructor(spec: PortableModelSpec) {
    assertPortableModelSpec(spec);
    this.spec = spec;
    this.modelVersion = spec.model_version;
    this.targets = [...spec.targets];
    this.nColumns = spec.columns.length;
    this.compiled = spec.targets.map((t) => compileTarget(t, spec.models[t]!, this.nColumns));
    let maxDepth = 0;
    for (const target of this.compiled) {
      for (const comp of target.components) if (comp.type === 'xgboost') maxDepth = Math.max(maxDepth, comp.maxDepth);
    }
    this.workspace = new TreeShapWorkspace(maxDepth);
  }

  /** Normalise, impute and encode one request (throws `FeatureInputError` on bad input). */
  encode(input: EdgeFeatureInput): EncodedRequest {
    const normalised = normaliseFeatures(this.spec.features, input);
    const { x, derived } = encode(this.spec, normalised.values);
    return { ...normalised, x, derived };
  }

  /** Full §3.2 response with exact SHAP explanations (`engine = "edge"`). */
  predict(input: EdgeFeatureInput): EdgePredictResponse {
    const { values, imputed, x, derived } = this.encode(input);
    const x32 = toFloat32Row(x);
    const d = this.nColumns;
    const phi = new Float64Array(d);
    // Filled for every model target below (the contract types the maps with the known target ids).
    const predictions = {} as Record<TargetId, TargetPrediction>;
    const explanations = {} as Record<TargetId, EdgeExplanation>;
    for (const target of this.compiled) {
      let margin = 0.0;
      let base = 0.0;
      const shapCols = new Float64Array(d);
      for (const comp of target.components) {
        const w = comp.weight;
        if (comp.type === 'logistic') {
          margin += w * logisticMargin(comp, x);
          base += w * comp.baseValue;
          accumulateLogisticShap(comp, x, w, shapCols);
        } else {
          margin += w * xgboostMargin(comp, x32);
          base += w * comp.baseValue;
          phi.fill(0);
          xgboostShap(comp, x32, phi, this.workspace);
          for (let j = 0; j < d; j++) shapCols[j] = shapCols[j] + w * phi[j];
        }
      }
      const calibrated = target.a * margin + target.b;
      predictions[target.id] = this.targetPrediction(target, margin, calibrated);
      explanations[target.id] = {
        space: 'log-odds',
        base_value: base,
        output_value: margin,
        contributions: this.contributions(values, derived, shapCols, target.a),
        calibrated_base_value: target.a * base + target.b,
        calibrated_output_value: calibrated,
      };
    }
    return {
      model_version: this.modelVersion,
      engine: 'edge',
      imputed,
      predictions,
      explanations,
      summary: this.summary(predictions),
    };
  }

  /** Predictions and summary without explanations: the fast path for ICE strips and sweeps. */
  score(input: EdgeFeatureInput): EdgeScore {
    const { imputed, x } = this.encode(input);
    const x32 = toFloat32Row(x);
    const predictions = {} as Record<TargetId, TargetPrediction>;
    for (const target of this.compiled) {
      let margin = 0.0;
      for (const comp of target.components) {
        margin += comp.weight * (comp.type === 'logistic' ? logisticMargin(comp, x) : xgboostMargin(comp, x32));
      }
      predictions[target.id] = this.targetPrediction(target, margin, target.a * margin + target.b);
    }
    return { model_version: this.modelVersion, engine: 'edge', imputed, predictions, summary: this.summary(predictions) };
  }

  private targetPrediction(target: CompiledTarget, margin: number, calibrated: number): TargetPrediction {
    const p = sigmoid(calibrated);
    return {
      probability: p,
      label: p >= target.threshold ? 1 : 0,
      threshold: target.threshold,
      risk_band: riskBand(this.spec.risk_bands, p),
      logit: margin,
    };
  }

  private summary(predictions: Record<TargetId, TargetPrediction>): PredictionSummary {
    let expected = 0.0;
    let highest: TargetId | null = null;
    for (const v of this.spec.vessel_targets) {
      const p = predictions[v]!.probability;
      expected += p;
      if (highest === null || p > predictions[highest]!.probability) highest = v;
    }
    // The contract types the field as a target id; a model without vessel targets reports null.
    return { expected_diseased_vessels: expected, highest_risk_vessel: highest as TargetId };
  }

  private contributions(
    values: Readonly<Record<string, NormalisedValue>>,
    derived: Readonly<Record<string, number>>,
    shapCols: Float64Array,
    slope: number,
  ): EdgeContribution[] {
    const rows: EdgeContribution[] = [];
    for (const group of this.spec.attribution) {
      let s = 0.0;
      for (const j of group.column_indices) s += shapCols[j];
      const name = group.feature;
      if (group.derived_from && group.derived_from.length > 0) {
        rows.push({ feature: name, value: derived[name]!, shap: s, shap_calibrated: slope * s, derived_from: [...group.derived_from] });
      } else {
        const v = values[name]!;
        // Python emits integral numbers as ints: int(-0.0) == 0.
        rows.push({ feature: name, value: typeof v === 'number' && Object.is(v, -0) ? 0 : v, shap: s, shap_calibrated: slope * s });
      }
    }
    rows.sort((r1, r2) => {
      const byMagnitude = Math.abs(r2.shap) - Math.abs(r1.shap);
      if (byMagnitude !== 0) return byMagnitude;
      return r1.feature < r2.feature ? -1 : r1.feature > r2.feature ? 1 : 0;
    });
    return rows;
  }
}

/** Validate and compile a parsed `model.json`. */
export function compileModel(spec: unknown): EdgeModel {
  assertPortableModelSpec(spec);
  return new EdgeModel(spec);
}
