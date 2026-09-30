/**
 * The landing is a chrome preset over the same stage as the workstation (WORKSTATION_V2 §4.1, §6.1):
 * the hero canvas has the stage's exact rectangle, so "Open the workstation" never resizes it.
 *
 *   - `chrome = 'landing'` while the page is mounted (labels carry the %, no stage cards). On leave the
 *     preset returns to `workstation`, which is the moment the labels hand the vessel numbers over to the
 *     Risk card (§6.2).
 *   - The free area is published through `uiStore.stageInsets`: the copy column covers the left 32 % and
 *     the KPI/pillar bands cover the bottom, so the camera's view offset centres the heart at 66 % of the
 *     width, above the bands. The camera rig owns the pose; the page only describes what covers the stage.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

/** Share of the stage width covered by the hero copy (heart centre at (0.32 + 1) / 2 = 66 %). */
export const HERO_COPY_SHARE = 0.32;
/** Below this width the landing stacks (copy under the canvas) and nothing covers the stage. */
export const LANDING_STACK_BELOW = 1100;

export interface HeroInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Pure: the stage insets for a hero of `width` px whose bottom `bandsHeight` px are covered. */
export function heroInsets(width: number, bandsHeight: number): HeroInsets {
  if (!(width > 0) || width < LANDING_STACK_BELOW) return { left: 0, right: 0, top: 0, bottom: 0 };
  return { left: Math.round(width * HERO_COPY_SHARE), right: 0, top: 0, bottom: Math.max(0, Math.round(bandsHeight)) };
}

/** Sets the landing chrome for the page's lifetime (StrictMode-safe). */
export function useLandingChrome(): void {
  useLayoutEffect(() => {
    const ui = useUiStore.getState();
    ui.setChrome('landing');
    return () => {
      const s = useUiStore.getState();
      // The tour (or another page) may have taken over the chrome; only undo our own preset.
      if (s.chrome === 'landing') s.setChrome('workstation');
      useViewerStore.getState().hover(null);
    };
  }, []);
}

/** Publishes the hero's free area while the landing is mounted. */
export function useHeroInsets(heroRef: RefObject<HTMLElement>, bandsRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const publish = () => {
      const width = hero.getBoundingClientRect().width;
      const bands = bandsRef.current?.getBoundingClientRect().height ?? 0;
      const insets = heroInsets(width, bands);
      // HUD chips sit just above the bands; CSS reads the same measurement.
      hero.style.setProperty('--landing-bands-h', `${insets.bottom}px`);
      useUiStore.getState().setStageInsets(insets);
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(hero);
    if (bandsRef.current) ro?.observe(bandsRef.current);
    return () => ro?.disconnect();
  }, [heroRef, bandsRef]);
}

/**
 * The copy's exit before a route change (§6.2: 240 ms, y −8). Returns `leaving` for the exit styles and
 * `leave(run)`, which plays the exit and then calls `run` (immediately under reduced motion).
 */
export function useLeaveTransition(reduced: boolean): { leaving: boolean; leave(run: () => void): void } {
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(pending, reduced ? 0 : 240);
    return () => clearTimeout(t);
  }, [pending, reduced]);
  return {
    leaving,
    leave(run) {
      setLeaving(true);
      setPending(() => run);
    },
  };
}
