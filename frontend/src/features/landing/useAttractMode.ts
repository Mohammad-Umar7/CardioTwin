import { useEffect, useState, type RefObject } from 'react';
import { useViewerStore } from '@/state/viewerStore';
import type { TargetId } from '@/types/contracts';
import { ATTRACT_RESUME_MS, ATTRACT_START_MS, attractTargetAt } from './attract';

/**
 * Runs attract mode over `containerRef` (the hero). Returns the highlighted vessel, or null. Any
 * pointer-down, wheel or key press inside the hero stops it for 20 s of idle; a vessel the user hovers
 * in 3D stops it too, so the two never fight over `viewerStore.hover`.
 */
export function useAttractMode(containerRef: RefObject<HTMLElement>, vessels: readonly TargetId[], enabled: boolean): TargetId | null {
  const [active, setActive] = useState<TargetId | null>(null);
  const key = vessels.join('|');

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || vessels.length === 0) {
      setActive(null);
      return;
    }
    const viewer = useViewerStore.getState();
    let startAt = performance.now() + ATTRACT_START_MS;
    let stoppedUntil = 0;
    let lastSet: TargetId | null = null;

    const apply = (target: TargetId | null) => {
      if (target === lastSet) return;
      lastSet = target;
      viewer.hover(target);
      setActive(target);
    };
    const tick = () => {
      const now = performance.now();
      apply(now < stoppedUntil || now < startAt ? null : attractTargetAt(now - startAt, vessels));
    };
    const stop = () => {
      stoppedUntil = performance.now() + ATTRACT_RESUME_MS;
      startAt = stoppedUntil;
      apply(null);
    };
    const onMove = () => {
      if (performance.now() < stoppedUntil) stop();
    };

    const iv = setInterval(tick, 200);
    container.addEventListener('pointerdown', stop, true);
    container.addEventListener('wheel', stop, { capture: true, passive: true });
    container.addEventListener('keydown', stop, true);
    container.addEventListener('pointermove', onMove, { passive: true });
    const unsubscribe = useViewerStore.subscribe((s, prev) => {
      if (s.hoveredStructure !== prev.hoveredStructure && s.hoveredStructure !== null && s.hoveredStructure !== lastSet) stop();
    });

    return () => {
      clearInterval(iv);
      container.removeEventListener('pointerdown', stop, true);
      container.removeEventListener('wheel', stop, true);
      container.removeEventListener('keydown', stop, true);
      container.removeEventListener('pointermove', onMove);
      unsubscribe();
      if (lastSet !== null && useViewerStore.getState().hoveredStructure === lastSet) useViewerStore.getState().hover(null);
      setActive(null);
    };
    // `key` stands for `vessels` (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, key, enabled]);

  return active;
}
