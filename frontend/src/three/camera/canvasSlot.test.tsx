/** CanvasSlot loading (WORKSTATION_V2 §5.18, P0-4): poster from first paint, crossfade on the first frame. */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewerStore } from '@/state/viewerStore';
import { CanvasSlot, WORKSTATION_POSTER } from '../CanvasSlot';
import { useCameraState } from './cameraState';

afterEach(() => {
  useCameraState.setState({ firstFrame: false });
  useViewerStore.setState({ tier: 'B' });
});

describe('CanvasSlot loading', () => {
  it('paints the workstation poster and keeps the canvas layer transparent until the first frame', () => {
    const { container } = render(<CanvasSlot stage="workstation" />);
    const poster = container.querySelector('img');
    expect(poster?.getAttribute('src')).toContain(WORKSTATION_POSTER);
    const layer = container.querySelector('[data-ready]') as HTMLElement;
    expect(layer.dataset.ready).toBe('false');
    expect(layer.className).toContain('opacity-0');
    act(() => useCameraState.getState().markFirstFrame());
    expect(layer.dataset.ready).toBe('true');
    expect(layer.className).toContain('opacity-100');
  });

  it('uses the page placeholder instead of the poster (landing hero)', () => {
    const { container } = render(<CanvasSlot stage="hero" placeholder={<div data-testid="hero-poster" />} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="hero-poster"]')).not.toBeNull();
  });

  it('treats the 2D schematic (tier D) as drawn', () => {
    useViewerStore.setState({ tier: 'D' });
    const { container } = render(<CanvasSlot stage="workstation" />);
    expect((container.querySelector('[data-ready]') as HTMLElement).dataset.ready).toBe('true');
  });
});
