import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, type Object3D } from 'three';
import { useSchemaIndex } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { cardiacClock } from './cardiacClock';
import { coronaryFlowSpeed, flowAdvance, pulseFront, PULSE_OVERSHOOT } from './cardiacCycle';
import {
  BASE_FLOW_SPEED,
  FLOW_DISTANCE_WRAP,
  IGNITE_DONE,
  IgnitionTrigger,
  MAX_TARGET_SLOTS,
  fxFrame,
  ignitionAt,
  phasicityOf,
  replayIgnition,
  riskFlowParams,
  takeIgnitionRequest,
  targetSlots,
} from './fxState';
import { isAttached } from './sceneNodes';

/** Damping rates λ, matching useRiskAnimation (§6): p 6, availability / selection 8. */
const LAMBDA_P = 6;
const LAMBDA_FAST = 8;
/** Flow fade in/out when toggled (≈ 300 ms, §6 "flow particles fade in over 300 ms"). */
const LAMBDA_FLOW = 10;
/** A request must stay pending this long before the flow drops its risk coding ("updating"). */
const STALE_AFTER_S = 0.45;

/**
 * The single writer of `fxFrame` and the scene's cardiac clock. Runs at useFrame priority −1, before
 * every other subscriber, so the anatomy and the fx renderers all read this frame's values:
 *
 * - advances `cardiacClock` at the patient's PR and phase-locks it to the heart's beat scale;
 * - damps each vessel's probability (λ 6, like the vessel colours) and derives the risk-coded flow
 *   parameters; integrates each target's flow distance from the diastole-dominant waveform (exact for
 *   any frame rate);
 * - places the per-beat pulse wavefront and runs the ignition sweep when a new case's estimate lands;
 * - keeps an on-demand canvas rendering while flow, pulse or ignition are visible.
 */
