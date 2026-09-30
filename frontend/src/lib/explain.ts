/**
 * Pure helpers over SHAP explanations (CONTRACTS §3.2: log-odds space, base + Σ shap = output).
 * Shared by the form's group headers, the waterfall, the physiology table and the narrative sentence.
 */
import type { Contribution, Explanation, FeatureSpec, TargetId } from '@/types/contracts';
import { formatFeatureValue, formatProbability, optionDisplay } from './format';
import { RISK_BAND_STYLES, type RiskBandId } from '@/theme/risk';

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

export interface NarrativePart {
  kind: 'text' | 'phrase';
  text: string;
  /** Feature key for phrase parts (hover links the input row and the SHAP row). */
  feature?: string;
}

const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1]?.toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Short phrase for a contribution: schema `phrase` when present, else "<label> <value>". */
export function phraseFor(c: Contribution, spec: FeatureSpec | undefined): string {
  if (spec?.phrase) return spec.phrase;
  if (!spec) return c.feature;
  const label = lowerFirst(spec.label);
  if (spec.type === 'binary') {
    const on = c.value === 1 || c.value === true || c.value === '1';
    return on ? label : `no ${label}`;
  }
  if (spec.type === 'categorical') {
    const { short } = optionDisplay(spec, c.value as never);
    if (short === 'None') return `no ${label}`;
    if (/^[A-Z0-9]{2,}$/.test(short)) return short;
    return `${short.toLowerCase()} ${label}`;
  }
  return `${label} ${formatFeatureValue(spec, c.value as never)}`.trim();
}

const joinAnd = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * Template-built "why" sentence (DESIGN_SYSTEM §5 NarrativeSentence, no LLM):
 *   "{T} {p} %, {band}. {up₁} and {up₂} push it up; {down₁} pulls it down."
 */
export function buildNarrative(
  target: TargetId,
  probability: number,
  band: RiskBandId,
  explanation: Explanation | undefined | null,
  specOf: (feature: string) => FeatureSpec | undefined,
): NarrativePart[] {
  const parts: NarrativePart[] = [];
  const f = formatProbability(probability);
  parts.push({ kind: 'text', text: `${target} ${f.text}, ${RISK_BAND_STYLES[band].label.toLowerCase()}. ` });
  const sorted = sortedContributions(explanation).filter((c) => Math.abs(c.shap) >= NEGLIGIBLE_SHAP);
  const ups = sorted.filter((c) => c.shap > 0).slice(0, 2);
  const downs = sorted.filter((c) => c.shap < 0).slice(0, 1);
  if (ups.length === 0 && downs.length === 0) {
    parts.push({ kind: 'text', text: 'No single input moves it much from the typical patient.' });
    return parts;
  }
  const phraseParts = (list: Contribution[]): NarrativePart[] => {
    const out: NarrativePart[] = [];
    const words = list.map((c) => phraseFor(c, specOf(c.feature)));
    const joined = joinAnd(words);
    // rebuild with phrase spans in order
    let cursor = 0;
    list.forEach((c, i) => {
      const w = words[i]!;
      const at = joined.indexOf(w, cursor);
      if (at > cursor) out.push({ kind: 'text', text: joined.slice(cursor, at) });
      out.push({ kind: 'phrase', text: w, feature: c.feature });
      cursor = at + w.length;
    });
    if (cursor < joined.length) out.push({ kind: 'text', text: joined.slice(cursor) });
    return out;
  };
  const capitalise = (p: NarrativePart[]) => {
    const first = p[0];
    if (first) p[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) };
    return p;
  };
  if (ups.length > 0) {
    parts.push(...capitalise(phraseParts(ups)));
    parts.push({ kind: 'text', text: ups.length > 1 ? ' push it up' : ' pushes it up' });
    parts.push({ kind: 'text', text: downs.length > 0 ? '; ' : '.' });
  }
  if (downs.length > 0) {
    const d = phraseParts(downs);
    parts.push(...(ups.length > 0 ? d : capitalise(d)));
    parts.push({ kind: 'text', text: ' pulls it down.' });
  }
  return parts;
}

export const narrativeText = (parts: NarrativePart[]): string => parts.map((p) => p.text).join('');
