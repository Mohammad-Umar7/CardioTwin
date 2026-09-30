/**
 * Pure helpers over SHAP explanations (CONTRACTS §3.2: log-odds space, base + Σ shap = output).
 * Shared by the form's group headers, the waterfall, the physiology table and the narrative sentence.
 */
import type { Contribution, Explanation, FeatureSpec } from '@/types/contracts';
import { optionDisplay, rangeStatus } from './format';

export const NEGLIGIBLE_SHAP = 0.02;

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
export const logit = (p: number): number => Math.log(p / (1 - p));

/** Platt calibration used by the model: p = 1 / (1 + exp(-(a·m + b))). */
export const platt = (margin: number, a: number, b: number): number => sigmoid(a * margin + b);
/** Inverse Platt: the margin that maps to probability p. */
export const inversePlatt = (p: number, a: number, b: number): number => (logit(p) - b) / a;

/** Contributions sorted by |shap| descending (the contract already sorts; this is defensive). */
export function sortedContributions(e: Explanation | undefined | null): Contribution[] {
  return [...(e?.contributions ?? [])].sort((x, y) => Math.abs(y.shap) - Math.abs(x.shap));
}

export interface GroupAttribution {
  group: string;
  /** Signed sum of SHAP in the group (log-odds). */
  sum: number;
  /** Σ|SHAP| in the group. */
  abs: number;
  /** Share of total |SHAP| (0–1). */
  share: number;
}

/** Signed and absolute SHAP per feature group, keyed by group id. */
export function groupAttribution(
  e: Explanation | undefined | null,
  groupOf: (feature: string) => string | undefined,
): Map<string, GroupAttribution> {
  const out = new Map<string, GroupAttribution>();
  let total = 0;
  for (const c of e?.contributions ?? []) {
    const g = groupOf(c.feature) ?? 'other';
    const row = out.get(g) ?? { group: g, sum: 0, abs: 0, share: 0 };
    row.sum += c.shap;
    row.abs += Math.abs(c.shap);
    total += Math.abs(c.shap);
    out.set(g, row);
  }
  for (const row of out.values()) row.share = total > 0 ? row.abs / total : 0;
  return out;
}

/** Number of filled segments (0–4) of the 4-segment |SHAP|-share mini bar. */
export const shareSegments = (share: number): 0 | 1 | 2 | 3 | 4 =>
  share < 0.02 ? 0 : (Math.min(4, Math.max(1, Math.round(share * 4))) as 1 | 2 | 3 | 4);


// ------------------------------------------------------------------------------ narrative
//
// Narrative grammar (WORKSTATION_V2 §5.10), template-built from the exact SHAP values — no LLM:
//
//   net up    "Driven mostly by {up₁} and {up₂}; {down₁} pulls it down."
//   net down  "Held down mostly by {down₁} and {down₂}; {up₁} pushes it up."
//
// Phrase rules: binary present → the finding ("typical angina"); binary absent → "no {finding}" (or "the
// absence of {finding}" after "by"); numeric with a reference range → "a normal / high / low {measure}";
// a count at 0 → its absence ("normal wall motion"); numeric without a range → relative to the cohort
// median ("older age"). The narrative carries NO numbers: values live in the cards and the drawer.

export interface NarrativePart {
  kind: 'text' | 'phrase';
  text: string;
  /** Feature key for phrase parts (hover links the input row and the SHAP row; click opens the input). */
  feature?: string;
}

/** Grammatical position of a phrase: subject ("… pulls it down") or object ("driven mostly by …"). */
export type PhraseRole = 'subject' | 'object';

export interface Phrase {
  text: string;
  /** Takes a plural verb ("Q waves pull it down"). */
  plural: boolean;
}

interface Lexeme {
  /** Noun phrase of the finding / measure, lower-case unless an acronym ("ST depression"). */
  noun?: string;
  /** Mass noun: no article before "normal / high / low" ("high blood pressure", not "a high …"). */
  mass?: boolean;
  plural?: boolean;
  /** Binary present, verbatim. */
  present?: string;
  /** Binary absent, verbatim (both roles). */
  absent?: string;
  absentPlural?: boolean;
  /** Numeric with a range, verbatim per status. */
  normal?: string;
  high?: string;
  low?: string;
  /** Count feature (normal range 0–0): phrase at 0 and above 0. */
  zero?: string;
  some?: string;
  /** Numeric without a range, relative to the cohort median. */
  higher?: string;
  lower?: string;
  same?: string;
}

