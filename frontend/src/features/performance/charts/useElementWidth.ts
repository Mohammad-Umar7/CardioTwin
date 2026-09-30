import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Content-box width of an element, tracked with a ResizeObserver. Charts render at 1:1 pixels (no
 * viewBox scaling), so axis text stays exactly 12 px at every width. `fallback` is used before the
 * first measurement and in environments without layout (jsdom).
 */
export function useElementWidth(ref: RefObject<HTMLElement>, fallback = 480): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? Math.floor(w) : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
