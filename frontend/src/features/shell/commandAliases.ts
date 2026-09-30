/**
 * Search aliases for the palette (WORKSTATION_V2 §4.9): raw dataset keys and abbreviations ("EF",
 * "EF-TTE", "RWMA") find an input, but the row always shows the human label.
 */
import type { CohortPatient, FeatureSpec } from '@/types/contracts';

/** Initialism of a multi-word label: "Ejection fraction" → "EF", "Regional wall-motion abnormality" → "RWMA". */
export function initialism(label: string): string | null {
  const words = label
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s\-/]+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length > 0 && !/^(of|and|the|a|an|to|with)$/i.test(w));
  if (words.length < 2) return null;
  return words.map((w) => w[0]!.toUpperCase()).join('');
}

/**
 * Aliases of an input: the raw key ("EF-TTE"), the key with separators as spaces ("EF TTE"), the label's
 * initialism ("EF"), the key's own leading token when it is an abbreviation ("EF"), and the narrative
 * phrase ("typical chest pain"). De-duplicated case-insensitively, and never the label itself.
 */
export function inputAliases(spec: Pick<FeatureSpec, 'key' | 'label' | 'phrase'>): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const v = value?.trim();
    if (!v || v.toLowerCase() === spec.label.toLowerCase()) return;
    if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  push(spec.key);
  push(spec.key.replace(/[-_]+/g, ' '));
  push(initialism(spec.label));
  const lead = /^([A-Z]{2,})\b/.exec(spec.key)?.[1];
  push(lead);
  push(spec.phrase);
  return out;
}

/** Search keywords of a cohort patient: id, split, and the feature-based summary (never cath labels). */
export function patientKeywords(patient: Pick<CohortPatient, 'id' | 'split' | 'summary'>): string[] {
  const split = patient.split === 'test' ? ['test', 'held-out'] : patient.split === 'dev' ? ['dev', 'development'] : [];
  return [patient.id, patient.id.replace(/^P-0*/, ''), ...split, patient.summary];
}
