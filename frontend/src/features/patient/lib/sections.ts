/**
 * Inputs drawer sections (WORKSTATION_V2 §5.6). Every input appears at most once above "All inputs":
 *   1. Changed · n                     — differs from the recorded value;
 *   2. Outside normal range · n        — numerics outside `schema.normal`, present findings, non-normal
 *                                        categorical findings (BBB, VHD);
 *   3. Most influential for {t} · n    — the top 8 by |SHAP| not already listed;
 *   4. All inputs · 53                 — the schema groups (rendered as accordions by the drawer).
 * Search flattens everything into one ranked list over label, aliases and raw key.
 */
import type { SchemaIndex } from '@/hooks/useData';
import { fuzzyScore } from '@/features/shell/commandSearch';
import type { Explanation, FeatureSpec, FeatureVector } from '@/types/contracts';
import { aliasesFor } from './aliases';
import { orderContributions } from './keyInputs';
import { abnormality, changedKeys } from './values';

export const KEY_SECTION_SIZE = 8;

export interface DrawerSections {
  changed: string[];
  abnormal: string[];
  key: string[];
}

export interface SectionInput {
  index: SchemaIndex;
  features: FeatureVector;
  recorded: FeatureVector;
  explanation?: Explanation | null;
  keySize?: number;
}

/** Keys of each section, in schema order (Changed, Outside normal) or |SHAP| order (Most influential). */
export function computeSections({ index, features, recorded, explanation, keySize = KEY_SECTION_SIZE }: SectionInput): DrawerSections {
  const schemaOrder = index.features.map((f) => f.key);
  const changedSet = new Set(changedKeys(features, recorded).filter((k) => index.byKey.has(k)));
  const changed = schemaOrder.filter((k) => changedSet.has(k));
  const listed = new Set(changed);

  const abnormal = index.features
    .filter((f) => !listed.has(f.key) && abnormality(f, features[f.key]) !== null)
    .map((f) => f.key);
  for (const k of abnormal) listed.add(k);

  const key: string[] = [];
  if (explanation) {
    for (const c of orderContributions(explanation, index)) {
      if (key.length >= keySize) break;
      if (!index.byKey.has(c.feature) || listed.has(c.feature) || c.shap === 0) continue;
      key.push(c.feature);
    }
  }
  return { changed, abnormal, key };
}

/** Number of inputs that are outside normal (for "+ n abnormal findings", excluding the shown ones). */
export function abnormalKeys(index: SchemaIndex, features: FeatureVector): string[] {
  return index.features.filter((f) => abnormality(f, features[f.key]) !== null).map((f) => f.key);
}

export interface SearchHit {
  spec: FeatureSpec;
  groupLabel: string;
  score: number;
}

/**
 * Ranked search over the inputs: label first, then aliases and the raw key (at 90 %), then the group name
 * (at 50 %). Stable: ties keep schema order. An empty query returns [].
 */
export function searchInputs(index: SchemaIndex, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const groupLabel = new Map(index.groups.flatMap((g) => g.features.map((f) => [f.key, g.label] as const)));
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => new RegExp(`(^|[\\s\\-_/·(.,:])${escape(t)}`));
  /** Every query word starts a word of the text ("ef" matches "EF-TTE", not "left"). */
  const contains = (text: string) => {
    const t = text.toLowerCase();
    return tokens.every((token) => token.test(t));
  };
  const hits: (SearchHit & { i: number; exact: boolean })[] = [];
  index.features.forEach((spec, i) => {
    const group = groupLabel.get(spec.key) ?? '';
    const terms: [string, number][] = [[spec.label, 1], ...aliasesFor(spec.key).map((a): [string, number] => [a, 0.9]), [group, 0.5]];
    let score: number | null = null;
    let exact = false;
    for (const [text, weight] of terms) {
      const s = fuzzyScore(q, text);
      if (s === null) continue;
      score = Math.max(score ?? 0, s * weight);
      exact ||= contains(text);
    }
    if (score !== null) hits.push({ spec, groupLabel: group, score, i, exact });
  });
  // Loose matches ("ef" inside "left ventricular…") only fill in when nothing matches at a word start.
  const anyExact = hits.some((h) => h.exact);
  return hits
    .filter((h) => !anyExact || h.exact)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ spec, groupLabel: g, score }) => ({ spec, groupLabel: g, score }));
}
