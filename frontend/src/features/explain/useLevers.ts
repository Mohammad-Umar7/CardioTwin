import { useEffect, useMemo, useState } from 'react';
import { useSchemaIndex } from '@/hooks/useData';
import { getSharedInferenceClient } from '@/inference';
import { isAbortError } from '@/services/api';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import type { FeatureVector, PredictResponse, TargetId } from '@/types/contracts';
import { leverCandidates, leverRows, mergeCandidates, rankLevers, type Lever, type LeverCandidate } from './levers';

type Probabilities = Partial<Record<TargetId, number>>;

const probabilitiesOf = (r: Pick<PredictResponse, 'predictions'>): Probabilities =>
  Object.fromEntries(Object.entries(r.predictions).map(([t, p]) => [t, p.probability]));

/**
 * Scores rows with the in-browser model in ONE worker message (`predictBatch`, scores only: ≈ 50 µs a row);
 * if the edge model is unavailable, falls back to the active engine one row at a time.
 */
export async function scoreRows(rows: readonly FeatureVector[], signal: AbortSignal): Promise<Probabilities[]> {
  try {
    const scores = await getSharedInferenceClient().predictBatch(rows, { signal });
    return scores.map(probabilitiesOf);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    const engine = useEngineStore.getState().engine;
    if (!engine) throw error;
    const out: Probabilities[] = [];
    for (const row of rows) out.push(probabilitiesOf(await engine.predict(row, { signal })));
    return out;
  }
}

/** Stable cache key of an input vector (key order independent). */
export const featuresKey = (f: FeatureVector): string =>
  JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]]));

interface Scored {
  key: string;
  candidates: LeverCandidate[];
  probabilities: Probabilities[];
}

const cache = new Map<string, Scored>();
const CACHE_MAX = 24;

export type LeverStatus = 'loading' | 'ready' | 'unavailable';

/**
 * Biggest levers for `target` (§5.10): candidates for every target are scored together, so switching the
 * drawer's target is instant, and results are cached per input state. Recomputes 200 ms after the inputs
 * settle; a newer input aborts the running batch.
 */
export function useLevers(target: TargetId, max = 6): { status: LeverStatus; levers: Lever[] } {
  const index = useSchemaIndex();
  const features = usePatientStore((s) => s.features);
  const prediction = usePatientStore((s) => s.prediction);

  const plan = useMemo(() => {
    if (!index || !prediction || Object.keys(features).length === 0) return null;
    const specOf = (k: string) => index.byKey.get(k);
    const perTarget = new Map<TargetId, LeverCandidate[]>();
    for (const t of index.targets) perTarget.set(t.id, leverCandidates(features, prediction.explanations[t.id], specOf, 8));
    const candidates = mergeCandidates([...perTarget.values()]);
    return { key: `${featuresKey(features)}|${candidates.map((c) => c.feature).join(',')}`, candidates, perTarget };
  }, [index, features, prediction]);

  const [scored, setScored] = useState<Scored | null>(() => (plan ? (cache.get(plan.key) ?? null) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!plan) return;
    const hit = cache.get(plan.key);
    if (hit) {
      setScored(hit);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      scoreRows(leverRows(features, plan.candidates), controller.signal).then(
        (probabilities) => {
          const result = { key: plan.key, candidates: plan.candidates, probabilities };
          cache.set(plan.key, result);
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
          setScored(result);
          setFailed(false);
        },
        (error: unknown) => {
          if (!controller.signal.aborted && !isAbortError(error)) setFailed(true);
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [plan, features]);

  return useMemo<{ status: LeverStatus; levers: Lever[] }>(() => {
    if (failed) return { status: 'unavailable', levers: [] };
    if (!plan || !scored) return { status: 'loading', levers: [] };
    const wanted = new Set((plan.perTarget.get(target) ?? []).map((c) => c.feature));
    // Levers that move the estimate by less than half a point are noise at the display precision.
    const levers = rankLevers(target, scored.candidates, scored.probabilities, wanted)
      .filter((l) => Math.abs(l.delta) >= 0.005)
      .slice(0, max);
    // A newer input state is being scored: keep the previous answer on screen, marked as updating.
    return { status: scored.key === plan.key ? 'ready' : 'loading', levers };
  }, [failed, plan, scored, target, max]);
}
