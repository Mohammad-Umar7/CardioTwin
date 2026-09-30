import { useEffect, useState } from 'react';

export type Phase = 'entering' | 'open' | 'closed';

/**
 * Presence for small HUD elements: keeps the last value mounted while the element plays its exit (`closed`
 * for `exitMs`), and mounts a new value one frame in the `entering` phase so a CSS transition can run the
 * enter (fade + slide). Under reduced motion both happen instantly.
 */
export function usePresence<T>(value: T | null, reduced: boolean, exitMs = 110): { shown: T | null; phase: Phase } {
  const [shown, setShown] = useState(value);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (value !== null) {
      setShown(value);
      if (reduced) {
        setEntered(true);
        return;
      }
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    if (reduced) {
      setShown(null);
      return;
    }
    const t = window.setTimeout(() => setShown(null), exitMs);
    return () => window.clearTimeout(t);
  }, [value, reduced, exitMs]);
  return { shown: value ?? shown, phase: value === null ? 'closed' : entered ? 'open' : 'entering' };
}
