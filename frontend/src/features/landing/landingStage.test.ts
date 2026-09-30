import { describe, expect, it } from 'vitest';
import { ATTRACT_STEP_MS, attractBlurb, attractTargetAt, circled } from './attract';
import { HERO_COPY_SHARE, heroInsets } from './useLandingStage';

describe('heroInsets', () => {
  it('covers the left 32 % and the bands, so the heart centre lands at 66 % of the width', () => {
    const insets = heroInsets(1440, 150);
    expect(insets).toEqual({ left: 461, right: 0, top: 0, bottom: 150 });
    const centre = (insets.left + 1440 - insets.right) / 2 / 1440;
    expect(centre).toBeCloseTo((HERO_COPY_SHARE + 1) / 2, 2);
    expect(centre).toBeCloseTo(0.66, 2);
  });

  it('moves the free area past copy that is wider than 32 %', () => {
    expect(heroInsets(1440, 150, 563).left).toBe(587);
    expect(heroInsets(1440, 150, 300).left).toBe(461);
  });

  it('publishes nothing when the landing stacks below 1100 px', () => {
    expect(heroInsets(1024, 300)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(heroInsets(0, 0)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('attract mode', () => {
  const V = ['LAD', 'LCX', 'RCA'];

  it('cycles LAD → LCX → RCA every 4 s, then rests one slot', () => {
    const at = (k: number) => attractTargetAt(k * ATTRACT_STEP_MS + 10, V);
    expect([0, 1, 2, 3, 4].map(at)).toEqual(['LAD', 'LCX', 'RCA', null, 'LAD']);
    expect(attractTargetAt(-1, V)).toBeNull();
    expect(attractTargetAt(0, [])).toBeNull();
  });

  it('numbers hotspots with circled digits and describes each artery in plain words', () => {
    expect([1, 2, 3].map(circled).join('')).toBe('①②③');
    expect(attractBlurb('LAD')).toEqual({ name: 'Left anterior descending', feeds: 'feeds the front wall and septum' });
    expect(attractBlurb('LM', 'Left main', 'Most of the left heart')).toEqual({
      name: 'Left main',
      feeds: 'feeds most of the left heart',
    });
  });
});
