import { useEffect, useState } from 'react';
import { useCohort } from '@/hooks/useData';
import type { CohortResponse } from '@/types/contracts';
import { scoreRows } from './lib/whatIfEngine';

let pending: { cohort: CohortResponse; promise: Promise<Map<string, number> | null> } | null = null;

/** P(CAD) for every cohort patient's RECORDED inputs, scored once per session in one worker batch. */
function predictCohort(cohort: CohortResponse): Promise<Map<string, number> | null> {
  if (pending?.cohort === cohort) return pending.promise;
  const promise = scoreRows(cohort.patients.map((p) => p.features)).then((scores) =>
    scores ? new Map(cohort.patients.map((p, i) => [p.id, scores[i]!.CAD ?? Number.NaN])) : null,
  );
  // A failure (no edge model yet) may be retried on the next open.
  promise.then((r) => r === null && pending?.promise === promise && (pending = null));
  pending = { cohort, promise };
  return promise;
}

/**
 * CAD pips for the patient switcher (V2 §5.2, P2). The cohort artifact carries no predictions, so the
 * in-browser model scores the 81 recorded profiles once (≈ 4 ms). Null until ready, or when the edge
 * model is unavailable — the switcher then simply shows no pips.
 */
export function useCohortPredictions(): Map<string, number> | null {
  const cohort = useCohort();
  const [result, setResult] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!cohort.data) return;
    let alive = true;
    void predictCohort(cohort.data).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [cohort.data]);
  return result;
}
