import { useEffect, useMemo, useState } from 'react';
import { usePatientStore } from '@/state/patientStore';
import { useInputInteraction } from './lib/interaction';
import { scoreRows, vectorKey, type TargetProbabilities } from './lib/whatIfEngine';
import { flipped } from './lib/values';

export interface Counterfactuals {
  /** The current inputs, scored by the same engine (so deltas never mix engines). */
  base: TargetProbabilities;
  /** Probabilities if each key were flipped. */
  flipped: Map<string, TargetProbabilities>;
}

const DELAY_MS = 200;

/**
 * Counterfactual probabilities for flipping each binary input in `keys` (V2 §5.6 chip tooltips, P2).
 * One worker batch per input state, cached per exact vector; paused while a value is dragged. Null until
 * the batch for the CURRENT inputs lands, or when the edge model is unavailable.
 */
export function useFlipCounterfactuals(keys: readonly string[], enabled = true): Counterfactuals | null {
  const features = usePatientStore((s) => s.features);
  const dragging = useInputInteraction((s) => s.dragging);
  const [result, setResult] = useState<(Counterfactuals & { forKey: string; keys: string }) | null>(null);
  const currentKey = useMemo(() => vectorKey(features), [features]);
  const keyList = useMemo(() => [...keys], [keys.join('\u0001')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || dragging || keyList.length === 0) return;
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      const rows = [features, ...keyList.map((k) => ({ ...features, [k]: flipped(features[k]) }))];
      void scoreRows(rows, controller.signal).then((scores) => {
        if (controller.signal.aborted || !scores) return;
        setResult({
          base: scores[0]!,
          flipped: new Map(keyList.map((k, i) => [k, scores[i + 1]!])),
          forKey: vectorKey(features),
          keys: keyList.join('|'),
        });
      });
    }, DELAY_MS);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [enabled, dragging, features, keyList]);

  // Never show a counterfactual computed for other inputs (a stale value shown as current).
  if (!enabled || !result || result.forKey !== currentKey || result.keys !== keyList.join('|')) return null;
  return result;
}
