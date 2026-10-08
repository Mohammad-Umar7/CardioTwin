/**
 * The landing hero's chest (pure; unit tested in heroChest.test.ts): the outer layers drawn as glass around the
 * solid heart — the skin's contour, the rib cage, faint lungs — in a cool blue-grey, and the order in which they
 * clear through the "Enter Workstation" dolly (the outer surface first, the rib cage softly after it).
 *
 * Strengths scale the rig's ghost amount (the fresnel curve itself is tissue.ts `GHOST_CURVES`). The pectorals
 * and the oesophagus stay off: in front of the heart they would only veil it.
 */
import type { TissueKind } from './classify';

export interface HeroChestLayer {
  /** Ghost amount at rest (0..1). */
  strength: number;
  /** Dolly progress over which it clears (eased in-out between the two). */
  fade: readonly [number, number];
}

export const HERO_CHEST: Readonly<Partial<Record<TissueKind, HeroChestLayer>>> = {
  skin: { strength: 1, fade: [0, 0.4] },
  bone: { strength: 0.75, fade: [0.12, 0.58] },
  cartilage: { strength: 0.5, fade: [0.12, 0.58] },
  lung: { strength: 0.32, fade: [0.06, 0.52] },
  airway: { strength: 0.4, fade: [0.06, 0.52] },
  diaphragm: { strength: 0.3, fade: [0.04, 0.44] },
};

/** Ghost tints on the hero: a cool blue-grey glass (the workstation's ghosts keep their own warm greys). */
export const HERO_GHOST_TINT: Readonly<Partial<Record<TissueKind, string>>> = {
  skin: '#9DB4CB',
  bone: '#C6D2DE',
  cartilage: '#A7B8CA',
  lung: '#8CA2B9',
  airway: '#9EB1C4',
  diaphragm: '#8797AA',
  muscle: '#8C9CAD',
  oesophagus: '#8C9CAD',
};

const smooth = (a: number, b: number, x: number) => {
  const t = b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : x >= b ? 1 : 0;
  return t * t * (3 - 2 * t);
};

/** Ghost amount of a chest layer `intro` (0..1) into the dolly; 0 for every kind the hero does not show. */
export function heroChestGhost(kind: TissueKind, intro: number): number {
  const layer = HERO_CHEST[kind];
  if (!layer) return 0;
  return layer.strength * (1 - smooth(layer.fade[0], layer.fade[1], intro));
}
