import { useEffect, useState } from 'react';
import { usePatientStore } from '@/state/patientStore';
import type { FeatureSpec } from '@/types/contracts';
import { useInputInteraction } from './lib/interaction';
import { iceStrip, type IceResult } from './lib/whatIfEngine';

/** Recompute this long after the last committed input change (DESIGN_SYSTEM §6 step 8). */
const ICE_DELAY_MS = 150;

/**
 * The ICE strip of one numeric input for `target`, from the shared inference worker. Null while
 * computing the first time or when the edge model is unavailable (the strip is then simply absent).
 * The dragged input's own strip never changes; other inputs' strips wait until the drag ends.
 */
export function useIceStrip(spec: FeatureSpec, enabled: boolean): IceResult | null {
  const features = usePatientStore((s) => s.features);
  const dragging = useInputInteraction((s) => s.dragging);
  const [result, setResult] = useState<IceResult | null>(null);

  useEffect(() => {
    if (!enabled || dragging) return;
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      void iceStrip(features, spec, controller.signal).then((r) => {
        if (!controller.signal.aborted && r) setResult(r);
      });
    }, ICE_DELAY_MS);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
    // `features` minus this key is what matters; iceStrip caches on exactly that.
  }, [enabled, dragging, features, spec]);

  return enabled ? result : null;
}

