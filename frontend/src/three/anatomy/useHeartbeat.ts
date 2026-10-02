import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { cardiacClock } from '../fx/cardiacClock';
import { sceneRuntime } from '../stage/sceneRuntime';
import { atrial, beatProfileFrom, beatScale, diastasisShareFor, twist, ventricular, type BeatProfile } from './heartbeat';

/** Envelope rate: the beat fades in / out over ≈ 0.6 s instead of snapping (toggle, Calm, assembly). */
const LAMBDA_ENVELOPE = 5;

export interface BeatFrame {
  /** Cardiac phase φ ∈ [0, 1) of the shared clock. */
  phase: number;
  /** Enveloped ventricular / atrial activation and LV twist (0 = resting shape). */
  v: number;
  a: number;
  t: number;
  /** 0..1 — how much of the beat is applied. */
  envelope: number;
}

/** The patient's beat (rate, interval durations, E/A balance, contraction amplitude), cached per input set. */
const profileCache = { features: null as unknown, profile: beatProfileFrom(null) };
export function currentBeatProfile(): BeatProfile {
  const features = usePatientStore.getState().features;
  if (features !== profileCache.features) {
    profileCache.features = features;
    profileCache.profile = beatProfileFrom(features as Readonly<Record<string, unknown>>);
  }
  return profileCache.profile;
}

/**
 * Advances the scene's shared cardiac clock (`fx/cardiacClock`) at the patient's own rate and physiology (PR,
 * clamped 40–140 bpm; age, hypertension and sex set the intervals' durations; a new rate from the next beat
 * boundary) and returns a ref with this frame's enveloped beat, shaped by the patient (`beatProfileFrom`: the
 * atrial share of the filling, the contraction amplitude from the ejection fraction). The clock's `tick` is
 * idempotent per frame, so the fx layer's own driver and this hook can both call it: the anatomy, the flow
 * particles and the pulse wave always share ONE phase. Off in Calm mode, under reduced motion, with Beat off, and
 * while `gate()` is false (e.g. during the cold-load assembly).
 */
export function useBeat(gate: () => boolean = () => true): { current: BeatFrame } {
  const frame = useRef<BeatFrame>({ phase: 0, v: 0, a: 0, t: 0, envelope: 0 });
  const reduced = useReducedMotion();

  useFrame((state, delta) => {
    const viewer = useViewerStore.getState();
    const profile = currentBeatProfile();
    cardiacClock.setRate(profile.bpm);
    cardiacClock.setPhysiology(profile);
    cardiacClock.tick(delta, state.clock.elapsedTime);
    const on = viewer.heartbeat && !viewer.calm && !reduced && gate();
    const f = frame.current;
    const target = on ? 1 : 0;
    f.envelope = reduced ? target : target + (f.envelope - target) * Math.exp(-LAMBDA_ENVELOPE * Math.min(delta, 0.1));
    if (Math.abs(f.envelope - target) < 1e-3) f.envelope = target;
    f.phase = cardiacClock.phase;
    const k = f.envelope * profile.contractility;
    // (the diastasis is the 5th interval; its share of the filling follows its real length at this rate)
    f.v = ventricular(f.phase, profile.atrialShare, diastasisShareFor(cardiacClock.intervalDurations[4] ?? 0)) * k;
    f.a = atrial(f.phase) * f.envelope;
    f.t = twist(f.phase) * k;
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