export function FxDriver() {
  const reduced = useReducedMotion();
  const schema = useSchemaIndex();
  const scene = useThree((s) => s.scene);
  const getThree = useThree((s) => s.get);
  const heart = useRef<Object3D | null>(null);
  const lookupCountdown = useRef(0);
  const loadingSince = useRef<number | null>(null);
  const trigger = useMemo(() => new IgnitionTrigger(), []);
  const igniteStart = useRef<number | null>(null);

  useEffect(() => {
    fxFrame.targets = targetSlots(schema?.vessels.map((t) => t.id));
  }, [schema]);

  // A remounted scene (route back to the canvas after a context loss) ignites again.
  useEffect(() => {
    trigger.reset();
    igniteStart.current = null;
  }, [trigger]);

  // Development handle for tuning in the browser console (stripped from production builds).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__cardiotwinFx = { fxFrame, cardiacClock, replayIgnition, three: getThree };
    return () => {
      delete w.__cardiotwinFx;
    };
  }, [getThree]);

  /**
   * Monotonic fx time (s). NOT state.clock.elapsedTime: R3F resets that clock to 0 whenever the frame
   * loop mode changes (always ↔ demand ↔ never, e.g. Beat toggled or the tab hidden), which would freeze
   * any envelope timed against it.
   */
  const time = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    time.current += dt;
    const now = time.current;
    const viewer = useViewerStore.getState();
    const patient = usePatientStore.getState();
    const f = fxFrame;
    f.time = now;

    // --- clock (+ phase lock to the anatomy's own beat while it keeps a private phase)
    cardiacClock.setRate(patient.features.PR);
    const beats0 = cardiacClock.beats;
    // Keyed by the R3F frame clock: the anatomy's heartbeat hook ticks the same clock in the same frame
    // and the second call is a no-op (the key only has to be equal within one frame).
    cardiacClock.tick(delta, state.clock.elapsedTime);
    const beats1 = cardiacClock.beats;
    if (!heart.current || !isAttached(heart.current, scene)) {
      heart.current = null;
      if (lookupCountdown.current-- <= 0) {
        heart.current = scene.getObjectByName('Layer_Heart') ?? null;
        lookupCountdown.current = 30;
      }
    }
    if (heart.current && viewer.anatomySource === 'glb') cardiacClock.observeHeartScale(heart.current.scale.x);
    const pulsatile = viewer.heartbeat && !reduced;
    f.pulsatile = pulsatile;

    // --- per-target risk → flow parameters
    const prediction = patient.prediction;
    if (patient.status === 'loading') loadingSince.current ??= now;
    else loadingSince.current = null;
    const stale = loadingSince.current !== null && now - loadingSince.current > STALE_AFTER_S;
    const period = cardiacClock.period;
    let animating = false;
    for (let slot = 0; slot < MAX_TARGET_SLOTS; slot += 1) {
      const target = f.targets[slot] ?? '';
      const goal = target ? prediction?.predictions[target]?.probability : undefined;
      const has = typeof goal === 'number' && patient.status !== 'error';
      if (has) f.p[slot] = reduced ? goal : MathUtils.damp(f.p[slot]!, goal, LAMBDA_P, dt);
      const availableGoal = has && !stale ? 1 : 0;
      f.available[slot] = reduced ? availableGoal : MathUtils.damp(f.available[slot]!, availableGoal, LAMBDA_FAST, dt);
      const selected = viewer.selectedStructure;
      const dimGoal = selected && target && selected !== target ? 1 : selected && !target ? 1 : 0;
      f.dim[slot] = MathUtils.damp(f.dim[slot]!, dimGoal, LAMBDA_FAST, dt);
      f.hover[slot] = MathUtils.damp(f.hover[slot]!, viewer.hoveredStructure === target && target ? 1 : 0, LAMBDA_FAST * 1.5, dt);

      const params = riskFlowParams(f.p[slot]!, f.available[slot]!);
      f.density[slot] = params.density;
      f.tintMix[slot] = params.tintMix;
      const k = phasicityOf(target || null);
      const mean = BASE_FLOW_SPEED * params.speed;
      const advance = pulsatile ? period * flowAdvance(beats0, beats1, k) : dt;
      f.flowDistance[slot] = (f.flowDistance[slot]! + mean * advance) % FLOW_DISTANCE_WRAP;
      f.flowSpeed[slot] = mean * (pulsatile ? coronaryFlowSpeed(cardiacClock.phase, k) : 1);
    }

    // --- ignition: when a prediction lands for a new case (or no estimate arrives in time)
    const anatomyReady = viewer.anatomySource === 'glb' || viewer.anatomySource === 'procedural' || viewer.anatomySource === 'error';
    const caseKey = patient.mode === 'custom' ? 'custom' : patient.selectedPatientId ? `cohort:${patient.selectedPatientId}` : null;
    const landed = trigger.update(now, anatomyReady, caseKey, !!prediction && patient.status === 'ready');
    const requested = takeIgnitionRequest();
    if (landed || (requested && anatomyReady)) igniteStart.current = now;
    if (reduced) {
      f.ignite = IGNITE_DONE;
      f.igniteAmp = 0;
    } else if (igniteStart.current === null) {
      f.ignite = 0; // flow waits for the first sweep
      f.igniteAmp = 0;
    } else {
      const env = ignitionAt(now - igniteStart.current);
      f.ignite = env.front;
      f.igniteAmp = env.amp;
      animating ||= env.active;
    }

    // --- global flow visibility
    const flowGoal = viewer.bloodFlow && !reduced && viewer.tier !== 'D' ? 1 : 0;
    f.flowOpacity = reduced ? flowGoal : MathUtils.damp(f.flowOpacity, flowGoal, LAMBDA_FLOW, dt);
    if (Math.abs(f.flowOpacity - flowGoal) < 1e-3) f.flowOpacity = flowGoal;

    // --- per-beat pulse wave: part of the flow picture (follows the Flow toggle), only once the tree is lit
    const front = pulsatile && f.ignite >= IGNITE_DONE ? pulseFront(cardiacClock.phase) : null;
    f.pulseFront = front ?? -1;
    f.pulseAmp =
      front === null ? 0 : (1 - MathUtils.smoothstep(front, PULSE_OVERSHOOT * 0.8, PULSE_OVERSHOOT)) * f.flowOpacity;

    // On-demand canvases (Beat off) still need frames while anything moves.
    if (f.flowOpacity > 0 || animating || f.pulseAmp > 0) state.invalidate();
  }, -1);

  return null;
}
