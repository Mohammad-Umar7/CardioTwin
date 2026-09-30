/**
 * Patient profiles in and out of the app (the owner's "feature input workflow"):
 *
 *   • JSON profile  — `buildProfile` / `parseProfile`: a documented, human-readable file with the recorded
 *     inputs and the current (what-if) inputs. Import is forgiving: it also accepts a bare
 *     `{ "features": {…} }` object or a flat `{ "<key or label>": value }` map, matches labels and keys
 *     case-insensitively, reads Yes/No/Y/N/true/false for findings, clamps out-of-range numbers, and
 *     drops target columns (LAD, LCX, RCA, Cath are never model inputs).
 *
 *   • Share link    — `encodeShareState` / `decodeShareState`: the edits packed into one URL-safe query
 *     value, e.g. `?w=1_4ksq2_P-011__g-0.1c-70` (≈ 5 characters per edited input). Inputs are addressed
 *     by their schema index, guarded by a checksum of the schema's key list, so a link made with another
 *     model version is refused instead of silently mis-mapping values.
 *
 * Only the characters [0-9a-zA-Z._-] are used, so `URLSearchParams` never percent-encodes the value.
 */
import type { SchemaIndex } from '@/hooks/useData';
import { LEAKAGE_KEYS, type FeatureSpec, type FeatureValue, type FeatureVector } from '@/types/contracts';
import { changedKeys, inRange, isPresent, sameValue, snapNumeric } from './values';

// =============================================================================================== JSON

export const PROFILE_FORMAT = 'cardiotwin.patient-profile';
export const PROFILE_VERSION = 1;

export interface PatientProfile {
  format: typeof PROFILE_FORMAT;
  version: typeof PROFILE_VERSION;
  exported_at: string;
  schema_version: string;
  model_version?: string;
  /** The cohort patient these inputs belong to, or null for a blank / imported patient. */
  patient: { id: string; split: string | null } | null;
  /** Inputs as recorded (the what-if baseline). */
  recorded: FeatureVector;
  /** Current inputs (recorded + what-if edits). */
  features: FeatureVector;
  note: string;
}

export const PROFILE_NOTE =
  'CardioTwin patient profile: model inputs only (raw dataset keys, CONTRACTS §2). Decision support and education only — not a diagnosis.';

export function buildProfile(input: {
  index: SchemaIndex;
  patientId: string | null;
  split: string | null;
  recorded: FeatureVector;
  features: FeatureVector;
  now?: Date;
}): PatientProfile {
  const pick = (v: FeatureVector) => {
    const out: FeatureVector = {};
    for (const f of input.index.features) if (v[f.key] !== undefined) out[f.key] = v[f.key]!;
    return out;
  };
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exported_at: (input.now ?? new Date()).toISOString(),
    schema_version: input.index.schema.version,
    ...(input.index.schema.model_version ? { model_version: input.index.schema.model_version } : null),
    patient: input.patientId ? { id: input.patientId, split: input.split } : null,
    recorded: pick(input.recorded),
    features: pick(input.features),
    note: PROFILE_NOTE,
  };
}

/** Download file name: "cardiotwin-P-011-what-if-2026-09-30.json". */
export function profileFileName(profile: PatientProfile): string {
  const who = profile.patient?.id ?? 'patient';
  const edits = changedKeys(profile.features, profile.recorded).length;
  return `cardiotwin-${who}${edits > 0 ? '-what-if' : ''}-${profile.exported_at.slice(0, 10)}.json`;
}

/** A normalised, validated profile ready to apply. */
export interface ImportedProfile {
  /** Cohort id when the file names one (the caller checks it exists), else null. */
  patientId: string | null;
  /** Complete vectors (missing inputs filled with schema defaults). */
  recorded: FeatureVector;
  features: FeatureVector;
  warnings: string[];
}

export type ParseResult = { ok: true; profile: ImportedProfile } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Coerce one raw value to the schema's type. Returns null when it cannot be read. */
export function coerceValue(spec: FeatureSpec, raw: unknown): { value: FeatureValue; clamped: boolean } | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (spec.type === 'binary') {
    if (typeof raw === 'boolean') return { value: raw ? 1 : 0, clamped: false };
    if (typeof raw === 'number') return raw === 0 || raw === 1 ? { value: raw, clamped: false } : null;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (['1', 'y', 'yes', 'true', 'present'].includes(s)) return { value: 1, clamped: false };
      if (['0', 'n', 'no', 'false', 'absent'].includes(s)) return { value: 0, clamped: false };
    }
    return null;
  }
  if (spec.type === 'categorical') {
    const s = String(raw).trim().toLowerCase();
    const normalised = s === 'fmale' ? 'female' : s;
    const option = spec.options?.find(
      (o) => String(o.value).toLowerCase() === normalised || o.label.toLowerCase() === normalised,
    );
    return option ? { value: option.value, clamped: false } : null;
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace('−', '-').trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const clamped = !inRange(spec, n);
  return { value: clamped ? snapNumeric(spec, n) : n, clamped };
}

