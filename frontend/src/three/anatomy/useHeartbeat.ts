import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { cardiacClock } from '../fx/cardiacClock';
import { sceneRuntime } from '../stage/sceneRuntime';
import { atrial, beatScale, ventricular } from './heartbeat';

/** Envelope rate: the beat fades in / out over ≈ 0.6 s instead of snapping (toggle, Calm, assembly). */
const LAMBDA_ENVELOPE = 5;

export interface BeatFrame {
  /** Cardiac phase φ ∈ [0, 1) of the shared clock. */
  phase: number;
  /** Enveloped ventricular / atrial activation (0 = resting shape). */
  v: number;
  a: number;
  /** 0..1 — how much of the beat is applied. */
  envelope: number;
}

/**
 * Advances the scene's shared cardiac clock (`fx/cardiacClock`) at the patient's own rate (PR, clamped
 * 40–140 bpm, a new rate from the next beat boundary) and returns a ref with this frame's enveloped beat.
 * The clock's `tick` is idempotent per frame, so the fx layer's own driver and this hook can both call it:
 * the anatomy, the flow particles and the pulse wave always share ONE phase. Off in Calm mode, under
 * reduced motion, with Beat off, and while `gate()` is false (e.g. during the cold-load assembly).
 */
export function useBeat(gate: () => boolean = () => true): { current: BeatFrame } {
  const frame = useRef<BeatFrame>({ phase: 0, v: 0, a: 0, envelope: 0 });
  const reduced = useReducedMotion();

  useFrame((state, delta) => {
    const viewer = useViewerStore.getState();
    cardiacClock.setRate(usePatientStore.getState().features.PR);
    cardiacClock.tick(delta, state.clock.elapsedTime);
    const on = viewer.heartbeat && !viewer.calm && !reduced && gate();
    const f = frame.current;
    const target = on ? 1 : 0;
    f.envelope = reduced ? target : target + (f.envelope - target) * Math.exp(-LAMBDA_ENVELOPE * Math.min(delta, 0.1));
    if (Math.abs(f.envelope - target) < 1e-3) f.envelope = target;
    f.phase = cardiacClock.phase;
    f.v = ventricular(f.phase) * f.envelope;
    f.a = atrial(f.phase) * f.envelope;
    sceneRuntime.beat.phase = f.phase;
    sceneRuntime.beat.v = f.v;
    sceneRuntime.beat.a = f.a;
    sceneRuntime.beat.bpm = cardiacClock.bpm;
  });

  return frame;
}

/**
 * Legacy scalar heartbeat for the procedural placeholder heart: calls `apply(scale)` every frame with the
 * enveloped beat scale (1 → 0.97 at end-systole) on the shared clock.
 */
export function useHeartbeat(apply: (scale: number) => void): void {
  const beat = useBeat();
  const last = useRef(1);
  useFrame(() => {
    const s = 1 - (1 - beatScale(beat.current.phase)) * beat.current.envelope;
    if (s !== last.current) {
      last.current = s;
      apply(s);
    }
  });
}
