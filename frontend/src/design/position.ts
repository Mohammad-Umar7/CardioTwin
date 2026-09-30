/** Tiny floating-element positioning (tooltips, popovers): place, flip on overflow, clamp to viewport. */

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface FloatingPosition {
  top: number;
  left: number;
  placement: Placement;
}

const OPPOSITE: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const VIEWPORT_MARGIN = 8;

function place(anchor: DOMRect, w: number, h: number, placement: Placement, offset: number) {
  switch (placement) {
    case 'top':
      return { top: anchor.top - h - offset, left: anchor.left + anchor.width / 2 - w / 2 };
    case 'bottom':
      return { top: anchor.bottom + offset, left: anchor.left + anchor.width / 2 - w / 2 };
    case 'left':
      return { top: anchor.top + anchor.height / 2 - h / 2, left: anchor.left - w - offset };
    case 'right':
      return { top: anchor.top + anchor.height / 2 - h / 2, left: anchor.right + offset };
  }
}

function fits(pos: { top: number; left: number }, w: number, h: number, vw: number, vh: number) {
  return (
    pos.top >= VIEWPORT_MARGIN &&
    pos.left >= VIEWPORT_MARGIN &&
    pos.top + h <= vh - VIEWPORT_MARGIN &&
    pos.left + w <= vw - VIEWPORT_MARGIN
  );
}

export function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  preferred: Placement = 'top',
  offset = 8,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): FloatingPosition {
  const { width: w, height: h } = floating;
  let placement = preferred;
  let pos = place(anchor, w, h, placement, offset);
  if (!fits(pos, w, h, viewport.width, viewport.height)) {
    const flipped = place(anchor, w, h, OPPOSITE[preferred], offset);
    if (fits(flipped, w, h, viewport.width, viewport.height)) {
      placement = OPPOSITE[preferred];
      pos = flipped;
    }
  }
  return {
    placement,
    top: Math.min(Math.max(pos.top, VIEWPORT_MARGIN), viewport.height - h - VIEWPORT_MARGIN),
    left: Math.min(Math.max(pos.left, VIEWPORT_MARGIN), viewport.width - w - VIEWPORT_MARGIN),
  };
}
