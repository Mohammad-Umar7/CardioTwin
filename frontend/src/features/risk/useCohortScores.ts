import { useEffect, useState } from 'react';
import { useCohort } from '@/hooks/useData';
import { getSharedInferenceClient } from '@/inference';
import type { CohortResponse, TargetId } from '@/types/contracts';

export interface CohortScores {
  /** Per target, the cohort's recorded-input probabilities, ascending. */
  byTarget: Partial<Record<TargetId, number[]>>;
  n: number;
  nTest: number;
  nDev: number;
}

let pending: Promise<CohortScores> | null = null;
let resolved: CohortScores | null = null;

/**
 * Probabilities of every demo-cohort patient (recorded inputs), scored ONCE per session by the in-browser
 * model in a single worker batch (≈ 81 rows, a few ms). Powers the inspector's cohort position strip
 * (WORKSTATION_V2 §5.9 item 5) without a new ML artifact.
 */
function scoreCohort(cohort: CohortResponse): Promise<CohortScores> {
  if (!pending) {
    pending = getSharedInferenceClient()
      .predictBatch(cohort.patients.map((p) => p.features))
      .then((scores) => {
        const byTarget: CohortScores['byTarget'] = {};
        for (const s of scores) {
          for (const [t, p] of Object.entries(s.predictions)) (byTarget[t] ??= []).push(p.probability);
        }
        for (const list of Object.values(byTarget)) list?.sort((a, b) => a - b);
        resolved = {
          byTarget,
          n: cohort.patients.length,
          nTest: cohort.patients.filter((p) => p.split === 'test').length,
          nDev: cohort.patients.filter((p) => p.split !== 'test').length,
        };
        return resolved;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

/** The cohort scores, or null while loading / when the edge model is unavailable (the strip then hides). */
export function useCohortScores(): CohortScores | null {
  const cohort = useCohort();
  const [scores, setScores] = useState<CohortScores | null>(resolved);
  useEffect(() => {
    if (scores || !cohort.data) return;
    let alive = true;
    scoreCohort(cohort.data).then(
      (s) => alive && setScores(s),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [cohort.data, scores]);
  return scores;
}

/** Share of cohort patients strictly below `p` (0–1). */
export function percentileBelow(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < p) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