/** Plain-language lexicon over the raw dataset keys (CONTRACTS §0). Unknown keys fall back to the label. */
const LEXICON: Readonly<Record<string, Lexeme>> = {
  // demographics
  Age: { higher: 'older age', lower: 'younger age', same: 'age' },
  Weight: { higher: 'a higher body weight', lower: 'a lower body weight', same: 'body weight' },
  Length: { higher: 'greater height', lower: 'shorter height', same: 'height' },
  BMI: { noun: 'body-mass index' },
  // risk factors & history
  DM: { noun: 'diabetes' },
  HTN: { noun: 'hypertension' },
  DLP: { noun: 'dyslipidaemia' },
  'Current Smoker': { present: 'current smoking', absent: 'not smoking' },
  'EX-Smoker': { present: 'past smoking', absent: 'no past smoking' },
  FH: { present: 'a family history of heart disease', absent: 'no family history of heart disease' },
  Obesity: { noun: 'obesity' },
  CRF: { noun: 'chronic renal failure' },
  CVA: { present: 'a previous stroke', absent: 'no previous stroke' },
  'Airway disease': { noun: 'airway disease' },
  'Thyroid Disease': { noun: 'thyroid disease' },
  // symptoms
  'Typical Chest Pain': { noun: 'typical angina' },
  Atypical: { noun: 'atypical angina' },
  Nonanginal: { noun: 'non-anginal chest pain' },
  'LowTH Ang': { noun: 'low-threshold angina' },
  Dyspnea: { noun: 'shortness of breath' },
  'Function Class': { normal: 'no exertional limitation', high: 'exertional limitation', low: 'no exertional limitation' },
  // examination
  BP: { noun: 'blood pressure', mass: true },
  PR: { normal: 'a normal pulse rate', high: 'a fast pulse', low: 'a slow pulse' },
  Edema: { noun: 'leg swelling' },
  'Weak Peripheral Pulse': { present: 'a weak peripheral pulse', absent: 'normal peripheral pulses', absentPlural: true },
  'Lung rales': { noun: 'lung crackles', plural: true },
  'Systolic Murmur': { present: 'a systolic murmur', absent: 'no systolic murmur' },
  'Diastolic Murmur': { present: 'a diastolic murmur', absent: 'no diastolic murmur' },
  // ECG
  'Q Wave': { noun: 'Q waves', plural: true },
  'St Elevation': { noun: 'ST elevation' },
  'St Depression': { noun: 'ST depression' },
  Tinversion: { noun: 'T-wave inversion' },
  LVH: { noun: 'left ventricular hypertrophy' },
  'Poor R Progression': { noun: 'poor R-wave progression' },
  BBB: { noun: 'bundle branch block' },
  // laboratory
  FBS: { noun: 'fasting blood sugar', mass: true },
  CR: { noun: 'creatinine', mass: true },
  TG: { noun: 'triglycerides', mass: true, plural: true },
  LDL: { noun: 'LDL cholesterol', mass: true },
  HDL: { noun: 'HDL cholesterol', mass: true },
  BUN: { noun: 'blood urea', mass: true },
  ESR: { normal: 'a normal ESR', high: 'a raised ESR', low: 'a low ESR' },
  HB: { noun: 'haemoglobin', mass: true },
  K: { noun: 'potassium', mass: true },
  Na: { noun: 'sodium', mass: true },
  WBC: { noun: 'white cell count' },
  Lymph: { noun: 'lymphocyte fraction' },
  Neut: { noun: 'neutrophil fraction' },
  PLT: { noun: 'platelet count' },
  // echocardiography
  'EF-TTE': { normal: 'a normal ejection fraction', high: 'a high ejection fraction', low: 'a reduced ejection fraction' },
  'Region RWMA': { zero: 'normal wall motion', some: 'a regional wall-motion abnormality' },
  VHD: { noun: 'valvular heart disease' },
};

