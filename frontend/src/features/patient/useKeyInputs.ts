import { useMemo, useRef } from 'react';
import { useSchemaIndex } from '@/hooks/useData';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import type { TargetId } from '@/types/contracts';
import { useInputInteraction } from './lib/interaction';
import { DEFAULT_EXCLUDE, rankKeyInputs, type KeyInput } from './lib/keyInputs';

export interface KeyInputsResult {
  items: KeyInput[];
  /** True while the first prediction is still on its way (render skeleton rows). */
  loading: boolean;
  /** No prediction can be produced: the list is the schema fallback without direction marks. */
  fallback: boolean;
}

/**
 * The inputs that drive `target` most (WORKSTATION_V2 §5.5, §9.3 B): ranked from the DISPLAYED
 * prediction (the recorded baseline while hold-to-compare is active), re-ranked only when a prediction
 * is committed and never while a value is being dragged.
 */
export function useKeyInputs(
  target: TargetId,
  n = 5,
  { exclude = DEFAULT_EXCLUDE }: { exclude?: readonly string[] } = {},
): KeyInputsResult {
  const index = useSchemaIndex();
  const prediction = usePatientStore(selectDisplayedPrediction);
  const status = usePatientStore((s) => s.status);
  const dragging = useInputInteraction((s) => s.dragging);
  const explanation = prediction?.explanations[target] ?? null;
  const excludeKey = exclude.join('|');

  const ranked = useMemo(
    () => (index ? rankKeyInputs(index, explanation, { n, exclude }) : []),
    // `exclude` is compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, explanation, n, excludeKey],
  );

  // Freeze the order while dragging: the committed ranking stays until the drag ends.
  const frozen = useRef<KeyInput[]>(ranked);
  if (!dragging) frozen.current = ranked;

  return {
    items: frozen.current,
    loading: !index || (!prediction && (status === 'loading' || status === 'idle')),
    fallback: !explanation,
  };
}
