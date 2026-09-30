/**
 * Attract mode (WORKSTATION_V2 §6.1, P3): numbered hotspots ① LAD ② LCX ③ RCA cycle every 4 s, each with
 * a one-line caption, then a rest slot with nothing highlighted. It stops on the first pointer-down and
 * resumes after 20 s idle. Highlighting reuses `viewerStore.hover`, which lights the vessel and its label
 * and never moves the camera.
 */
import type { TargetId } from '@/types/contracts';

export const ATTRACT_STEP_MS = 4000;
export const ATTRACT_RESUME_MS = 20000;
/** Delay before the first hotspot, so the heart settles and its labels fade in first. */
export const ATTRACT_START_MS = 2500;

/** Target highlighted `elapsedMs` into the cycle (null during the rest slot or before any vessel). */
export function attractTargetAt(elapsedMs: number, vessels: readonly TargetId[], stepMs = ATTRACT_STEP_MS): TargetId | null {
  if (vessels.length === 0 || !(elapsedMs >= 0) || !(stepMs > 0)) return null;
  const slot = Math.floor(elapsedMs / stepMs) % (vessels.length + 1);
  return vessels[slot] ?? null;
}

/** Circled ordinal for the hotspot badge: 1 → ①. */
export const circled = (n: number): string => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}.`);

/** Plain-words name and what each artery feeds; the schema label and territory are the fallback. */
const BLURBS: Record<string, { name: string; feeds: string }> = {
  LAD: { name: 'Left anterior descending', feeds: 'feeds the front wall and septum' },
  LCX: { name: 'Left circumflex', feeds: 'feeds the side wall' },
  RCA: { name: 'Right coronary', feeds: 'feeds the right ventricle and the underside' },
};

export function attractBlurb(id: TargetId, label?: string | null, territory?: string | null): { name: string; feeds: string | null } {
  const known = BLURBS[id];
  if (known) return known;
  return { name: label ?? id, feeds: territory ? `feeds ${territory.charAt(0).toLowerCase()}${territory.slice(1)}` : null };
}
