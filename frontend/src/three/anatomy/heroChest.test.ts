import { describe, expect, it } from 'vitest';
import { HERO_CHEST, HERO_GHOST_TINT, heroChestGhost } from './heroChest';
import { OUTER_KINDS, type TissueKind } from './classify';

describe('hero chest', () => {
  it('shows the skin, rib cage and lungs as glass at rest, never the pectorals or the oesophagus', () => {
    expect(heroChestGhost('skin', 0)).toBe(1);
    expect(heroChestGhost('bone', 0)).toBeGreaterThan(0.4);
    expect(heroChestGhost('lung', 0)).toBeGreaterThan(0);
    expect(heroChestGhost('muscle', 0)).toBe(0);
    expect(heroChestGhost('oesophagus', 0)).toBe(0);
    // The heart is never a chest layer.
    expect(heroChestGhost('myocardium', 0)).toBe(0);
    expect(heroChestGhost('coronary', 0)).toBe(0);
  });

  it('clears every layer by the time the camera lands, monotonically, the skin before the rib cage', () => {
    for (const kind of Object.keys(HERO_CHEST) as TissueKind[]) {
      expect(heroChestGhost(kind, 1)).toBe(0);
      let last = heroChestGhost(kind, 0);
      for (let u = 0.02; u <= 1; u += 0.02) {
        const g = heroChestGhost(kind, u);
        expect(g).toBeLessThanOrEqual(last + 1e-12);
        last = g;
      }
    }
    expect(HERO_CHEST.skin!.fade[1]).toBeLessThan(HERO_CHEST.bone!.fade[1]);
    expect(heroChestGhost('skin', 0.4)).toBeLessThan(heroChestGhost('bone', 0.4) / HERO_CHEST.bone!.strength + 1e-9);
  });

  it('tints only the chest layers', () => {
    for (const kind of Object.keys(HERO_GHOST_TINT) as TissueKind[]) expect(OUTER_KINDS.has(kind)).toBe(true);
  });
});
