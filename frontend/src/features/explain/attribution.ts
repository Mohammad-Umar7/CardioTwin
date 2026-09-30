/**
 * Attribution arithmetic for the Explain drawer (WORKSTATION_V2 §5.10): percentage points, data
 * modalities and the raising / lowering split. Pure functions over the CONTRACTS §3.2 explanation (log-odds
 * SHAP, `base + Σ shap = output` to 1e-6) and its v1.1 calibrated fields (§7.3).
 *
 * Percentage points. SHAP is exact and additive on the log-odds scale, where the model works. Probability is
 * a sigmoid of it, so there is no unique split of "98 % − 83 %" into per-input points. We use the one linear
 * rescaling that keeps every property a reader relies on:
 *
 *   pts_i = shap_i · (p − p₀) / (m − m₀)        p₀ = typical patient's probability, m = margin
 *
 * - the points add up exactly from the typical patient (p₀) to this patient (p);
 * - every sign is kept (the secant slope of the sigmoid is always positive);
 * - the ranking by size is the ranking of the exact SHAP values.
 * It is labelled as a rescaling wherever it is shown; the log-odds view stays one click away.
 */
import { NEGLIGIBLE_SHAP, platt, sigmoid, sortedContributions } from '@/lib/explain';
import { MODALITIES, MODALITY_ORDER } from '@/lib/modelNames';
import type { Contribution, Explanation } from '@/types/contracts';

/** CONTRACTS §7.3: calibrated-space fields (optional: older servers omit them). */
export interface CalibratedFields {
  calibrated_base_value?: number;
  calibrated_output_value?: number;
  contributions: (Contribution & { shap_calibrated?: number })[];
}

export type ExplanationV11 = Explanation & Partial<CalibratedFields>;

export interface Calibration {
  a: number;
  b: number;
}