/** "Obesity (BMI > 25)" → "obesity"; keeps acronyms ("ST depression", "LDL cholesterol"). */
function nounFromLabel(label: string): string {
  const bare = label.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const first = bare.split(/\s+/)[0] ?? '';
  const acronym = first.length > 1 && first === first.toUpperCase();
  return acronym ? bare : bare.charAt(0).toLowerCase() + bare.slice(1);
}

const isPresent = (value: unknown) =>
  value === 1 || value === true || value === '1' || (typeof value === 'string' && /^(y|yes|true)$/i.test(value));

const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

const phrase = (text: string, plural = false): Phrase => ({ text, plural });

const absence = (noun: string, role: PhraseRole) => phrase(role === 'object' ? `the absence of ${noun}` : `no ${noun}`);

/**
 * The words for one contribution, e.g. "typical angina", "no diabetes", "a reduced ejection fraction",
 * "high blood pressure", "normal wall motion", "older age", "male sex", "left bundle branch block".
 */
export function narrativePhrase(
  c: Pick<Contribution, 'feature' | 'value'>,
  spec: FeatureSpec | undefined,
  role: PhraseRole = 'subject',
): Phrase {
  const lex = LEXICON[c.feature] ?? {};
  if (spec?.phrase && spec.type !== 'numeric') {
    // Schema-supplied phrase (DESIGN_SYSTEM §7.8): the finding's name.
    if (spec.type !== 'binary' || isPresent(c.value)) return phrase(spec.phrase);
    return absence(spec.phrase, role);
  }
  const noun = lex.noun ?? (spec ? nounFromLabel(spec.label) : c.feature);
  const type = spec?.type ?? (typeof c.value === 'string' && toNumber(c.value) === null ? 'categorical' : 'numeric');

  if (type === 'binary') {
    if (isPresent(c.value)) return phrase(lex.present ?? noun, lex.plural);
    if (lex.absent) return phrase(lex.absent, lex.absentPlural);
    return absence(noun, role);
  }

  if (type === 'categorical') {
    const { short, full } = spec ? optionDisplay(spec, c.value as never) : { short: String(c.value), full: String(c.value) };
    if (short === 'None' || short === '–') return absence(noun, role);
    const fullLower = nounFromLabel(full);
    const head = noun.split(' ').slice(-1)[0] ?? noun;
    // "Left bundle branch block" already names the finding; "Mild" + "valvular heart disease" does not.
    if (fullLower.toLowerCase().includes(head.toLowerCase())) return phrase(fullLower);
    return phrase(`${short.toLowerCase()} ${noun}`);
  }

  // numeric
  const value = toNumber(c.value);
  if (lex.zero !== undefined && value !== null) return phrase(value === 0 ? lex.zero : (lex.some ?? noun));
  const status = value !== null ? rangeStatus(value, spec?.normal) : null;
  if (status) {
    const verbatim = status === 'within' ? lex.normal : status === 'above' ? lex.high : lex.low;
    if (verbatim) return phrase(verbatim);
    const adjective = status === 'within' ? 'normal' : status === 'above' ? 'high' : 'low';
    return phrase(`${lex.mass ? '' : 'a '}${adjective} ${noun}`, lex.plural);
  }
  const median = toNumber(spec?.default);
  if (value !== null && median !== null) {
    if (value > median) return phrase(lex.higher ?? `a higher ${noun}`);
    if (value < median) return phrase(lex.lower ?? `a lower ${noun}`);
  }
  return phrase(lex.same ?? noun, lex.plural);
}

/** Back-compatible alias: the subject-position phrase text. */
export function phraseFor(c: Contribution, spec: FeatureSpec | undefined): string {
  return narrativePhrase(c, spec).text;
}

const joinAnd = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

type SpecOf = (feature: string) => FeatureSpec | undefined;

