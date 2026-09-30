import type { SchemaIndex } from '@/hooks/useData';
import { groupAttribution } from '@/lib/explain';
import { editedKeys, usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

export interface GroupHeaderInfo {
  edited: number;
  imputed: number;
  share: number;
  sum: number | null;
}

/** Per-group header facts: edits, imputed inputs and the group's SHAP share / signed sum for `target`. */
export function useGroupInfo(index: SchemaIndex | null): Map<string, GroupHeaderInfo> {
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const prediction = usePatientStore((s) => s.prediction);
  const target = useViewerStore((s) => s.selectedStructure) ?? 'CAD';
  const out = new Map<string, GroupHeaderInfo>();
  if (!index) return out;
  const edited = new Set(editedKeys(features, recorded));
  const imputed = new Set(prediction?.imputed ?? []);
  const attribution = groupAttribution(prediction?.explanations[target], (f) => index.byKey.get(f)?.group);
  for (const g of index.groups) {
    const a = attribution.get(g.id);
    out.set(g.id, {
      edited: g.features.filter((f) => edited.has(f.key)).length,
      imputed: g.features.filter((f) => imputed.has(f.key)).length,
      share: a?.share ?? 0,
      sum: a ? a.sum : null,
    });
  }
  return out;
}
