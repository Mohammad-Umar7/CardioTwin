import { useEffect, useState, useSyncExternalStore } from 'react';
import { useViewerStore } from '@/state/viewerStore';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * Layout mode (WORKSTATION_V2 §4.7):
 *   wide     ≥ 1440 — the full-bleed stage with the 1440 card and drawer sizes
 *   standard 1100–1439 (and 200 % zoom) — the same stage with the 1280 sizes (tokens.css)
 *   compact  < 1100 — stacked: a 50vh stage on top, Summary · Record · Why tabs below
 */
export type LayoutMode = 'wide' | 'standard' | 'compact';

export function useLayoutMode(): LayoutMode {
  const wide = useMediaQuery('(min-width: 1440px)');
  const standard = useMediaQuery('(min-width: 1100px)');
  return wide ? 'wide' : standard ? 'standard' : 'compact';
}

/**
 * OS `prefers-reduced-motion` OR the in-app Calm mode, without side effects: use this in components.
 * (`useReducedMotion` below is the app-level controller that also mirrors Calm onto <html>.)
 */
export function useIsReducedMotion(): boolean {
  const os = useMediaQuery('(prefers-reduced-motion: reduce)');
  const calm = useViewerStore((s) => s.calm);
  return os || calm;
}

/** OS `prefers-reduced-motion` OR the in-app Calm mode (key C). Mirrors the result onto <html data-calm>. */
export function useReducedMotion(): boolean {
  const os = useMediaQuery('(prefers-reduced-motion: reduce)');
  const calm = useViewerStore((s) => s.calm);
  const reduced = os || calm;
  useEffect(() => {
    document.documentElement.dataset.calm = calm ? 'true' : 'false';
  }, [calm]);
  return reduced;
}

/** True only after `flag` has stayed true for `delayMs` (avoids flashing "updating" on fast responses). */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [flag, delayMs]);
  return flag && shown;
}