/** Map of every accepted spelling (raw key, label; case-insensitive) → spec. */
function keyLookup(index: SchemaIndex): Map<string, FeatureSpec> {
  const m = new Map<string, FeatureSpec>();
  for (const f of index.features) {
    m.set(f.key.toLowerCase(), f);
    m.set(f.label.toLowerCase(), f);
  }
  return m;
}

function readVector(
  raw: Record<string, unknown>,
  lookup: Map<string, FeatureSpec>,
  tally: { unknown: Set<string>; invalid: Set<string>; clamped: Set<string>; leakage: Set<string> },
): FeatureVector {
  const out: FeatureVector = {};
  for (const [k, v] of Object.entries(raw)) {
    if (LEAKAGE_KEYS.has(k) || LEAKAGE_KEYS.has(k.toUpperCase())) {
      tally.leakage.add(k);
      continue;
    }
    const spec = lookup.get(k.trim().toLowerCase());
    if (!spec) {
      tally.unknown.add(k);
      continue;
    }
    const coerced = coerceValue(spec, v);
    if (!coerced) {
      tally.invalid.add(spec.label);
      continue;
    }
    if (coerced.clamped) tally.clamped.add(spec.label);
    out[spec.key] = coerced.value;
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Parse a profile file (or any JSON object of inputs) against the schema. Missing inputs take the
 * schema default (cohort median / mode) and are reported in `warnings`.
 */
export function parseProfile(text: string, index: SchemaIndex, defaults: FeatureVector): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!isRecord(data)) return { ok: false, error: 'Expected a JSON object of inputs.' };

  const lookup = keyLookup(index);
  const tally = { unknown: new Set<string>(), invalid: new Set<string>(), clamped: new Set<string>(), leakage: new Set<string>() };

  let patientId: string | null = null;
  let featuresRaw: Record<string, unknown>;
  let recordedRaw: Record<string, unknown> | null = null;

  if (data.format === PROFILE_FORMAT || isRecord(data.features)) {
    if (!isRecord(data.features)) return { ok: false, error: 'The profile has no "features" object.' };
    featuresRaw = data.features;
    recordedRaw = isRecord(data.recorded) ? data.recorded : null;
    if (isRecord(data.patient) && typeof data.patient.id === 'string') patientId = data.patient.id;
    else if (typeof data.id === 'string') patientId = data.id;
  } else {
    featuresRaw = data;
  }

  const features = readVector(featuresRaw, lookup, tally);
  const recorded = recordedRaw ? readVector(recordedRaw, lookup, tally) : null;
  if (Object.keys(features).length === 0) {
    return { ok: false, error: 'No recognised inputs in the file (keys must be schema keys or labels).' };
  }

  const warnings: string[] = [];
  const missing = index.features.filter((f) => features[f.key] === undefined && defaults[f.key] !== undefined);
  if (missing.length) warnings.push(`${plural(missing.length, 'input')} not in the file use the cohort default.`);
  if (tally.clamped.size) warnings.push(`${plural(tally.clamped.size, 'value')} clamped to the model's range.`);
  if (tally.invalid.size) warnings.push(`${plural(tally.invalid.size, 'value')} could not be read and use the default.`);
  if (tally.unknown.size) warnings.push(`${plural(tally.unknown.size, 'unknown field')} ignored.`);
  if (tally.leakage.size) warnings.push('Target columns were ignored: they are never model inputs.');

  const full = (v: FeatureVector) => ({ ...defaults, ...v });
  const featuresFull = full(features);
  return {
    ok: true,
    profile: {
      patientId,
      recorded: recorded ? full(recorded) : featuresFull,
      features: featuresFull,
      warnings,
    },
  };
}

// ========================================================================================= share link

export const SHARE_PARAM = 'w';
const SHARE_VERSION = '1';
const BLANK_REF = 'new';

