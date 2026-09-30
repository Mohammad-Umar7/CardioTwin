/**
 * Pure data shaping for the printable clinical report. Everything the report renders is computed here
 * from the stores' plain data (schema, features, prediction, cohort patient), so the page itself is a
 * thin presentational layer and every rule below is unit-tested (reportModel.test.ts).
 *
 * Semantics follow docs/design/WORKSTATION_V2.md §3:
 *   - probability p (numeral + Ember mark), band (fixed 25/50/75 buckets) and decision (p ≥ the target's
 *     tuned threshold) are three different things and are never mixed;
 *   - the decision is worded "Flagged" / "Not flagged" (CAD: "Flagged — above the 75 % threshold");
 *   - the contract id `critical` is shown as "Very high";
 *   - a stale value is never shown as current: while a prediction is running the report is "updating".
 */
import type {
  Contribution,
  Explanation,
  FeatureSchema,
  FeatureSpec,
  FeatureValue,
  FeatureVector,
  PredictResponse,
  TargetId,
  TargetSpec,
} from '@/types/contracts';
import { TARGET_ORDER } from '@/types/contracts';
import {
  EN_DASH,
  MINUS,
  THIN_SPACE,
  formatFeatureValue,
  formatNormalRange,
  formatProbability,
  rangeStatus,
  type FormattedProbability,
  type RangeStatus,
} from '@/lib/format';
import { DEFAULT_RISK_BANDS, RISK_BAND_STYLES, bandFor, type RiskBandId, type RiskBandSpec } from '@/theme/risk';

// ------------------------------------------------------------------------------------------ input

export type ReportPredictionStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ReportEngineStatus = 'resolving' | 'server' | 'edge' | 'unavailable';

export interface ReportPatient {
  id: string | null;
  split: string | null;
  /** Feature-based summary from the cohort ("54 y · Male · typical angina · smoker"); never cath labels. */
  summary?: string | null;
}

export interface ReportInput {
  schema: FeatureSchema;
  /** Current inputs (recorded + what-if edits). */
  features: FeatureVector;
  /** Inputs as recorded for the cohort patient (or the defaults of a custom/blank patient). */
  recorded: FeatureVector;
  prediction: PredictResponse | null;
  status: ReportPredictionStatus;
  error?: string | null;
  engineStatus: ReportEngineStatus;
  patient: ReportPatient;
  /** 'cohort' | 'custom' | 'blank' (patientStore.mode). */
  mode: string;
  /** Catheterisation ground truth, passed ONLY after the user revealed it (TEST patients). */
  truth?: Partial<Record<TargetId, 0 | 1>> | null;
  generatedAt: Date;
  /** Number of drivers listed per target (default 5). */
  topDrivers?: number;
}

// ----------------------------------------------------------------------------------------- output

export type ReportState = 'ready' | 'updating' | 'unavailable' | 'empty';

export interface ReportHeader {
  /** "P-011", "Custom patient" or "Blank patient". */
  patientLabel: string;
  patientId: string | null;
  /** "TEST" / "DEV" / null. */
  splitTag: string | null;
  /** "Held-out test patient — never seen in training". */
  splitText: string;
  /** "Male · 58 y" (empty when unknown). */
  demographics: string;
  /** Feature-based cohort summary, if any. */
  summary: string | null;
  generatedAt: Date;
  /** "30 Sep 2026, 10:42". */
  generatedText: string;
  /** ISO-8601 for <time dateTime>. */
  generatedIso: string;
  /** "Server" / "In-browser" / "—". */
  engineLabel: string;
  /** One sentence on the engine for the provenance block. */
  engineText: string;
  modelVersion: string | null;
  schemaVersion: string;
  /** Short deterministic id of (inputs, model version, engine): "CT-3F9A-21C0". */
  reportId: string;
}

export interface TargetTruth {
  stenotic: boolean;
  agrees: boolean;
}

