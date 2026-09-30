import { useEffect, useRef, useState } from 'react';
import type { Contribution, FeatureVector } from '@/types/contracts';

/** Grid shared by contribution rows and their headers: tip · label · value · bar · number. */
export const ROW_GRID = 'grid-cols-[10px_minmax(0,1fr)_auto_104px_40px]';

/** Features whose value changed since the last estimate (for the 1.2 s accent rule, V2 §8.3 step 5). */
export function useChangedFeatures(contributions: readonly Contribution[] | undefined): ReadonlySet<string> {
  const previous = useRef<Map<string, unknown> | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!contributions) return;
    const now = new Map(contributions.map((c) => [c.feature, c.value]));
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const diff = new Set([...now].filter(([k, v]) => before.has(k) && before.get(k) !== v).map(([k]) => k));
    if (diff.size === 0) return;
    setChanged(diff);
    const t = window.setTimeout(() => setChanged(new Set()), 1200);
    return () => window.clearTimeout(t);
  }, [contributions]);
  return changed;
}


/** FNV-1a 32-bit over the sorted inputs: a short id that changes whenever any input changes. */
export function predictionId(features: FeatureVector): string {
  const text = JSON.stringify(Object.keys(features).sort().map((k) => [k, features[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