/** FNV-1a over the schema's key list, base36: a link from another model version fails loudly. */
export function schemaChecksum(index: SchemaIndex): string {
  let h = 0x811c9dc5;
  const text = index.features.map((f) => f.key).join('\u0001');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 26.8 → "26p8", −3.5 → "n3p5", 70 → "70". */
export function encodeNumber(n: number): string {
  const s = String(Number(n.toPrecision(12)));
  if (/e/i.test(s)) return encodeNumber(Number(n.toFixed(6)));
  return s.replace('-', 'n').replace('.', 'p');
}

export function decodeNumber(s: string): number {
  if (!/^n?\d+(p\d+)?$/.test(s)) return Number.NaN;
  return Number(s.replace('n', '-').replace('p', '.'));
}

function encodeValue(spec: FeatureSpec, value: FeatureValue): string | null {
  if (spec.type === 'binary') return isPresent(value) ? '1' : '0';
  if (spec.type === 'categorical') {
    const i = spec.options?.findIndex((o) => String(o.value).toLowerCase() === String(value).toLowerCase()) ?? -1;
    return i >= 0 ? String(i) : null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? encodeNumber(n) : null;
}

function decodeValue(spec: FeatureSpec, s: string): FeatureValue | null {
  if (spec.type === 'binary') return s === '1' ? 1 : s === '0' ? 0 : null;
  if (spec.type === 'categorical') {
    if (!/^\d+$/.test(s)) return null;
    const option = spec.options?.[Number(s)];
    return option ? option.value : null;
  }
  const n = decodeNumber(s);
  return Number.isFinite(n) && inRange(spec, n) ? n : null;
}

function encodePairs(index: SchemaIndex, vector: FeatureVector, reference: FeatureVector): string {
  const pairs: string[] = [];
  index.features.forEach((spec, i) => {
    const v = vector[spec.key];
    if (v === undefined || sameValue(v, reference[spec.key])) return;
    const encoded = encodeValue(spec, v);
    if (encoded !== null) pairs.push(`${i.toString(36)}-${encoded}`);
  });
  return pairs.join('.');
}

function decodePairs(index: SchemaIndex, text: string): { values: FeatureVector; skipped: number } {
  const values: FeatureVector = {};
  let skipped = 0;
  if (!text) return { values, skipped };
  for (const pair of text.split('.')) {
    const dash = pair.indexOf('-');
    const i = dash > 0 ? Number.parseInt(pair.slice(0, dash), 36) : Number.NaN;
    const spec = Number.isInteger(i) ? index.features[i] : undefined;
    const value = spec ? decodeValue(spec, pair.slice(dash + 1)) : null;
    if (!spec || value === null) {
      skipped += 1;
      continue;
    }
    values[spec.key] = value;
  }
  return { values, skipped };
}

export interface ShareState {
  /** Cohort patient id, or null for a blank / imported patient. */
  patientId: string | null;
  recorded: FeatureVector;
  features: FeatureVector;
}

/**
 * Pack a patient state into the `w` query value. Cohort patients carry only their edits; a blank or
 * imported patient also carries its recorded inputs as differences from the schema defaults.
 */
export function encodeShareState(state: ShareState, index: SchemaIndex, defaults: FeatureVector): string {
  const ref = state.patientId && /^[\w-]+$/.test(state.patientId) ? state.patientId : BLANK_REF;
  const recordedPart = ref === BLANK_REF ? encodePairs(index, state.recorded, defaults) : '';
  const editsPart = encodePairs(index, state.features, state.recorded);
  return [SHARE_VERSION, schemaChecksum(index), ref, recordedPart, editsPart].join('_');
}

export interface DecodedShare {
  /** Cohort id to open, or null for a blank patient built from `recorded`. */
  patientId: string | null;
  /** Blank patient only: recorded inputs as differences from the schema defaults. */
  recorded: FeatureVector;
  /** Edits over the recorded inputs. */
  edits: FeatureVector;
  /** Pairs that could not be read (unknown index or out-of-range value). */
  skipped: number;
}

export type DecodeResult = { ok: true; share: DecodedShare } | { ok: false; error: 'format' | 'model' };

export function decodeShareState(value: string, index: SchemaIndex): DecodeResult {
  const parts = value.split('_');
  if (parts.length !== 5 || parts[0] !== SHARE_VERSION) return { ok: false, error: 'format' };
  const [, checksum, ref, recordedPart, editsPart] = parts as [string, string, string, string, string];
  if (checksum !== schemaChecksum(index)) return { ok: false, error: 'model' };
  if (!ref || !/^[\w-]+$/.test(ref)) return { ok: false, error: 'format' };
  const recorded = decodePairs(index, recordedPart);
  const edits = decodePairs(index, editsPart);
  return {
    ok: true,
    share: {
      patientId: ref === BLANK_REF ? null : ref,
      recorded: recorded.values,
      edits: edits.values,
      skipped: recorded.skipped + edits.skipped,
    },
  };
}

/**
 * The shareable URL for the current page: the hash route becomes `#/workstation[/<id>]?…&w=<state>`,
 * keeping any other query parameters (target, view, panel) the page already carries.
 */
export function shareUrl(currentHref: string, patientId: string | null, payload: string): string {
  const url = new URL(currentHref);
  const hash = url.hash.replace(/^#/, '');
  const [, search = ''] = hash.split('?');
  const params = new URLSearchParams(search);
  params.set(SHARE_PARAM, payload);
  url.hash = `/workstation${patientId ? `/${patientId}` : ''}?${params.toString()}`;
  return url.toString();
}
