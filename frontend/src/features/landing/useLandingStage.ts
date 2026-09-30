/**
 * The landing is a chrome preset over the same stage as the workstation (WORKSTATION_V2 §4.1, §6.1):
 * the hero canvas has the stage's exact rectangle, so "Open the workstation" never resizes it.
 *
 *   - `chrome = 'landing'` while the page is mounted (labels carry the %, no stage cards). On leave the
 *     preset returns to `workstation`, which is the moment the labels hand the vessel numbers over to the
 *     Risk card (§6.2).
 *   - The free area is published through `uiStore.stageInsets`: the copy covers at least the left 32 % and
 *     the KPI/pillar bands cover the bottom, so the camera's view offset centres the heart at ≈ 66 % of the
 *     width, above the bands. When the set copy is wider than 32 % (display-1 at 1440), the inset follows
 *     its measured right edge, so the vessel labels' lanes never land on the text. The camera rig owns the
 *     pose; the page only describes what covers the stage.
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

/** Breathing room between the copy's widest line and the free area (label lanes, heart). */
export const COPY_GAP = 24;

/**
 * Pure: the stage insets for a hero of `width` px whose bottom `bandsHeight` px are covered and whose copy
 * text ends `copyRight` px from the hero's left edge.
 */
export function heroInsets(width: number, bandsHeight: number, copyRight = 0): HeroInsets {
  if (!(width > 0) || width < LANDING_STACK_BELOW) return { left: 0, right: 0, top: 0, bottom: 0 };
  const left = Math.max(Math.round(width * HERO_COPY_SHARE), copyRight > 0 ? Math.round(copyRight + COPY_GAP) : 0);
  return { left, right: 0, top: 0, bottom: Math.max(0, Math.round(bandsHeight)) };
}

/** Right edge of the widest rendered text line inside `el` (Range line boxes, not the block's box). */
export function textRight(el: Element | null): number {
  if (!el || typeof document === 'undefined' || typeof document.createRange !== 'function') return 0;
  let right = 0;
  for (const node of el.querySelectorAll('h1, p, [data-cta]')) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
    for (const r of rects) right = Math.max(right, r.right);
  }
  return right;
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
export function useHeroInsets(
  heroRef: RefObject<HTMLElement>,
  bandsRef: RefObject<HTMLElement>,
  copyRef?: RefObject<HTMLElement>,
): void {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const publish = () => {
      const box = hero.getBoundingClientRect();
      const bands = bandsRef.current?.getBoundingClientRect().height ?? 0;
      const copy = textRight(copyRef?.current ?? null);
      const insets = heroInsets(box.width, bands, copy > 0 ? copy - box.left : 0);
      // HUD chips sit just above the bands and centre on the free area; CSS reads the same measurement.
      hero.style.setProperty('--landing-bands-h', `${insets.bottom}px`);
      hero.style.setProperty('--landing-free-cx', `${Math.round((insets.left + box.width - insets.right) / 2)}px`);
      useUiStore.getState().setStageInsets(insets);
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(hero);
    if (bandsRef.current) ro?.observe(bandsRef.current);
    if (copyRef?.current) ro?.observe(copyRef.current);
    // Web fonts change line widths once they load.
    void document.fonts?.ready.then(publish);
    return () => ro?.disconnect();
  }, [heroRef, bandsRef, copyRef]);
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
