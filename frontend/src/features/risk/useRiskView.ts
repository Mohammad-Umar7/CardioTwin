import { useShallow } from 'zustand/react/shallow';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { selectDisplayedPrediction, selectEditCount, usePatientStore } from '@/state/patientStore';
import type { CohortPatient, PredictResponse } from '@/types/contracts';
import { cathComparison, type CathComparison } from './verdict';

export interface RiskView {
  /** What the numbers show: the recorded baseline while hold-to-compare is held, else the current estimate. */
  prediction: PredictResponse | null;
  /** The automatic baseline ("was …"): the recorded prediction while edits exist (never while comparing). */
  baseline: PredictResponse | null;
  /**
   * The estimate the cath result is compared with: always the RECORDED inputs' prediction, so a what-if is
   * never scored against the angiogram.
   */
  recorded: PredictResponse | null;
  edits: number;
  comparing: boolean;
  /** Stale (V2 §8.3 step 6): a request running longer than 150 ms, or the last update failed. */
  stale: boolean;
  /** No estimate at all: numerals show "–" and "Estimate unavailable". */
  unavailable: boolean;
  error: string | null;
  /** Nothing yet (first load): skeletons. */
  loading: boolean;
}

/** One read of the patient store for every risk component, so they can never disagree. */
export function useRiskView(): RiskView {
  const s = usePatientStore(
    useShallow((st) => ({
      prediction: selectDisplayedPrediction(st),
      recordedPrediction: st.recordedPrediction,
      current: st.prediction,
      status: st.status,
      error: st.error,
      engineStatus: st.engineStatus,
      comparing: st.comparing,
      edits: selectEditCount(st),
    })),
  );
  const slow = useDelayedFlag(s.status === 'loading', 150);
  const unavailable = !s.prediction && (s.status === 'error' || s.engineStatus === 'unavailable');
  const baseline = s.edits > 0 && !s.comparing ? s.recordedPrediction : null;
  return {
    prediction: s.prediction,
    baseline,
    recorded: s.edits > 0 ? s.recordedPrediction : s.current,
    edits: s.edits,
    comparing: s.comparing,
    stale: !!s.prediction && (slow || s.status === 'error'),
    unavailable,
    error: s.error,
    loading: !s.prediction && !unavailable,
  };
}

/** The loaded cohort patient (ground truth lives here), or null for blank / custom patients. */
export function useCohortPatient(): CohortPatient | null {
  const id = usePatientStore((s) => (s.mode === 'cohort' ? s.selectedPatientId : null));
  const cohort = useCohort();
  return (id && cohort.data?.patients.find((p) => p.id === id)) || null;
}

/** Per-target comparison of the recorded-input estimate with the catheterisation result. */
export function useCathAgreement(): { rows: { target: string; cmp: CathComparison }[]; agree: number } | null {
  const index = useSchemaIndex();
  const patient = useCohortPatient();
  const { recorded } = useRiskView();
  if (!index || !patient || !recorded) return null;
  const rows = index.targets
    .map((t) => ({ target: t.id, cmp: cathComparison(t.id, patient.labels[t.id], recorded.predictions[t.id]) }))
    .filter((r): r is { target: string; cmp: CathComparison } => r.cmp !== null);
  return { rows, agree: rows.filter((r) => r.cmp.agrees).length };
}

/** Reveal exists only for held-out TEST patients (V2 §1.7: nothing dead on screen). */
export function useCanReveal(): boolean {
  const patient = useCohortPatient();
  const hasPrediction = usePatientStore((s) => !!s.prediction);
  return !!patient && patient.split === 'test' && hasPrediction;
}
