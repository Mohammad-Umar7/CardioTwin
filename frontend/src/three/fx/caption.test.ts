import { describe, expect, it } from 'vitest';
import { FLOW_CAPTION, FLOW_CAPTION_DETAIL, captionPlacement, captionVisible } from './caption';

describe('illustrative-flow caption', () => {
  it('says the flow is illustrative and not a haemodynamic simulation', () => {
    expect(FLOW_CAPTION.toLowerCase()).toContain('illustrative');
    expect(FLOW_CAPTION.toLowerCase()).toContain('not a haemodynamic simulation');
    expect(FLOW_CAPTION_DETAIL).toMatch(/diastol/);
    expect(FLOW_CAPTION_DETAIL).toMatch(/not|Nothing here is measured/i);
  });

  it('sits in one fixed spot (canvas centre, above the toolbar row) whatever the chrome does', () => {
    const p = captionPlacement();
    expect(p.left).toBe('50%');
    expect(p.transform).toBe('translateX(-50%)');
    expect(p.bottom).toContain('var(--toolbar-h');
    expect(p.right).toBe('');
    expect(p.top).toBe('');
  });

  it('shows only while flow is visible on uncovered, lit coronaries', () => {
    const on = { flowOpacity: 1, ignited: true, coronarySolid: 1, peel: 0.6 };
    expect(captionVisible(on)).toBe(true);
    expect(captionVisible({ ...on, flowOpacity: 0 })).toBe(false);
    expect(captionVisible({ ...on, ignited: false })).toBe(false);
    expect(captionVisible({ ...on, coronarySolid: 0 })).toBe(false);
    expect(captionVisible({ ...on, peel: 0.2 })).toBe(false);
  });
});