/** Phrase parts for a list, joined with commas and "and", each phrase linked to its feature. */
function phraseParts(list: Contribution[], specOf: SpecOf, role: PhraseRole): { parts: NarrativePart[]; plural: boolean } {
  const phrases = list.map((c) => narrativePhrase(c, specOf(c.feature), role));
  const words = phrases.map((p) => p.text);
  const joined = joinAnd(words);
  const parts: NarrativePart[] = [];
  let cursor = 0;
  list.forEach((c, i) => {
    const w = words[i]!;
    const at = joined.indexOf(w, cursor);
    if (at > cursor) parts.push({ kind: 'text', text: joined.slice(cursor, at) });
    parts.push({ kind: 'phrase', text: w, feature: c.feature });
    cursor = at + w.length;
  });
  if (cursor < joined.length) parts.push({ kind: 'text', text: joined.slice(cursor) });
  return { parts, plural: list.length > 1 || (phrases[0]?.plural ?? false) };
}

const capitalise = (parts: NarrativePart[]): NarrativePart[] => {
  const [first, ...rest] = parts;
  if (!first) return parts;
  const text = /^[A-Z]{2}/.test(first.text) ? first.text : first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return [{ ...first, text }, ...rest];
};

/** The drivers the narrative names: the side that moved the estimate leads, the other side counters. */
export function narrativeDrivers(
  explanation: Explanation | undefined | null,
  { leads = 2, counters = 1 }: { leads?: number; counters?: number } = {},
): { direction: 'up' | 'down'; leads: Contribution[]; counters: Contribution[] } {
  const sorted = sortedContributions(explanation).filter((c) => Math.abs(c.shap) >= NEGLIGIBLE_SHAP);
  const net = explanation ? explanation.output_value - explanation.base_value : 0;
  const direction = net >= 0 ? 'up' : 'down';
  const ups = sorted.filter((c) => c.shap > 0);
  const downs = sorted.filter((c) => c.shap < 0);
  return direction === 'up'
    ? { direction, leads: ups.slice(0, leads), counters: downs.slice(0, counters) }
    : { direction, leads: downs.slice(0, leads), counters: ups.slice(0, counters) };
}

/**
 * The "why" sentence for any target (Risk card, inspector):
 *   "Driven mostly by typical angina and hypertension; normal wall motion pulls it down."
 * No numbers and no target name: the card around it already says which estimate it explains.
 */
export function buildNarrative(explanation: Explanation | undefined | null, specOf: SpecOf): NarrativePart[] {
  const { direction, leads, counters } = narrativeDrivers(explanation);
  if (leads.length === 0 && counters.length === 0) {
    return [{ kind: 'text', text: 'No single input moves it much from the typical patient.' }];
  }
  const out: NarrativePart[] = [];
  if (leads.length > 0) {
    out.push({ kind: 'text', text: direction === 'up' ? 'Driven mostly by ' : 'Held down mostly by ' });
    out.push(...phraseParts(leads, specOf, 'object').parts);
  }
  if (counters.length > 0) {
    const { parts, plural } = phraseParts(counters, specOf, 'subject');
    if (leads.length > 0) out.push({ kind: 'text', text: '; ' });
    out.push(...(leads.length > 0 ? parts : capitalise(parts)));
    const verb = direction === 'up' ? (plural ? ' pull it down' : ' pulls it down') : plural ? ' push it up' : ' pushes it up';
    out.push({ kind: 'text', text: verb });
  }
  out.push({ kind: 'text', text: '.' });
  return out;
}

export const narrativeText = (parts: NarrativePart[]): string => parts.map((p) => p.text).join('');

/**
 * The Explain drawer's takeaway title (§5.10): "{T} {p} % is driven mostly by typical angina" / "… is held
 * down mostly by a reduced ejection fraction". Returns the verb and the linked phrase; the caller renders the
 * probability numeral itself (it is P(target)'s fallback home while the drawer covers the Risk card).
 */
export function explainTakeaway(
  explanation: Explanation | undefined | null,
  specOf: SpecOf,
): { verb: string; phrase: NarrativePart } | null {
  const { direction, leads } = narrativeDrivers(explanation, { leads: 1, counters: 0 });
  const lead = leads[0];
  if (!lead) return null;
  return {
    verb: direction === 'up' ? 'is driven mostly by' : 'is held down mostly by',
    phrase: { kind: 'phrase', text: narrativePhrase(lead, specOf(lead.feature), 'object').text, feature: lead.feature },
  };
}
