import type { Stage } from '@/state/viewerStore';

/**
 * Stills of the live canvas (V2 §5.18), one per stage and stage size, each ≤ 120 KB: the workstation home
 * pose at 1440×824 and 1280×656, and the landing hero pose at the hero's size. The slot picks the one
 * rendered for its own width, so the poster → first-frame crossfade never jumps in size or look. Re-render
 * them with `__ctPoster()` (SceneHost) after any change to the look or the framing.
 */
export const POSTERS: Readonly<Record<Exclude<Stage, 'hidden'>, readonly { width: number; src: string }[]>> = {
  workstation: [
    { width: 1440, src: 'posters/workstation.webp' },
    { width: 1280, src: 'posters/workstation-1280.webp' },
  ],
  hero: [
    { width: 1440, src: 'posters/hero.webp' },
    { width: 1280, src: 'posters/hero-1280.webp' },
  ],
};
/** The still rendered for the size closest to `width`. */
export function posterFor(stage: Exclude<Stage, 'hidden'>, width: number): string {
  const list = POSTERS[stage];
  let best = list[0]!;
  for (const p of list) if (Math.abs(p.width - width) < Math.abs(best.width - width)) best = p;
  return best.src;
}