export interface TargetResult {
  id: TargetId;
  short: string;
  label: string;
  territory: string | null;
  p: number;
  /** Probability text; one decimal only when needed to disambiguate it from the threshold. */
  pctText: string;
  pct: FormattedProbability;
  band: RiskBandId;
  bandLabel: string;
  /** "50–75 %". */
  bandRange: string;
  threshold: number;
  thresholdText: string;
  flagged: boolean;
  /** "Flagged" / "Not flagged". */
  verdict: string;
  /** CAD: "Flagged — above the 75 % threshold"; vessels: "Flagged — above LAD's 55 % threshold". */
  verdictLine: string;
  /** Plain sentence reconciling band and decision (V2 §3.1). */
  reconcile: string;
  truth: TargetTruth | null;
}

export interface DriverRow {
  feature: string;
  label: string;
  valueText: string;
  /** Contribution in percentage points (probability space, signed). */
  pp: number;
  ppText: string;
  direction: 'raises' | 'lowers';
}

export interface DriverPanel {
  target: TargetId;
  short: string;
  label: string;
  /** 'points' = calibrated percentage points; 'log-odds' = fallback when the engine sent no calibrated fields. */
  unit: 'points' | 'log-odds';
  /** Cohort baseline probability (points mode) or margin (log-odds mode). */
  baseline: number;
  baselineText: string;
  rows: DriverRow[];
  others: { count: number; value: number; text: string };
  /** Largest |value| among the rows, for a bar scale shared within the panel. */
  maxAbs: number;
  /** Short plain-language sentence naming the main drivers (no numbers). */
  sentence: string;
}

export interface InputRow {
  key: string;
  label: string;
  type: FeatureSpec['type'];
  valueText: string;
  refText: string;
  status: RangeStatus | null;
  /** "above normal" / "below normal" / null. */
  flagText: string | null;
  /** Binary present, or a categorical other than "none" (e.g. LBBB). */
  finding: boolean;
  imputed: boolean;
  edited: boolean;
  wasText: string | null;
}

export interface InputGroup {
  id: string;
  label: string;
  /** Numeric and categorical rows (and every edited or imputed binary). */
  rows: InputRow[];
  /** Binary inputs recorded as present. */
  present: InputRow[];
  /** Binary inputs recorded as absent. */
  absent: InputRow[];
  abnormalCount: number;
  findingCount: number;
}

export interface InputTotals {
  total: number;
  abnormal: number;
  findings: number;
  imputed: number;
  edited: number;
}

export interface ReportModel {
  state: ReportState;
  stateMessage: string | null;
  header: ReportHeader;
  cad: TargetResult | null;
  vessels: TargetResult[];
  flaggedCount: number;
  /** "2 of 3 flagged". */
  flaggedText: string;
  drivers: DriverPanel[];
  /** One sentence on what drives CAD (no numbers). */
  cadSentence: string;
  inputs: InputGroup[];
  totals: InputTotals;
  /** Number of inputs that differ from the recorded values (what-if scenario). */
  editedCount: number;
  /** Cath truth was revealed and is shown. */
  truthShown: boolean;
}

