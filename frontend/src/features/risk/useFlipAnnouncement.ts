import { useEffect, useRef, useState } from 'react';

/**
 * Polite screen-reader announcement, only when `key` changes (a band or a verdict flips), debounced 1 s
 * (LUMEN §10.4). The first value is never announced: it is the page content, not a change.
 */
export function useFlipAnnouncement(text: string | null, key: string | null): string {
  const [said, setSaid] = useState('');
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!text || !key) return;
    if (last.current === null) {
      last.current = key;
      return;
    }
    if (key === last.current) return;
    const t = window.setTimeout(() => {
      last.current = key;
      setSaid(text);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [text, key]);
  return said;
}
