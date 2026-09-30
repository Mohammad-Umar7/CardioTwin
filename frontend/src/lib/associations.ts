import type { NarrativePart } from './explain';

/**
 * Inputs that can move an estimate in this cohort without an established causal role in coronary artery
 * disease: routine blood indices (ESR, electrolytes, blood counts, urea), height, airway and thyroid disease.
 * Their SHAP contributions are real associations in 303 patients from one centre, but a cardiologist should
 * never read "a normal ESR pulls LAD down" as physiology. Every surface that ranks drivers marks them with
 * ASSOCIATION_MARK and says why (WhyTab, patient card, narrative sentences).
 */
export const ASSOCIATION_ONLY: ReadonlySet<string> = new Set([
  'ESR',
  'K',
  'Na',
  'WBC',
  'Lymph',
  'Neut',
  'PLT',
  'HB',
  'BUN',
  'Length',
  'Airway disease',
  'Thyroid Disease',
]);

export const isAssociationOnly = (feature: string | null | undefined): boolean =>
  !!feature && ASSOCIATION_ONLY.has(feature);

/** The marker set after the input's name. */
export const ASSOCIATION_MARK = '†';

/** Tooltip on a marked input. */
export const ASSOCIATION_NOTE =
  'Association in this cohort only: this input has no established causal role in coronary artery disease.';

/** One-line legend under a list or sentence that contains a marked input. */
export const ASSOCIATION_LEGEND = '† Association only, not a known cause';

/** A narrative sentence names a marked input (ESR, sodium …), so it needs the legend under it. */
export const namesAssociation = (parts: readonly NarrativePart[] | null): boolean =>
  !!parts?.some((p) => p.kind === 'phrase' && isAssociationOnly(p.feature));
