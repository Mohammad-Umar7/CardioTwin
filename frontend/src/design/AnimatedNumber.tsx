import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { MOTION, EASE } from '@/theme/tokens';

export interface AnimatedNumberProps {
  value: number;
  format(value: number): string;
  /** Tween duration; spec `data` = 420 ms (120 ms while dragging). */
  duration?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

/** cubic-bezier(x1, y1, x2, y2) evaluated by Newton iteration on x. */
function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (sx(t) - x) / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}

const easeData = bezier(EASE.data);

/**
 * Number that tweens from its previous value to the new one (`data` motion token). It never counts
 * up from 0 on mount (spec §0 "Rejected") and updates instantly under reduced motion. The text node is
 * written directly each frame, so React does not re-render during the tween.
 */
export function AnimatedNumber({ value, format, duration = MOTION.data, className, ...rest }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    const to = value;
    if (reduced || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
      shown.current = to;
      el.textContent = format(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (to - from) * easeData(t);
      shown.current = v;
      el.textContent = format(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced, format]);

  return (
    <span ref={ref} className={className} aria-hidden={rest['aria-hidden']}>
      {format(shown.current)}
    </span>
  );
}
