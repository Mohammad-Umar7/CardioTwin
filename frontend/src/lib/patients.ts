import type { CohortPatient, FeatureSchema, FeatureValue, FeatureVector } from '@/types/contracts';

const VESSELS = ['LAD', 'LCX', 'RCA'];

export const stenoticVesselCount = (p: CohortPatient): number =>
  VESSELS.reduce((n, t) => n + (p.labels[t] === 1 ? 1 : 0), 0);

/**
 * The patient the app opens on: a held-out TEST patient (never seen in training), preferring an
 * illustrative case — CAD with exactly two stenotic vessels, so the heart shows contrasting vessel
 * colours. Deterministic for a given cohort.
 */
export function pickDefaultPatient(patients: readonly CohortPatient[]): CohortPatient | null {
  const test = patients.filter((p) => p.split === 'test');
  const pool = test.length > 0 ? test : patients;
  return (
    pool.find((p) => p.labels.CAD === 1 && stenoticVesselCount(p) === 2) ??
    pool.find((p) => p.labels.CAD === 1) ??
    pool[0] ??
    null
  );
}

/** Schema defaults (cohort median / mode) for every feature — the Custom patient's starting point. */
export function schemaDefaults(schema: FeatureSchema): FeatureVector {
  const out: FeatureVector = {};
  for (const f of schema.features) {
    if (f.default === null || f.default === undefined) continue;
    out[f.key] = f.default as FeatureValue;
  }
  return out;
}

/** Short summary for the patient chip: "62 y · M" from "62 y · Male · typical angina · DM". */
export function compactSummary(summary: string): string {
  const [age, sex] = summary.split('·').map((s) => s.trim());
  const sexShort = sex === 'Male' ? 'M' : sex === 'Female' ? 'F' : sex;
  return [age, sexShort].filter(Boolean).join(' · ');
}

export const splitLabel = (split: string | null | undefined): string =>
  split === 'test' ? 'TEST' : split === 'dev' ? 'DEV' : 'CUSTOM';
