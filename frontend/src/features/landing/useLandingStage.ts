/**
 * The landing is a chrome preset over the same stage as the workstation (WORKSTATION_V2 §4.1): on wide screens
 * the hero canvas has the workstation stage's exact rectangle, so the "Enter Workstation" dolly hands the canvas
 * over without a resize or a cut.
 *
 *   - `chrome = 'landing'` while the page is mounted (no stage cards, no vessel labels).
 *   - The free area is published through `uiStore.stageInsets`: the copy column covers the left of the stage,
 *     from its widest rendered line, so the camera centres the torso in what is left. Below the split
 *     breakpoint the hero stacks (copy above the canvas) and nothing covers the stage. The camera rig owns the
 *     pose; the page only describes what covers the stage.
 */
import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

/** From this width the hero sits beside its copy; below it the landing stacks. */
export const LANDING_SPLIT_AT = 1024;
/** The copy column never covers less than this share of the stage (the torso keeps clear of it). */
export const HERO_COPY_MIN_SHARE = 0.34;
/** Breathing room between the copy's widest line and the free area. */
export const COPY_GAP = 40;

export interface HeroInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const NONE: HeroInsets = Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 });

/**
 * Pure: the stage insets for a hero `width` px wide whose copy text ends `copyRight` px from its left edge.
 * `split` says whether the page lays the hero out beside its copy; pass the media query's answer, because the
 * hero's own box is narrower than the viewport by the scrollbar.
 */
export function heroInsets(width: number, copyRight = 0, split = width >= LANDING_SPLIT_AT): HeroInsets {
  if (!(width > 0) || !split) return NONE;
  const left = Math.round(Math.max(width * HERO_COPY_MIN_SHARE, copyRight > 0 ? copyRight + COPY_GAP : 0));
  return { left, right: 0, top: 0, bottom: 0 };
}

/** The split layout's media query, exactly as the page's `lg:` classes evaluate it. */
export const splitLayout = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${LANDING_SPLIT_AT}px)`).matches
    : false;

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

/** Publishes the hero's free area (beside the copy column) while the landing is mounted. */
export function useHeroInsets(heroRef: RefObject<HTMLElement>, copyRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const publish = () => {
      const box = hero.getBoundingClientRect();
      const copy = textRight(copyRef.current);
      useUiStore.getState().setStageInsets(heroInsets(box.width, copy > 0 ? copy - box.left : 0, splitLayout()));
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(hero);
    if (copyRef.current) ro?.observe(copyRef.current);
    // The layout flips at the breakpoint even where the hero's box barely changes (the scrollbar's width).
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(`(min-width: ${LANDING_SPLIT_AT}px)`) : null;
    mql?.addEventListener?.('change', publish);
    // Web fonts change line widths once they load.
    void document.fonts?.ready.then(publish);
    return () => {
      ro?.disconnect();
      mql?.removeEventListener?.('change', publish);
    };
  }, [heroRef, copyRef]);
}

/** True while `el` is at least partly on screen (null = unknown: assume on screen). */
export function useOnScreen(ref: RefObject<HTMLElement>, onChange: (visible: boolean) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      onChange(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => onChange(!!entry?.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, onChange]);
}