export interface PointsScale {
  /** The typical cohort patient's probability, σ(calibrated base) — "A typical cohort patient scores 83 %". */
  typical: number;
  /** This patient's probability. */
  probability: number;
  /** Multiply a log-odds SHAP value by this to get its share of (p − p₀), on the 0–1 scale. */
  perLogOdds: number;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Platt slope `a` recovered from the calibrated contributions (shap_calibrated = a · shap). */
function slopeFromContributions(e: ExplanationV11): number | null {
  for (const c of e.contributions) {
    const cal = (c as { shap_calibrated?: number }).shap_calibrated;
    if (finite(cal) && Math.abs(c.shap) > 1e-9) return cal / c.shap;
  }
  return null;
}

/** The typical patient's probability: σ(calibrated_base_value), else Platt(base_value) from model.json. */
export function typicalProbability(e: ExplanationV11 | null | undefined, calibration?: Calibration | null): number | null {
  if (!e) return null;
  if (finite(e.calibrated_base_value)) return sigmoid(e.calibrated_base_value);
  if (calibration && finite(calibration.a) && finite(calibration.b)) return platt(e.base_value, calibration.a, calibration.b);
  return null;
}

/** The rescaling above, or null when the typical probability is unknown (no calibrated fields, no model.json). */
export function pointsScale(
  e: ExplanationV11 | null | undefined,
  probability: number | null | undefined,
  calibration?: Calibration | null,
): PointsScale | null {
  const typical = typicalProbability(e, calibration);
  if (!e || typical === null || !finite(probability)) return null;
  const dm = e.output_value - e.base_value;
  let perLogOdds: number;
  if (Math.abs(dm) > 1e-9) {
    perLogOdds = (probability - typical) / dm;
  } else {
    // No net movement: use the sigmoid's local slope at the typical patient.
    const a = calibration?.a ?? slopeFromContributions(e) ?? 1;
    perLogOdds = typical * (1 - typical) * a;
  }
  return { typical, probability, perLogOdds };
}

/** One contribution in percentage points (e.g. +10.4); null without a scale. */
export const toPoints = (shap: number, scale: PointsScale | null): number | null =>
  scale ? shap * scale.perLogOdds * 100 : null;

// ----------------------------------------------------------------------------------- modalities

export interface ModalityRow {
  /** Schema group id (demographics … echo). */
  group: string;
  label: string;
  short: string;
  /** Signed Σ SHAP (log-odds). */
  sum: number;
  /** Σ |SHAP|. */
  abs: number;
  /** Share of the total |SHAP| (0–1). */
  share: number;
  /** Contributions in this modality, largest |SHAP| first. */
  contributions: Contribution[];
}

/**
 * Evidence per data modality, in acquisition order (demographics → echo): "ECG adds +0.42 log-odds".
 * Every modality is listed, including ones that add nothing, so the strip keeps its shape between patients.
 */
export function modalityAttribution(
  e: Explanation | null | undefined,
  groupOf: (feature: string) => string | undefined,
  order: readonly string[] = MODALITY_ORDER,
): ModalityRow[] {
  const rows = new Map<string, ModalityRow>();
  const make = (group: string): ModalityRow => ({
    group,
    label: MODALITIES[group]?.name ?? group,
    short: MODALITIES[group]?.short ?? group,
    sum: 0,
    abs: 0,
    share: 0,
    contributions: [],
  });
  for (const g of order) rows.set(g, make(g));
  let total = 0;
  for (const c of sortedContributions(e)) {
    const g = groupOf(c.feature) ?? 'other';
    const row = rows.get(g) ?? rows.set(g, make(g)).get(g)!;
    row.sum += c.shap;
    row.abs += Math.abs(c.shap);
    row.contributions.push(c);
    total += Math.abs(c.shap);
  }
  for (const row of rows.values()) row.share = total > 0 ? row.abs / total : 0;
  return [...rows.values()];
}

// ------------------------------------------------------------------------------ raising / lowering

export interface DriverSplit {
  raising: Contribution[];
  lowering: Contribution[];
  /** Contributions not in the two top lists. */
  hidden: number;
}

/** Top `n` raising and top `n` lowering contributions (|SHAP| ≥ the negligible cut), largest first. */
export function splitDrivers(e: Explanation | null | undefined, n = 5): DriverSplit {
  const sorted = sortedContributions(e);
  const raising = sorted.filter((c) => c.shap >= NEGLIGIBLE_SHAP).slice(0, n);
  const lowering = sorted.filter((c) => c.shap <= -NEGLIGIBLE_SHAP).slice(0, n);
  return { raising, lowering, hidden: sorted.length - raising.length - lowering.length };
}

/** Largest |SHAP| in an explanation: the shared bar scale for one target (§5.10). */
export const shapScale = (e: Explanation | null | undefined): number =>
  Math.max(1e-6, ...(e?.contributions ?? []).map((c) => Math.abs(c.shap)));

// ------------------------------------------------------------------------------ display rounding

/**
 * Largest-remainder rounding: integers, each the floor or the ceiling of its value, that add up exactly to
 * round(Σ values). Signs are kept (a positive value never rounds below 0, a negative one never above 0).
 */
export function largestRemainder(values: readonly number[]): number[] {
  const total = Math.round(values.reduce((a, v) => a + v, 0));
  const floors = values.map((v) => Math.floor(v + 1e-9));
  let extra = total - floors.reduce((a, v) => a + v, 0);
  const order = values.map((v, i) => ({ i, r: v - floors[i]! })).sort((a, b) => b.r - a.r || a.i - b.i);
  const out = [...floors];
  for (let j = 0; j < order.length && extra > 0; j += 1, extra -= 1) out[order[j]!.i]! += 1;
  // Never a negative zero.
  return out.map((v) => (Object.is(v, -0) ? 0 : v));
}

/**
 * Every input's contribution as PRINTED, in display quanta: whole percentage points (`points`, null without
 * a points scale) and hundredths of log-odds (`logodds`). Rounded together with the largest-remainder rule,
 * so any printed total (a modality column, a group header, the raising / lowering footer) is exactly the sum
 * of the printed rows under it, and all of them add up to the printed net change.
 */
export interface RoundedContributions {
  points: ReadonlyMap<string, number> | null;
  logodds: ReadonlyMap<string, number>;
}

export function roundContributions(e: Explanation | null | undefined, scale: PointsScale | null): RoundedContributions {
  const list = e?.contributions ?? [];
  const keys = list.map((c) => c.feature);
  const zip = (q: number[]) => new Map(keys.map((k, i) => [k, q[i]!]));
  return {
    points: scale ? zip(largestRemainder(list.map((c) => c.shap * scale.perLogOdds * 100))) : null,
    logodds: zip(largestRemainder(list.map((c) => c.shap * 100))),
  };
}
