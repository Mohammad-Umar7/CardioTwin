import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { beatScale, clampHeartRate } from './heartbeat';

/**
 * Heartbeat driver (DESIGN_SYSTEM §6): calls `apply(scale)` every frame with the beat scale at the
 * patient's own rate (PR, clamped 40–140 bpm). A new rate takes effect at the next beat boundary. In Calm
 * mode, under reduced motion or with Beat off, it settles at 1. Callers decide what beats (the heart and
 * the coronaries riding on it, never the torso or the labels).
 */
export function useHeartbeat(apply: (scale: number) => void): void {
  const phase = useRef(0);
  const rate = useRef(72);
  const last = useRef(1);
  const reduced = useReducedMotion();
  const enabled = useViewerStore((s) => s.heartbeat);

  useFrame((_, delta) => {
    if (!enabled || reduced) {
      if (last.current !== 1) {
        last.current = 1;
        apply(1);
      }
      return;
    }
    const previous = phase.current;
    phase.current += (Math.min(delta, 0.1) * rate.current) / 60;
    if (Math.floor(phase.current) !== Math.floor(previous)) {
      rate.current = clampHeartRate(usePatientStore.getState().features.PR);
    }
    last.current = beatScale(phase.current);
    apply(last.current);
  });
}