// -------------------------------------------------------------------------------------- helpers

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const sameValue = (a: FeatureValue | undefined, b: FeatureValue | undefined) =>
  a === b || (isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "30 Sep 2026, 10:42" in local time (deterministic, locale-independent). */
export function formatReportDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "2026-09-30" in local time (used in the saved PDF's file name). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 32-bit FNV-1a over a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic report id over the inputs, model version and engine: "CT-3F9A-21C0". Two reports carry
 * the same id exactly when the model saw the same inputs, so a printed page can be matched to a state.
 */
export function reportIdFor(features: FeatureVector, modelVersion: string | null, engine: string | null): string {
  const canonical = Object.keys(features)
    .sort()
    .map((k) => {
      const v = features[k];
      return `${k}=${isNum(v) ? Number(v.toPrecision(12)) : String(v)}`;
    })
    .join('|');
  const a = fnv1a(`${canonical}#${modelVersion ?? ''}#${engine ?? ''}`);
  const b = fnv1a(`${engine ?? ''}#${modelVersion ?? ''}#${canonical}`);
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
  return `CT-${hex(a).slice(0, 4)}-${hex(b).slice(0, 4)}`;
}

/** Percent text with a fixed number of decimals and a thin space: 0.7474 → "74.7 %". */
const pctFixed = (x: number, digits: number) => `${(x * 100).toFixed(digits)}${THIN_SPACE}%`;

/**
 * Probability and threshold texts that never contradict the decision. Both are integers ("72 %") unless
 * rounding would make them look equal or inverted (p = 0.745 vs threshold 0.7474 → "74.5 %" vs "74.7 %").
 */
export function decisionTexts(p: number, threshold: number): { pctText: string; thresholdText: string } {
  const f = formatProbability(p);
  const rp = Math.round(p * 100);
  const rt = Math.round(threshold * 100);
  const above = p >= threshold;
  const contradicts = rp === rt || (above && rp < rt) || (!above && rp > rt);
  if (!contradicts || f.qualifier !== '') return { pctText: f.text, thresholdText: pctFixed(threshold, 0) };
  return { pctText: pctFixed(p, 1), thresholdText: pctFixed(threshold, 1) };
}

/** "25–50 %", "< 25 %", "≥ 75 %" from the schema's band edges. */
export function bandRangeText(band: RiskBandId, bands: readonly RiskBandSpec[] = DEFAULT_RISK_BANDS): string {
  const sorted = [...bands].sort((a, b) => a.max - b.max);
  const i = sorted.findIndex((b) => b.id === band);
  if (i === -1) return '';
  const lo = i === 0 ? 0 : sorted[i - 1]!.max;
  const hi = sorted[i]!.max;
  const pct = (x: number) => Math.round(x * 100);
  if (i === 0) return `<${THIN_SPACE}${pct(hi)}${THIN_SPACE}%`;
  if (i === sorted.length - 1) return `≥${THIN_SPACE}${pct(lo)}${THIN_SPACE}%`;
  return `${pct(lo)}${EN_DASH}${pct(hi)}${THIN_SPACE}%`;
}

const schemaBands = (schema: FeatureSchema): RiskBandSpec[] =>
  schema.risk_bands?.length ? schema.risk_bands.map((b) => ({ id: b.id, max: b.max })) : [...DEFAULT_RISK_BANDS];

const targetShort = (t: TargetSpec | undefined, id: TargetId) => t?.short || id;

// --------------------------------------------------------------------------------------- results

export function targetResult(
  id: TargetId,
  prediction: PredictResponse,
  spec: TargetSpec | undefined,
  bands: readonly RiskBandSpec[],
  truth: Partial<Record<TargetId, 0 | 1>> | null | undefined,
): TargetResult | null {
  const pred = prediction.predictions[id];
  if (!pred || !isNum(pred.probability)) return null;
  const p = clamp01(pred.probability);
  const threshold = isNum(pred.threshold) ? pred.threshold : isNum(spec?.threshold) ? spec.threshold : 0.5;
  const band: RiskBandId = pred.risk_band && pred.risk_band in RISK_BAND_STYLES ? pred.risk_band : bandFor(p, bands);
  const flagged = pred.label === 1 || (pred.label !== 0 && p >= threshold);
  const { pctText, thresholdText } = decisionTexts(p, threshold);
  const short = targetShort(spec, id);
  const isCad = id === 'CAD' || spec?.kind === 'overall' || spec?.kind === 'patient';
  const verdict = flagged ? 'Flagged' : 'Not flagged';
  const verdictLine = isCad
    ? `${verdict} — ${flagged ? 'above' : 'below'} the ${thresholdText} threshold`
    : `${verdict} — ${flagged ? 'above' : 'below'} ${short}’s ${thresholdText} threshold`;
  const bandLabel = RISK_BAND_STYLES[band].label;
  const bandRange = bandRangeText(band, bands);
  const reconcile = `${bandLabel} probability (${bandRange}). ${
    flagged ? 'Flagged because' : 'Not flagged because'
  } ${short}’s decision threshold is ${thresholdText}.`;
  const truthValue = truth?.[id];
  return {
    id,
    short,
    label: spec?.label ?? id,
    territory: spec?.territory ?? null,
    p,
    pct: formatProbability(p),
    pctText,
    band,
    bandLabel,
    bandRange,
    threshold,
    thresholdText,
    flagged,
    verdict,
    verdictLine,
    reconcile,
    truth: truthValue === 0 || truthValue === 1 ? { stenotic: truthValue === 1, agrees: (truthValue === 1) === flagged } : null,
  };
}

// --------------------------------------------------------------------------------------- drivers

/** Additive calibrated-space fields (CONTRACTS §7.3); optional because older engines omit them. */
export type CalibratedContribution = Contribution & { shap_calibrated?: number | null };
export type CalibratedExplanation = Omit<Explanation, 'contributions'> & {
  calibrated_base_value?: number | null;
  calibrated_output_value?: number | null;
  contributions: CalibratedContribution[];
};

/**
 * SHAP contributions in percentage points.
 *
 * The model's SHAP values are exact in (calibrated) log-odds, where they add up: base + Σ shap = output.
 * Each one is mapped to probability with the SECANT slope of the logistic curve between the cohort
 * baseline and this estimate, so the mapping is sign-preserving and exactly additive:
 *   p_base + Σ pp_i = p.
 * Returns null when the explanation carries no calibrated baseline (the caller falls back to log-odds).
 */
export function contributionsInPoints(
  explanation: Explanation | null | undefined,
  probability: number,
): { baseline: number; points: Map<string, number> } | null {
  const e = explanation as CalibratedExplanation | null | undefined;
  if (!e || !isNum(e.calibrated_base_value) || !isNum(probability)) return null;
  const pBase = sigmoid(e.calibrated_base_value);
  const dm = e.output_value - e.base_value;
  const zOut = isNum(e.calibrated_output_value)
    ? e.calibrated_output_value
    : Math.log(clamp01(probability) / (1 - clamp01(probability)));
  // Platt slope a, used only when a contribution lacks shap_calibrated.
  const a = Math.abs(dm) > 1e-12 ? (zOut - e.calibrated_base_value) / dm : 1;
  const cal = e.contributions.map((c) => (isNum(c.shap_calibrated) ? c.shap_calibrated : c.shap * a));
  const sum = cal.reduce((s, v) => s + v, 0);
  const slope = Math.abs(sum) > 1e-9 ? (probability - pBase) / sum : pBase * (1 - pBase);
  const points = new Map<string, number>();
  e.contributions.forEach((c, i) => points.set(c.feature, cal[i]! * slope));
  return { baseline: pBase, points };
}

/** "+12.3 pts" / "−0.8 pts" / "0.0 pts" (percentage points, one decimal, true minus). */
export function formatPoints(pp: number): string {
  const v = pp * 100;
  const abs = Math.abs(v).toFixed(1);
  if (Number(abs) === 0) return `0.0${THIN_SPACE}pts`;
  return `${v > 0 ? '+' : MINUS}${abs}${THIN_SPACE}pts`;
}

/** "+0.94" / "−0.18" log-odds. */
export function formatLogOdds(v: number): string {
  const abs = Math.abs(v).toFixed(2);
  if (Number(abs) === 0) return '0.00';
  return `${v > 0 ? '+' : MINUS}${abs}`;
}

const lowerFirst = (s: string) =>
  s.length > 1 && s[1] === s[1]!.toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/** Words for one input in a sentence: "typical angina", "no diabetes", "ejection fraction 40 %", "LBBB". */
export function phraseForInput(spec: FeatureSpec | undefined, feature: string, value: unknown): string {
  if (!spec) return feature;
  if (spec.phrase) return spec.phrase;
  const label = lowerFirst(spec.label);
  if (spec.type === 'binary') {
    const on = value === 1 || value === true || value === '1';
    return on ? label : `no ${label}`;
  }
  const text = formatFeatureValue(spec, value as FeatureValue);
  if (spec.type === 'categorical') {
    if (text === 'None') return `no ${label}`;
    if (/^[A-Z0-9]{2,}$/.test(text)) return text;
    return `${text.toLowerCase()} ${label}`;
  }
  return `${label} ${text}`;
}

const joinAnd = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** "Raised mostly by typical angina and hypertension; lowered most by no wall-motion abnormality." */
export function driverSentence(rows: readonly DriverRow[], phrase: (r: DriverRow) => string): string {
  const ups = rows.filter((r) => r.direction === 'raises').slice(0, 2).map(phrase);
  const downs = rows.filter((r) => r.direction === 'lowers').slice(0, 1).map(phrase);
  if (ups.length === 0 && downs.length === 0) return 'No single input moves it much from the typical cohort patient.';
  const parts: string[] = [];
  if (ups.length) parts.push(`raised mostly by ${joinAnd(ups)}`);
  if (downs.length) parts.push(`lowered most by ${joinAnd(downs)}`);
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function driverPanel(
  id: TargetId,
  prediction: PredictResponse,
  spec: TargetSpec | undefined,
  byKey: ReadonlyMap<string, FeatureSpec>,
  top = 5,
): DriverPanel | null {
  const e = prediction.explanations[id];
  const pred = prediction.predictions[id];
  if (!e || !pred) return null;
  const inPoints = contributionsInPoints(e, pred.probability);
  const unit: DriverPanel['unit'] = inPoints ? 'points' : 'log-odds';
  const valueOf = (c: Contribution) => (inPoints ? (inPoints.points.get(c.feature) ?? 0) : c.shap);
  const all = e.contributions
    .map((c) => ({ c, v: valueOf(c) }))
    .filter(({ v }) => isNum(v))
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  const threshold = unit === 'points' ? 0.0005 : 0.005;
  const shown = all.slice(0, top).filter(({ v }) => Math.abs(v) >= threshold);
  const rest = all.slice(shown.length);
  const fmt = unit === 'points' ? formatPoints : formatLogOdds;
  const rows: DriverRow[] = shown.map(({ c, v }) => {
    const fs = byKey.get(c.feature);
    return {
      feature: c.feature,
      label: fs?.label ?? c.feature,
      valueText: fs ? formatFeatureValue(fs, c.value as FeatureValue) : String(c.value ?? '–'),
      pp: v,
      ppText: fmt(v),
      direction: v >= 0 ? 'raises' : 'lowers',
    };
  });
  const othersValue = rest.reduce((s, { v }) => s + v, 0);
  const baseline = inPoints ? inPoints.baseline : e.base_value;
  const valueByFeature = new Map(e.contributions.map((c) => [c.feature, c.value]));
  return {
    target: id,
    short: targetShort(spec, id),
    label: spec?.label ?? id,
    unit,
    baseline,
    baselineText: unit === 'points' ? formatProbability(baseline).text : formatLogOdds(baseline),
    rows,
    others: { count: rest.length, value: othersValue, text: fmt(othersValue) },
    maxAbs: rows.reduce((m, r) => Math.max(m, Math.abs(r.pp)), 0),
    sentence: driverSentence(rows, (r) => phraseForInput(byKey.get(r.feature), r.feature, valueByFeature.get(r.feature))),
  };
}

// ---------------------------------------------------------------------------------------- inputs

const isOn = (v: unknown) => v === 1 || v === true || v === '1' || (typeof v === 'string' && v.toUpperCase() === 'Y');

/** Categorical "finding": any value other than the schema's "none" option (N). Sex has no such option. */
function categoricalFinding(spec: FeatureSpec, value: unknown): boolean {
  const none = spec.options?.find((o) => String(o.value).toUpperCase() === 'N');
  if (!none || value === null || value === undefined || value === '') return false;
  return String(value).toUpperCase() !== 'N';
}

export function inputRow(
  spec: FeatureSpec,
  features: FeatureVector,
  recorded: FeatureVector,
  imputed: ReadonlySet<string>,
): InputRow {
  const value = features[spec.key];
  const status = spec.type === 'numeric' ? rangeStatus(value, spec.normal) : null;
  const flagged = status === 'above' || status === 'below';
  const edited = spec.key in recorded && !sameValue(value, recorded[spec.key]);
  return {
    key: spec.key,
    label: spec.label,
    type: spec.type,
    valueText: formatFeatureValue(spec, value),
    refText: spec.type === 'numeric' ? formatNormalRange(spec.normal, spec.step).replace(/^ref /, '') : '',
    status,
    flagText: flagged ? (status === 'above' ? 'above normal' : 'below normal') : null,
    finding: spec.type === 'binary' ? isOn(value) : spec.type === 'categorical' ? categoricalFinding(spec, value) : false,
    imputed: imputed.has(spec.key),
    edited,
    wasText: edited ? formatFeatureValue(spec, recorded[spec.key]) : null,
  };
}

export function inputGroups(
  schema: FeatureSchema,
  features: FeatureVector,
  recorded: FeatureVector,
  imputedKeys: readonly string[] = [],
): InputGroup[] {
  const imputed = new Set(imputedKeys);
  const declared = [...schema.groups].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const known = new Set(declared.map((g) => g.id));
  const orphans = schema.features.filter((f) => !known.has(f.group));
  const groups = declared.map((g) => ({ id: String(g.id), label: g.label, specs: schema.features.filter((f) => f.group === g.id) }));
  if (orphans.length) groups.push({ id: 'other', label: 'Other', specs: orphans });
  return groups
    .filter((g) => g.specs.length > 0)
    .map((g) => {
      const all = g.specs.map((s) => inputRow(s, features, recorded, imputed));
      // Binary inputs collapse into "Present" / "Absent" lines unless they need their own row.
      const own = (r: InputRow) => r.type !== 'binary' || r.edited || r.imputed;
      return {
        id: g.id,
        label: g.label,
        rows: all.filter(own),
        present: all.filter((r) => !own(r) && r.finding),
        absent: all.filter((r) => !own(r) && !r.finding),
        abnormalCount: all.filter((r) => r.flagText !== null).length,
        findingCount: all.filter((r) => r.finding).length,
      };
    });
}

// ---------------------------------------------------------------------------------------- header

/** "Male · 58 y" from the Sex and Age features (empty when neither is known). */
export function demographicsText(schema: FeatureSchema, features: FeatureVector): string {
  const sexSpec = schema.features.find((f) => f.key === 'Sex');
  const sex = sexSpec ? formatFeatureValue(sexSpec, features.Sex) : null;
  const age = isNum(features.Age) ? `${Math.round(features.Age)}${THIN_SPACE}y` : null;
  return [sex && sex !== '–' ? sex : null, age].filter(Boolean).join(' · ');
}

const ENGINE_TEXT: Record<string, { label: string; text: string }> = {
  server: {
    label: 'Server',
    text: 'Computed by the CardioTwin API (native Python models).',
  },
  edge: {
    label: 'In-browser',
    text: 'Computed in this browser by the portable model (verified against the server on the published fixtures).',
  },
};

export function reportHeader(input: ReportInput): ReportHeader {
  const { patient, prediction, schema, features, mode, generatedAt } = input;
  const id = patient.id;
  const split = patient.split;
  const patientLabel = id ?? (mode === 'blank' ? 'Blank patient' : 'Custom patient');
  const splitTag = split === 'test' ? 'TEST' : split === 'dev' ? 'DEV' : null;
  const splitText =
    split === 'test'
      ? 'Held-out test patient — never seen in training'
      : split === 'dev'
        ? 'Development cohort patient — used to train the model'
        : 'Custom inputs — not a cohort patient';
  const engine = prediction?.engine ?? null;
  const e = engine ? ENGINE_TEXT[engine] : undefined;
  return {
    patientLabel,
    patientId: id,
    splitTag,
    splitText,
    demographics: demographicsText(schema, features),
    summary: patient.summary ?? null,
    generatedAt,
    generatedText: formatReportDate(generatedAt),
    generatedIso: generatedAt.toISOString(),
    engineLabel: e?.label ?? '—',
    engineText: e?.text ?? 'No prediction engine answered.',
    modelVersion: prediction?.model_version ?? schema.model_version ?? null,
    schemaVersion: schema.version,
    reportId: reportIdFor(features, prediction?.model_version ?? null, engine),
  };
}

// ------------------------------------------------------------------------------------------ build

function reportState(input: ReportInput): { state: ReportState; message: string | null } {
  if (Object.keys(input.features).length === 0) return { state: 'empty', message: 'No patient is loaded yet.' };
  if (input.status === 'loading' || input.status === 'idle' || input.engineStatus === 'resolving')
    return { state: 'updating', message: 'Updating the estimate for the current inputs…' };
  if (input.status === 'error' || input.engineStatus === 'unavailable' || !input.prediction)
    return {
      state: 'unavailable',
      message: input.error || 'Estimate unavailable: no prediction engine answered. No numbers are shown.',
    };
  return { state: 'ready', message: null };
}

/** Shapes the whole report. Estimates are only included in the 'ready' state (never stale values). */
export function buildReport(input: ReportInput): ReportModel {
  const { schema, features, recorded, prediction } = input;
  const { state, message } = reportState(input);
  const bands = schemaBands(schema);
  const byKey = new Map(schema.features.map((f) => [f.key, f]));
  const specs = new Map(schema.targets.map((t) => [t.id, t]));
  const rank = (id: string) => {
    const i = (TARGET_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? TARGET_ORDER.length : i;
  };
  const targets = [...schema.targets].sort((a, b) => rank(a.id) - rank(b.id));
  const isVessel = (t: TargetSpec) => (t.kind ? t.kind === 'vessel' : t.id !== 'CAD');
  const truth = input.truth ?? null;

  const ready = state === 'ready' && prediction !== null;
  const cadSpec = targets.find((t) => !isVessel(t));
  const cad = ready && cadSpec ? targetResult(cadSpec.id, prediction, cadSpec, bands, truth) : null;
  const vessels = ready
    ? targets
        .filter(isVessel)
        .map((t) => targetResult(t.id, prediction, t, bands, truth))
        .filter((r): r is TargetResult => r !== null)
    : [];
  const drivers = ready
    ? targets
        .map((t) => driverPanel(t.id, prediction, specs.get(t.id), byKey, input.topDrivers ?? 5))
        .filter((d): d is DriverPanel => d !== null)
    : [];
  const flaggedCount = vessels.filter((v) => v.flagged).length;
  const inputs = inputGroups(schema, features, recorded, prediction?.imputed ?? []);
  const rows = inputs.flatMap((g) => [...g.rows, ...g.present, ...g.absent]);
  const editedCount = rows.filter((r) => r.edited).length;
  const cadDrivers = drivers.find((d) => d.target === cadSpec?.id);

  return {
    state,
    stateMessage: message,
    header: reportHeader(input),
    cad,
    vessels,
    flaggedCount,
    flaggedText: `${flaggedCount} of ${vessels.length || targets.filter(isVessel).length} flagged`,
    drivers,
    cadSentence: cadDrivers?.sentence ?? '',
    inputs,
    totals: {
      total: rows.length,
      abnormal: rows.filter((r) => r.flagText !== null).length,
      findings: rows.filter((r) => r.finding).length,
      imputed: rows.filter((r) => r.imputed).length,
      edited: editedCount,
    },
    editedCount,
    truthShown: ready && truth !== null && [cad, ...vessels].some((r) => r?.truth),
  };
}
