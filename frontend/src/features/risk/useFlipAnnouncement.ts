import { useEffect, useRef, useState } from 'react';

/** Quiet time after an estimate settles before it is read out (rapid edits are announced once). */
export const ANNOUNCE_DELAY_MS = 600;

/**
 * Polite screen-reader announcement of the settled estimate (LUMEN §10.4). The first value is never
 * announced: it is the page content, not a change. After that, every settled change of `text` is read out
 * once, ANNOUNCE_DELAY_MS after it lands, so a burst of edits yields one announcement. The region is cleared
 * the moment the estimate moves on, so it never holds a number the card no longer shows (clearing a live
 * region is silent). While `pending` (an update is in flight) nothing is announced.
 */
export function useFlipAnnouncement(text: string | null, pending = false): string {
  const [said, setSaid] = useState('');
  const first = useRef<string | null>(null);
  const saidRef = useRef('');
  saidRef.current = said;
  useEffect(() => {
    if (!text) return;
    if (first.current === null) {
      first.current = text;
      return;
    }
    if (saidRef.current && saidRef.current !== text) setSaid('');
    if (pending || text === saidRef.current) return;
    if (saidRef.current === '' && text === first.current) return;
    const t = window.setTimeout(() => setSaid(text), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [text, pending]);
  return said;
}
