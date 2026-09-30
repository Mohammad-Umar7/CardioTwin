import type { SchemaIndex } from '@/hooks/useData';
import { editedKeys, usePatientStore } from '@/state/patientStore';

export interface GroupHeaderInfo {
  edited: number;
  imputed: number;
}

/**
 * Per-group header facts (WORKSTATION_V2 §5.6 "All inputs"): the number of edited and imputed inputs.
 * The phase-1 |SHAP| share bar and signed sum are gone from the group headers (V2 §5.20).
 */
export function useGroupInfo(index: SchemaIndex | null): Map<string, GroupHeaderInfo> {
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const imputedList = usePatientStore((s) => s.prediction?.imputed);
  const out = new Map<string, GroupHeaderInfo>();
  if (!index) return out;
  const edited = new Set(editedKeys(features, recorded));
  const imputed = new Set(imputedList ?? []);
  for (const g of index.groups) {
    out.set(g.id, {
      edited: g.features.filter((f) => edited.has(f.key)).length,
      imputed: g.features.filter((f) => imputed.has(f.key)).length,
    });
  }
  return out;
}
