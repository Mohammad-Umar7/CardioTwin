import { useEffect } from 'react';
import { useViewerStore } from '@/state/viewerStore';
import { useIsReducedMotion } from './useMediaQuery';

/**
 * Mirrors the 3D render tier onto `<html data-tier>`, so the glass material can step down with the scene: at
 * tiers C and D (a struggling GPU) the blur over the canvas is dropped for the dense opaque panel (globals.css).
 */
export function useTierAttribute(): void {
  const tier = useViewerStore((s) => s.tier);
  useEffect(() => {
    document.documentElement.dataset.tier = tier;
  }, [tier]);
}

/**
 * LUMEN 2 ambient effects, installed once by the shell. Both are pure decoration layered on plain markup:
 * without them (tests, no JS, reduced motion) the page renders exactly the same content, fully visible.
 *
 *   useSpotlight — one delegated pointer listener sets `--mx` / `--my` (px) on the `.spotlight` element under
 *                  the pointer, so its radial light follows the cursor. rAF-coalesced, no React state.
 *   useReveal    — arms `html.reveal-on` and marks every `[data-reveal]` inside #main with `data-revealed`
 *                  the first time it scrolls into view (CSS does the rise). New nodes are picked up as routes
 *                  render. Off under reduced motion / Calm, and where IntersectionObserver is missing.
 */
export function useSpotlight(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover)').matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.spotlight') : null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
      target.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
}

export function useReveal(): void {
  const reduced = useIsReducedMotion();
  useEffect(() => {
    const root = document.documentElement;
    if (reduced || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      root.classList.remove('reveal-on');
      return;
    }
    const main = document.getElementById('main') ?? document.body;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = '';
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    const seen = new WeakSet<Element>();
    const scan = (node: ParentNode) => {
      const found = node instanceof Element && node.matches('[data-reveal]') ? [node] : [];
      for (const el of [...found, ...node.querySelectorAll('[data-reveal]')]) {
        if (seen.has(el) || (el as HTMLElement).dataset.revealed !== undefined) continue;
        seen.add(el);
        io.observe(el);
      }
    };
    scan(main);
    root.classList.add('reveal-on');
    const mo = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) scan(node);
      }
    });
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
      root.classList.remove('reveal-on');
    };
  }, [reduced]);
}
