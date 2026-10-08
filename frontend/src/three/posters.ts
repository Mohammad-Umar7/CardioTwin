import type { Stage } from '@/state/viewerStore';

/** How the page lays its stage out: beside the copy (split) or under it (stacked). */
export type PosterLayout = 'split' | 'stacked';

/**
 * Stills of the live canvas (V2 §5.18), one per stage and stage size, each ≤ 120 KB: the workstation home
 * pose at 1440×824 and 1280×656, and the landing hero pose at the hero's size — its torso beside the copy at
 * 1440×824 and 1280×656, centred in the stacked stage at 820×620 (tablets) and 390×473 (phones). The slot picks
 * the one rendered for its own width (and layout, when the page says), so the poster → first-frame crossfade
 * never jumps in size or look. Re-render them with `__ctPoster()` (SceneHost) after any change to the look or
 * the framing.
 */
export const POSTERS: Readonly<Record<Exclude<Stage, 'hidden'>, readonly { width: number; src: string; layout?: PosterLayout }[]>> = {
  workstation: [
    { width: 1440, src: 'posters/workstation.webp' },
    { width: 1280, src: 'posters/workstation-1280.webp' },
  ],
  hero: [
    { width: 1440, src: 'posters/hero.webp', layout: 'split' },
    { width: 1280, src: 'posters/hero-1280.webp', layout: 'split' },
    { width: 820, src: 'posters/hero-820.webp', layout: 'stacked' },
    { width: 390, src: 'posters/hero-390.webp', layout: 'stacked' },
  ],
};

/** The still rendered for the size closest to `width`, among those of `layout` when one is given. */
export function posterFor(stage: Exclude<Stage, 'hidden'>, width: number, layout?: PosterLayout): string {
  const all = POSTERS[stage];
  const same = layout ? all.filter((p) => !p.layout || p.layout === layout) : all;
  const list = same.length > 0 ? same : all;
  let best = list[0]!;
  for (const p of list) if (Math.abs(p.width - width) < Math.abs(best.width - width)) best = p;
  return best.src;
}
