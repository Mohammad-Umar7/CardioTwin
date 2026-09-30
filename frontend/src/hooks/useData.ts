/**
 * Data hooks over the memoised static/API loaders (services/staticData.ts). Every hook is safe to
 * call from many components: the underlying request runs once per session.
 */
import { useMemo } from 'react';
import {
  anatomyGlbResource,
  cohortResource,
  manifestResource,
  metricsResource,
  portableModelResource,
  schemaResource,
  vesselsResource,
} from '@/services/staticData';
import { TARGET_ORDER, type FeatureSchema, type FeatureSpec, type TargetSpec } from '@/types/contracts';
import { useResource } from './useResource';

export const useSchema = () => useResource(schemaResource);
export const useCohort = () => useResource(cohortResource);
export const useMetrics = () => useResource(metricsResource);
export const useManifest = () => useResource(manifestResource);
export const useVessels = () => useResource(vesselsResource);
export const usePortableModel = () => useResource(portableModelResource);
export const useAnatomyGlbUrl = () => useResource(anatomyGlbResource);

/** Targets in contract order (CAD · LAD · LCX · RCA), then any targets added later. */
export function orderTargets(targets: readonly TargetSpec[]): TargetSpec[] {
  const rank = (id: string) => {
    const i = (TARGET_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? TARGET_ORDER.length : i;
  };
  return [...targets].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Vessel targets = every target except the patient-level one(s). */
export function vesselTargets(targets: readonly TargetSpec[]): TargetSpec[] {
  return orderTargets(targets).filter((t) => (t.kind ? t.kind === 'vessel' : t.id !== 'CAD'));
}

export interface SchemaIndex {
  schema: FeatureSchema;
  features: FeatureSpec[];
  byKey: Map<string, FeatureSpec>;
  targets: TargetSpec[];
  vessels: TargetSpec[];
  targetById: Map<string, TargetSpec>;
  /** Groups in schema order, each with its features. */
  groups: { id: string; label: string; icon?: string | null; features: FeatureSpec[] }[];
}

export function indexSchema(schema: FeatureSchema): SchemaIndex {
  const byKey = new Map(schema.features.map((f) => [f.key, f]));
  const targets = orderTargets(schema.targets);
  const groups = [...schema.groups]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((g) => ({ id: g.id, label: g.label, icon: g.icon, features: schema.features.filter((f) => f.group === g.id) }))
    .filter((g) => g.features.length > 0);
  // Features whose group is not declared still get a home.
  const known = new Set(groups.map((g) => g.id));
  const orphans = schema.features.filter((f) => !known.has(f.group));
  if (orphans.length > 0) groups.push({ id: 'other', label: 'Other', icon: null, features: orphans });
  return {
    schema,
    features: schema.features,
    byKey,
    targets,
    vessels: vesselTargets(schema.targets),
    targetById: new Map(targets.map((t) => [t.id, t])),
    groups,
  };
}

/** Schema plus lookup tables, memoised per schema object. */
export function useSchemaIndex(): SchemaIndex | null {
  const { data } = useSchema();
  return useMemo(() => (data ? indexSchema(data) : null), [data]);
}
