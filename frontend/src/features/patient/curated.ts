/**
 * Curated cases for the patient switcher (WORKSTATION_V2 §5.2): six held-out TEST patients chosen for
 * FEATURE diversity — both sexes, ages 41–66, every chest-pain type, and profiles driven by symptoms,
 * risk factors, the ECG or the echo. The copy describes inputs only. It never mentions the
 * catheterisation result, and never hints at it ("missed", "surprising", "positive"): the Reveal stays a
 * real reveal.
 */
export interface CuratedCase {
  id: string;
  /** Why this case is worth opening, in terms of its inputs. */
  note: string;
}

export const CURATED_CASES: readonly CuratedCase[] = [
  { id: 'P-011', note: 'Classic exertional angina with hypertension' },
  { id: 'P-035', note: 'No chest pain, but a severely reduced ejection fraction and Q waves' },
  { id: 'P-063', note: 'Young, with diabetes, hypertension and a family history' },
  { id: 'P-015', note: 'Atypical symptoms, diabetes and ST depression' },
  { id: 'P-296', note: 'Non-anginal pain with a left bundle branch block' },
  { id: 'P-009', note: 'Non-anginal pain and no major risk factors' },
];

export const CURATED_IDS: ReadonlySet<string> = new Set(CURATED_CASES.map((c) => c.id));
