import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { PEEL_REST, useViewerStore } from '@/state/viewerStore';
import { DETENTS, nearestDetent, peelValueText, snapToDetent, stepDetent, usePeelPlayer } from './peel';

/** `:focus-visible` (keyboard focus), false where the selector is unsupported. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Peel slider (WORKSTATION_V2 §5.11): 144 px (128 at 1280), five detents — Closed · Skin off · Ribs open ·
 * Lungs aside ◆ · Open heart — magnetic within ±0.02, the stop name in a tooltip above the thumb while
 * hovered, focused or dragged, ←/→ step between detents (Home / End to the ends). While ▶ Dissect plays the thumb is locked
 * and a press cancels the animation. Wired to `viewerStore.setExplode`; the scene's spring does the easing.
 */
export function PeelSlider({ className }: { className?: string }) {
  const value = useViewerStore((s) => s.explode);
  const playing = usePeelPlayer((s) => s.playing);
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // The stop name also shows on hover and keyboard focus, so the five stops are discoverable at rest.
  const [peek, setPeek] = useState(false);

  const fromPointer = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return value;
    return snapToDetent((clientX - rect.left) / rect.width);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (playing) {
      usePeelPlayer.getState().stop();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    useViewerStore.getState().setExplode(fromPointer(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    useViewerStore.getState().setExplode(fromPointer(e.clientX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const set = (v: number) => {
      e.preventDefault();
      usePeelPlayer.getState().stop();
      useViewerStore.getState().setExplode(v);
    };
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'PageUp':
        set(stepDetent(value, 1));
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'PageDown':
        set(stepDetent(value, -1));
        break;
      case 'Home':
        set(0);
        break;
      case 'End':
        set(1);
        break;
      default:
    }
  };

  const pct = Math.round(value * 1000) / 10;
  const detent = nearestDetent(value);
  // The toolbar card clips its content, so the stop tooltip floats in a portal above the thumb.
  const rect = dragging || peek ? track.current?.getBoundingClientRect() : null;
  const tip =
    rect &&
    createPortal(
      <span
        aria-hidden
        className="pointer-events-none fixed z-popover -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-label font-normal text-primary shadow-e2"
        style={{ left: rect.left + (rect.width * pct) / 100, top: rect.top - 14 }}
      >
        {detent.label}
      </span>,
      document.body,
    );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Peel"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={peelValueText(value)}
      aria-disabled={playing ? true : undefined}
      data-region="peel"
      onPointerDown={onPointerDown}
      onPointerEnter={() => setPeek(true)}
      onPointerLeave={() => setPeek(false)}
      onFocus={(e) => setPeek(focusVisible(e.currentTarget))}
      onBlur={() => setPeek(false)}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-8 w-36 shrink-0 cursor-pointer touch-none select-none items-center rounded-sm px-2 outline-none',
        'hover:bg-surface-1 focus-visible:shadow-focus max-[1439.98px]:h-7 max-[1439.98px]:w-32',
        playing && 'cursor-default',
        className,
      )}
    >
      <div ref={track} className="relative h-full w-full">
        {/* Track and fill */}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line" />
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent/70"
          style={{ width: `${pct}%` }}
        />
        {/* Detent ticks; the rest detent ("Lungs aside") is a diamond */}
        {DETENTS.map((d) => (
          <span
            key={d.id}
            aria-hidden
            className={cn(
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
              d.value === PEEL_REST
                ? 'size-[5px] rotate-45 rounded-[1px] bg-secondary'
                : 'h-[7px] w-px bg-tertiary',
              d.value <= value + 1e-6 && d.value !== PEEL_REST && 'bg-accent',
            )}
            style={{ left: `${d.value * 100}%` }}
          />
        ))}
        {/* Thumb */}
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_3px_rgb(var(--c-bg-panel))] transition-transform duration-instant ease-out',
            dragging && 'scale-110',
            playing && 'bg-accent',
          )}
          style={{ left: `${pct}%` }}
        />
      </div>
      {tip}
    </div>
  );
}
