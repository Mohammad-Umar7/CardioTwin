import { useEffect, useState } from 'react';

/**
 * The section currently being read (first one intersecting the reading band just under the sticky
 * chrome), for "on this page" navigation. Shared by Performance and Methodology.
 */
export function useActiveSection(ids: readonly string[], rootMargin = '-140px 0px -55% 0px'): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const list = key.split('|').filter(Boolean);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = list.find((id) => seen.get(id));
        if (first) setActive(first);
      },
      { rootMargin },
    );
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key, rootMargin]);
  return active;
}

/** Scroll to a section, honouring reduced motion. */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
