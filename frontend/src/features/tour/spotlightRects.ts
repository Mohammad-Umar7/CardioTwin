/**
 * Measuring what the guided demo spotlights: DOM regions by selector, or the stage's free area.
 */
import { useLayoutEffect, useState } from 'react';
import { useUiStore } from '@/state/uiStore';
import { clip, inflate, type Bounds, type Rect } from './geometry';
import type { SpotlightSpec } from './script';
import { findVisible } from './waitFor';

const PAD = 6;

/** Usable viewport: between the top bar and the status line (read from the live elements). */
export function viewportBounds(): Bounds {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const header = document.querySelector('header');
  const status = document.querySelector('[role="contentinfo"]');
  const top = header ? header.getBoundingClientRect().bottom : 0;
  const bottom = status ? status.getBoundingClientRect().top : h;
  return { left: 0, top: Math.max(0, top), right: w, bottom: Math.min(h, bottom) };
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** The stage's free area: the stage minus the chrome insets it publishes (V2 §4.1). */
function stageFreeArea(): Rect | null {
  const el = findVisible('[data-region="stage"], [data-scene-host]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const i = useUiStore.getState().stageInsets;
  return { left: r.left + i.left, top: r.top + i.top, width: r.width - i.left - i.right, height: r.height - i.top - i.bottom };
}

/** Brings a spotlit element into view once (pages that scroll, e.g. Model performance). */
function revealOnce(el: HTMLElement, bounds: Bounds, done: WeakSet<HTMLElement>): void {
  if (done.has(el)) return;
  done.add(el);
  const r = el.getBoundingClientRect();
  if (r.top < bounds.top || r.bottom > bounds.bottom) {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: r.height > bounds.bottom - bounds.top ? 'start' : 'center', behavior: reduced ? 'auto' : 'smooth' });
  }
}

export function measureSpotlights(
  specs: readonly SpotlightSpec[],
  bounds: Bounds,
  revealed: WeakSet<HTMLElement> = new WeakSet(),
): (Rect | null)[] {
  return specs.map((spec) => {
    const raw = 'stage' in spec ? stageFreeArea() : (() => {
      const el = findVisible(spec.selector);
      if (el) revealOnce(el, bounds, revealed);
      return el ? toRect(el.getBoundingClientRect()) : null;
    })();
    if (!raw) return null;
    // The stage hole stays inside its own edges; element holes get breathing room.
    return 'stage' in spec ? clip(raw, bounds) : inflate(raw, PAD);
  });
}

const same = (a: readonly (Rect | null)[], b: readonly (Rect | null)[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const q = b[i];
    if (!r || !q) return r === q;
    return (
      Math.abs(r.left - q.left) < 0.5 &&
      Math.abs(r.top - q.top) < 0.5 &&
      Math.abs(r.width - q.width) < 0.5 &&
      Math.abs(r.height - q.height) < 0.5
    );
  });

/**
 * Tracks the spotlit rectangles every frame while the tour is open (cards slide, drawers dock, routes
 * change), but re-renders only when a rectangle actually moves. The rectangles always line up with
 * `specs` (same length, same order): a beat change never hands back the previous beat's rectangles, and
 * the first measurement runs before paint.
 */
export function useSpotlightRects(specs: readonly SpotlightSpec[]): { rects: (Rect | null)[]; bounds: Bounds } {
  const [state, setState] = useState<{ specs: readonly SpotlightSpec[]; rects: (Rect | null)[]; bounds: Bounds }>(() => ({
    specs,
    rects: specs.map(() => null),
    bounds: { left: 0, top: 0, right: 0, bottom: 0 },
  }));
  useLayoutEffect(() => {
    let raf = 0;
    const revealed = new WeakSet<HTMLElement>();
    const measure = () => {
      const bounds = viewportBounds();
      const rects = measureSpotlights(specs, bounds, revealed);
      setState((prev) => {
        const b = prev.bounds;
        const boundsSame =
          b.left === bounds.left && b.top === bounds.top && b.right === bounds.right && b.bottom === bounds.bottom;
        return prev.specs === specs && boundsSame && same(prev.rects, rects) ? prev : { specs, rects, bounds };
      });
    };
    const frame = () => {
      measure();
      raf = requestAnimationFrame(frame);
    };
    measure();
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [specs]);
  // Between a beat change and its first measurement the stored rectangles belong to the previous beat.
  if (state.specs !== specs) return { rects: specs.map(() => null), bounds: state.bounds };
  return state;
}
