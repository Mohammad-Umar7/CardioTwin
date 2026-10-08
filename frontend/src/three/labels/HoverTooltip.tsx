import { useEffect, useRef, useState } from 'react';
import { useManifest } from '@/hooks/useData';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { pickPointer, usePickStore, type PickInfo } from '../stage/pickStore';
import { hoverContent } from './hoverContent';

/** Dwell before the tooltip appears; moving between structures after that updates it at once. */
const DWELL_MS = 300;
const OFFSET = { x: 14, y: 18 };
const EDGE = 8;

/**
 * Hover tooltip over the 3D stage (workstation only): after a 300 ms dwell on a structure it shows its
 * name, SCCT segment and definition next to the pointer, follows the pointer every frame (no React state
 * per move), flips at the stage edges and hides while dragging. Picking data comes from the anatomy's BVH
 * raycaster (`stage/pickStore`).
 */
export function HoverTooltip() {
  const hover = usePickStore((s) => s.hover);
  const stage = useViewerStore((s) => s.stage);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const manifest = useManifest().data;
  const [shown, setShown] = useState<PickInfo | null>(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = stage === 'workstation' && !paletteOpen && !dragging;

  useEffect(() => {
    if (!hover || !enabled) {
      setShown(null);
      return;
    }
    if (shown) {
      setShown(hover);
      return;
    }
    const t = window.setTimeout(() => setShown(hover), DWELL_MS);
    return () => window.clearTimeout(t);
    // `shown` is read, not a trigger: a new hover while shown swaps the content at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, enabled]);

  // Hide while a button is down (orbit drag); back after release.
  useEffect(() => {
    const down = (e: PointerEvent) => e.target instanceof HTMLCanvasElement && setDragging(true);
    const up = () => setDragging(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  // Follow the pointer without re-rendering.
  useEffect(() => {
    if (!shown) return;
    let raf = 0;
    const place = () => {
      const el = ref.current;
      const parent = el?.parentElement;
      const p = pickPointer.screen;
      if (el && parent && p) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        // Stay inside the FREE area (never over the patient or risk card, the toolbar or the context slot).
        const insets = useUiStore.getState().stageInsets;
        const minX = insets.left + EDGE;
        const maxX = parent.clientWidth - insets.right - EDGE;
        const minY = insets.top + EDGE;
        const maxY = parent.clientHeight - insets.bottom - EDGE;
        let x = p[0] + OFFSET.x;
        let y = p[1] + OFFSET.y;
        if (x + w > maxX) x = p[0] - OFFSET.x - w;
        if (y + h > maxY) y = p[1] - OFFSET.y - h;
        x = Math.min(Math.max(minX, x), Math.max(minX, maxX - w));
        y = Math.min(Math.max(minY, y), Math.max(minY, maxY - h));
        el.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [shown]);

  if (!shown) return null;
  const c = hoverContent(shown, manifest);
  // The outer box is placed by a transform every frame; the enter animation runs on the inner card so
  // its keyframed transform never overrides the position.
  return (
    <div ref={ref} data-region="hover-tooltip" className="pointer-events-none absolute left-0 top-0 z-popover w-max max-w-[280px]">
      <div
        role="tooltip"
        className="glass-strong rounded-md px-3 py-2.5 text-label font-normal text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.08),0_18px_44px_-12px_rgba(0,0,0,0.8)] motion-safe:animate-scale-in"
      >
        <p className="text-body-s font-semibold text-primary">{c.title}</p>
        {c.segment && <p className="mt-0.5 text-label font-medium text-primary">{c.segment}</p>}
        {c.definition && <p className="mt-1">{c.definition}</p>}
        {c.note && <p className="mt-1 text-tertiary">{c.note}</p>}
      </div>
    </div>
  );
}
