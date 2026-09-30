/**
 * Front-end display-label overrides for schema features (applied when the schema loads, so every surface —
 * cards, drawer, Explain, palette, report — reads the same words). Used where the dataset's own label is
 * clinically wrong or unclear and the published schema cannot change this round.
 *
 *   Obesity  the dataset flags BMI > 25, which is OVERWEIGHT (obesity starts at BMI 30), so the label says
 *            "Overweight or obese (BMI > 25)" instead of "Obesity (BMI > 25)".
 */
import type { FeatureSchema } from '@/types/contracts';

export const DISPLAY_LABELS: Readonly<Record<string, string>> = {
  Obesity: 'Overweight or obese (BMI > 25)',
};

/** The schema with the overrides applied (a new object; the input is not mutated). */
export function withDisplayLabels(schema: FeatureSchema): FeatureSchema {
  if (!schema?.features) return schema;
  return {
    ...schema,
    features: schema.features.map((f) => (DISPLAY_LABELS[f.key] ? { ...f, label: DISPLAY_LABELS[f.key]! } : f)),
  };
}
