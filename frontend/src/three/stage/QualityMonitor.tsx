import { PerformanceMonitor } from '@react-three/drei';
import { useRef } from 'react';
import { useViewerStore } from '@/state/viewerStore';

/**
 * Adaptive render tier (DESIGN_SYSTEM §7.7): start at B; promote to A when the frame rate stays at
 * ≥ 58 fps; demote to C below 45 fps; after 3 flip-flops lock at C. A manually chosen tier is respected.
 */
export function QualityMonitor() {
  const lastFps = useRef(0);
  const setTier = useViewerStore((s) => s.setTier);
  const setFps = useViewerStore((s) => s.setFps);

  const locked = () => useViewerStore.getState().tierLocked;

  return (
    <PerformanceMonitor
      ms={250}
      iterations={8}
      bounds={() => [45, 58]}
      flipflops={3}
      onIncline={() => {
        if (locked()) return;
        const tier = useViewerStore.getState().tier;
        if (tier === 'C') setTier('B');
        else if (tier === 'B') setTier('A');
      }}
      onDecline={() => {
        if (locked()) return;
        const tier = useViewerStore.getState().tier;
        if (tier === 'A') setTier('B');
        else if (tier === 'B') setTier('C');
      }}
      onFallback={() => setTier('C', true)}
      onChange={({ fps }) => {
        // Publish at most ~1 Hz-worthy changes to avoid re-rendering the pill every frame.
        if (Math.abs(fps - lastFps.current) >= 2) {
          lastFps.current = fps;
          setFps(fps);
        }
      }}
    />
  );
}
