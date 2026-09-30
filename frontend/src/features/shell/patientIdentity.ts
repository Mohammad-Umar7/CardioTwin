import type { CohortPatient } from '@/types/contracts';

/** "Male · 58 y" from a cohort summary ("58 y · Male · …"); null when it names neither (WORKSTATION_V2 §5.2). */
export function sexAgeLine(patient: Pick<CohortPatient, 'summary'> | undefined): string | null {
  if (!patient) return null;
  const sex = /\b(male|female)\b/i.exec(patient.summary)?.[1];
  const age = /\b(\d{1,3})\s*(?:y\b|yo\b|years?\b|-year)/i.exec(patient.summary)?.[1];
  const parts = [sex ? sex[0]!.toUpperCase() + sex.slice(1).toLowerCase() : null, age ? `${age} y` : null];
  return parts.some(Boolean) ? parts.filter(Boolean).join(' · ') : null;
}

/** Tooltip copy for the patient's split. */
export const SPLIT_COPY: Record<string, string> = {
  test: 'Held-out test patient: never seen in training',
  dev: 'Development patient: used to train the model',
};
