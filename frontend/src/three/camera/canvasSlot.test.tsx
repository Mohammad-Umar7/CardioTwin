/** CanvasSlot loading (WORKSTATION_V2 §5.18, P0-4): poster from first paint, crossfade on the first frame. */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewerStore } from '@/state/viewerStore';
import { CanvasSlot, WORKSTATION_POSTER } from '../CanvasSlot';
import { posterFor } from '../posters';
import { useCameraState } from './cameraState';

afterEach(() => {
  useCameraState.setState({ firstFrame: false });
  useViewerStore.setState({ tier: 'B' });
});

describe('CanvasSlot loading', () => {
  it('paints the workstation poster and keeps the canvas layer transparent until the first frame', () => {
    const { container } = render(<CanvasSlot stage="workstation" />);
    const poster = container.querySelector('img');
    expect(poster?.getAttribute('src')).toMatch(/posters\/workstation(-1280)?\.webp$/);
    const layer = container.querySelector('[data-ready]') as HTMLElement;
    expect(layer.dataset.ready).toBe('false');
    expect(layer.className).toContain('opacity-0');
    act(() => useCameraState.getState().markFirstFrame());
    expect(layer.dataset.ready).toBe('true');
    expect(layer.className).toContain('opacity-100');
  });

  it('layers the hero still over the page placeholder (landing backdrop), never a blank hero', () => {
    const { container } = render(<CanvasSlot stage="hero" placeholder={<div data-testid="hero-poster" />} />);
    expect(container.querySelector('[data-testid="hero-poster"]')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('posters/hero');
  });

  it('picks the still rendered for the stage size', () => {
    expect(posterFor('workstation', 1440)).toBe(WORKSTATION_POSTER);
    expect(posterFor('workstation', 1280)).toBe('posters/workstation-1280.webp');
    expect(posterFor('workstation', 1600)).toBe(WORKSTATION_POSTER);
    expect(posterFor('hero', 1270)).toBe('posters/hero-1280.webp');
  });

  it("picks the hero still of the page's layout: beside the copy, or centred when it stacks", () => {
    // A 1024 px split hero is closer in width to the tablet still, but its torso sits beside the copy.
    expect(posterFor('hero', 1014, 'split')).toBe('posters/hero-1280.webp');
    expect(posterFor('hero', 1000, 'stacked')).toBe('posters/hero-820.webp');
    expect(posterFor('hero', 375, 'stacked')).toBe('posters/hero-390.webp');
    // Stages without layout-specific stills ignore the hint.
    expect(posterFor('workstation', 1440, 'stacked')).toBe(WORKSTATION_POSTER);
  });

  it('treats the 2D schematic (tier D) as drawn', () => {
    useViewerStore.setState({ tier: 'D' });
    const { container } = render(<CanvasSlot stage="workstation" />);
    expect((container.querySelector('[data-ready]') as HTMLElement).dataset.ready).toBe('true');
  });
});
