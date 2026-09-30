import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { useViewerStore } from '@/state/viewerStore';
import { qualityStep, type QualitySampler } from './qualitySampler';

/**
 * Adaptive render tier (DESIGN_SYSTEM §7.7): start at B; promote to A when the frame rate stays at
 * ≥ 58 fps; demote to C below 45 fps; after 3 flip-flops lock at C. A manually chosen tier is respected.
 *
 * It measures only frames the page really composites: mount it only while the frame loop is "always"
 * (`enabled`), and any gap longer than `QUALITY_MONITOR.gapMs` (a hidden tab, a throttled pane, an on-demand
 * pause) restarts the window instead of counting as a slow frame — so a background tab never drops the
 * tier, and it comes back with the tier it left with.
 */
export function QualityMonitor({ enabled }: { enabled: boolean }) {
  const sampler = useRef<QualitySampler>({ last: 0, t0: 0, frames: 0, windows: [], lastMove: 0, flips: 0 });
  const lastFps = useRef(0);

  useEffect(() => {
    if (!enabled) sampler.current.last = 0;
  }, [enabled]);

  useFrame(() => {
    if (!enabled) return;
    const viewer = useViewerStore.getState();
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const out = qualityStep(sampler.current, performance.now(), hidden);
    if (out.fps !== null && Math.abs(out.fps - lastFps.current) >= 2) {
      lastFps.current = out.fps;
      viewer.setFps(out.fps);
    }
    if (!out.move || viewer.tierLocked || viewer.tier === 'D') return;
    if (out.move === 'fallback') viewer.setTier('C', true);
    else if (out.move === 'up') viewer.setTier(viewer.tier === 'C' ? 'B' : 'A');
    else viewer.setTier(viewer.tier === 'A' ? 'B' : 'C');
  });

  return null;
}
