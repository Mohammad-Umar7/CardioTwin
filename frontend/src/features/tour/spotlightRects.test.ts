import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SpotlightSpec } from './script';
import { useSpotlightRects } from './spotlightRects';

describe('useSpotlightRects', () => {
  it('always returns one rectangle per spec, even in the render right after a beat change', () => {
    const two: readonly SpotlightSpec[] = [{ stage: true }, { selector: '[data-region="inspector"]' }];
    const one: readonly SpotlightSpec[] = [{ stage: true }];
    const { result, rerender } = renderHook(({ specs }) => useSpotlightRects(specs), { initialProps: { specs: two } });
    expect(result.current.rects).toHaveLength(2);
    rerender({ specs: one });
    expect(result.current.rects).toHaveLength(1);
    rerender({ specs: two });
    expect(result.current.rects).toHaveLength(2);
  });
});
