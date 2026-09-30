import { describe, expect, it } from 'vitest';
import { FLOW_CAPTION, FLOW_CAPTION_DETAIL, captionPlacement } from './caption';

describe('illustrative-flow caption', () => {
  it('says the flow is illustrative and not a haemodynamic simulation', () => {
    expect(FLOW_CAPTION.toLowerCase()).toContain('illustrative');
    expect(FLOW_CAPTION.toLowerCase()).toContain('not a haemodynamic simulation');
    expect(FLOW_CAPTION_DETAIL).toMatch(/diastol/);
    expect(FLOW_CAPTION_DETAIL).toMatch(/not|Nothing here is measured/i);
  });

  it('sits in the free area just above the toolbar when chrome overlays the canvas', () => {
    expect(captionPlacement({ left: 304, right: 376, top: 12, bottom: 64 })).toEqual({
      right: '388px',
      bottom: '72px',
      left: '',
      top: '',
    });
  });

  it('falls back to the top-right corner under the legacy HUD watermark', () => {
    expect(captionPlacement({ left: 0, right: 0, top: 0, bottom: 0 })).toEqual({ right: '12px', top: '62px', left: '', bottom: '' });
  });
});
