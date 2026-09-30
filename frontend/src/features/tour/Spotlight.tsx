import { useEffect, useId, useState } from 'react';
import { mergeOverlapping, scrimPath, type Rect } from './geometry';

const RADIUS = 10;

/**
 * Scrim with spotlight holes (WORKSTATION_V2 §6.3). The dimming is an SVG mask, so holes can overlap and
 * glide between beats (CSS transitions on the rect geometry). A separate blocker catches clicks outside the
 * holes (clip-path, even-odd), so the spotlit region itself stays live: the heart can still be rotated.
 * The status line (z 90) stays above the scrim (z 70).
 */
export function Spotlight({ rects, onBackdrop }: { rects: readonly (Rect | null)[]; onBackdrop?(): void }) {
  const maskId = useId().replace(/:/g, '');
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const holes = rects.filter((r): r is Rect => r !== null);
  const blocker = scrimPath(size.w, size.h, mergeOverlapping(holes), RADIUS);
  const geometry = (r: Rect) => ({ x: r.left, y: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height) });

  return (
    <>
      <svg aria-hidden className="pointer-events-none fixed inset-0 z-scrim" width={size.w} height={size.h}>
        <defs>
          <mask id={maskId}>
            <rect x={0} y={0} width={size.w} height={size.h} fill="white" />
            {holes.map((r, i) => (
              <rect
                key={i}
                rx={RADIUS}
                fill="black"
                style={geometry(r)}
                className="transition-[x,y,width,height] duration-base ease-out"
              />
            ))}
          </mask>
        </defs>
        <rect x={0} y={0} width={size.w} height={size.h} fill="rgb(7 9 12 / 0.58)" mask={`url(#${maskId})`} />
        {holes.map((r, i) => (
          <rect
            key={i}
            rx={RADIUS}
            fill="none"
            stroke="rgb(var(--c-accent) / 0.55)"
            strokeWidth={1}
            style={geometry(r)}
            className="transition-[x,y,width,height] duration-base ease-out"
          />
        ))}
      </svg>
      <div
        aria-hidden
        className="fixed inset-0 z-scrim"
        style={{ clipPath: `path(evenodd, '${blocker}')` }}
        onPointerDown={(e) => {
          e.preventDefault();
          onBackdrop?.();
        }}
      />
    </>
  );
}
