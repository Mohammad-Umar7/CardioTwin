/**
 * Per-frame state shared by the fx renderers (particles, vessel overlay, atmosphere). Written ONLY by
 * <FxDriver> (useFrame priority −1), read by the renderers in their own useFrame / onBeforeRender — no
 * React state per frame. The pure helpers below are unit tested in fxState.test.ts.
 */
import { ANATOMY } from '@/theme/tokens';
import { NODE_SLOTS } from './centreline';

/** Uniform slots per target; slot 0 = "not predicted" (left main), slots 1… = schema vessel targets. */
export const MAX_TARGET_SLOTS = 8;
/** Coronary vessel nodes addressable by the particle shader (the GLB has 9). */
export const MAX_NODES = NODE_SLOTS;

/** Mean flow speed of the illustration (scene units per second; 1 unit = 10 cm). */
export const BASE_FLOW_SPEED = 0.3;
/** The integrated flow distance restarts here (one invisible reshuffle every ≈ 4 h at the mean speed). */
export const FLOW_DISTANCE_WRAP = 4096;

/**
 * Risk coding of the flow (explicit product decision, documented in fx/README.md): higher predicted
 * stenosis probability → sparser, slower, warmer particles. 0 disables it (DESIGN_SYSTEM §7.4 original
 * wording: identical, white flow everywhere); 1 = the full effect below. It is deliberately gentle —
 * risk is read from the vessel colour, labels and panels; the flow only echoes it and is captioned
 * "illustrative flow — not a haemodynamic simulation".
 */
export const FLOW_RISK_CODING = 1;
/** At p = 1: keep this share of the particles… */
export const MIN_DENSITY = 0.5;
/** …moving at this share of the speed… */
export const MIN_SPEED = 0.55;
/** …tinted this far from the neutral flow colour toward the ramp colour (always ≥ the floor). */
export const TINT_FLOOR = 0.25;
export const TINT_GAIN = 0.35;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const hexToLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
};

/** `flow/particle` #F2F5F8 in linear RGB. */
export const FLOW_WHITE = hexToLinear(ANATOMY.flowParticle);
/** `vessel/trace` #E3DCCF (Ignition) in linear RGB. */
export const TRACE = hexToLinear(ANATOMY.vesselTrace);

export interface FlowParams {
  /** Share of particles kept visible, (0, 1]. */
  density: number;
  /** Speed multiplier, (0, 1]. */
  speed: number;
  /**
   * How far the particle colour moves from the neutral flow white toward the Ember ramp colour at p
   * (sampled in the shader from the shared risk LUT, so it is always ON the legend's hue).
   */
  tintMix: number;
}

/**
 * Flow parameters for a vessel at (damped) probability p. `available` ∈ [0, 1] fades to the neutral,
 * un-coded flow while no estimate is shown (pending, error, or the not-predicted left main), so the
 * particles never suggest a risk the model has not produced.
 */
export function riskFlowParams(p: number, available = 1, coding = FLOW_RISK_CODING): FlowParams {
  const k = smoothstep(0.2, 0.95, clamp01(p)) * clamp01(available) * clamp01(coding);
  return {
    density: 1 - (1 - MIN_DENSITY) * k,
    speed: 1 - (1 - MIN_SPEED) * k,
    tintMix: (TINT_FLOOR + TINT_GAIN * clamp01(p)) * clamp01(available) * clamp01(coding),
  };
}

/** Right-coronary flow is far less phasic than left (thin RV wall): see cardiacCycle.ts. */
export const phasicityOf = (target: string | null): number => (target === 'RCA' ? 0.6 : 1);

// ------------------------------------------------------------------------------------ ignition

/** Duration of the ostia → tips sweep and of the settle that follows (seconds). */
export const IGNITE_SWEEP_S = 1.1;
export const IGNITE_SETTLE_S = 0.6;
/** The front runs past 1 so the band fully leaves the distal tips. */
export const IGNITE_END = 1.25;
/** "Settled" front value: everything is lit, particles fully gated in. */
export const IGNITE_DONE = 2;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Ignition envelope at `t` seconds after the trigger: `front` in normalised arc length (0 = ostia) and
 * the sweep's brightness `amp`, which holds during the sweep and settles to 0 afterwards.
 */
export function ignitionAt(t: number): { front: number; amp: number; active: boolean } {
  if (t < 0) return { front: 0, amp: 0, active: true };
  if (t < IGNITE_SWEEP_S) return { front: IGNITE_END * easeOutCubic(t / IGNITE_SWEEP_S), amp: 1, active: true };
  const settle = (t - IGNITE_SWEEP_S) / IGNITE_SETTLE_S;
  if (settle < 1) return { front: IGNITE_DONE, amp: 1 - easeOutCubic(settle), active: true };
  return { front: IGNITE_DONE, amp: 0, active: false };
}

/**
 * Decides WHEN the ignition plays: when a prediction lands for a case (cohort patient or custom
 * session) different from the last one that ignited — not on every what-if edit, which has its own
 * ripple. If no estimate arrives within `fallbackS` of the anatomy being ready (server down, edge
 * engine unavailable), it ignites anyway so the flow is not held back by the model.
 */
export class IgnitionTrigger {
  private lastCase: string | null = null;
  private readySince: number | null = null;
  private fired = false;

  constructor(private readonly fallbackS = 1.5) {}

  /** Returns true when the ignition should start now. */
  update(now: number, anatomyReady: boolean, caseKey: string | null, hasPrediction: boolean): boolean {
    if (!anatomyReady) {
      this.readySince = null;
      return false;
    }
    this.readySince ??= now;
    if (hasPrediction && caseKey !== null && caseKey !== this.lastCase) {
      this.lastCase = caseKey;
      this.fired = true;
      return true;
    }
    if (!this.fired && now - this.readySince >= this.fallbackS) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** Forget the history (a remounted scene should ignite again). */
  reset(): void {
    this.lastCase = null;
    this.readySince = null;
    this.fired = false;
  }
}

// ------------------------------------------------------------------------------------ frame state

/** Default vessel targets while the schema loads (CONTRACTS target order). */
export const DEFAULT_VESSEL_TARGETS = ['LAD', 'LCX', 'RCA'] as const;

/** Slot table for the schema's vessel targets: slot 0 = not predicted, then schema order. */
export function targetSlots(vesselIds: readonly string[] = DEFAULT_VESSEL_TARGETS): string[] {
  const slots = ['', ...vesselIds].slice(0, MAX_TARGET_SLOTS);
  while (slots.length < MAX_TARGET_SLOTS) slots.push('');
  return slots;
}


export interface FxFrameState {
  /** Slot → target id ('' for slot 0). */
  targets: string[];
  /** Damped probability per slot. */
  p: Float32Array;
  /** 1 when an estimate is shown for the slot's target (damped). */
  available: Float32Array;
  /** Selection dimming 0..1 and hover lift 0..1 per slot. */
  dim: Float32Array;
  hover: Float32Array;
  /**
   * Integrated flow distance per slot (scene units; Float64 on the CPU, wrapped at FLOW_DISTANCE_WRAP so
   * the float32 shader copy keeps sub-0.01 mm precision) and the instantaneous speed (units/s).
   */
  flowDistance: Float64Array;
  flowSpeed: Float32Array;
  density: Float32Array;
  /** Mix toward the ramp colour per slot (see FlowParams.tintMix). */
  tintMix: Float32Array;
  /** Pulse wavefront (normalised arc length) or −1 when none is in flight; and its brightness. */
  pulseFront: number;
  pulseAmp: number;
  /** Ignition front (normalised arc length; ≥ IGNITE_DONE when settled) and sweep brightness. */
  ignite: number;
  igniteAmp: number;
  /** Global flow visibility (Flow toggle, reduced motion, tier), damped 0..1. */
  flowOpacity: number;
  /** Heart beating (Beat on, no reduced motion)? Else flow is steady and no pulse runs. */
  pulsatile: boolean;
  /** Seconds since the driver started (shader time). */
  time: number;
}

export function createFxFrameState(): FxFrameState {
  const n = MAX_TARGET_SLOTS;
  return {
    targets: targetSlots(),
    p: new Float32Array(n),
    available: new Float32Array(n),
    dim: new Float32Array(n),
    hover: new Float32Array(n),
    flowDistance: new Float64Array(n),
    flowSpeed: new Float32Array(n),
    density: new Float32Array(n).fill(1),
    tintMix: new Float32Array(n),
    pulseFront: -1,
    pulseAmp: 0,
    ignite: 0,
    igniteAmp: 0,
    flowOpacity: 0,
    pulsatile: false,
    time: 0,
  };
}

/** The scene's fx state (one canvas per page). */
export const fxFrame: FxFrameState = createFxFrameState();

let ignitionRequested = false;
/** Replay the ignition sweep on the next frame (tour steps, demos). No-op under reduced motion. */
export function replayIgnition(): void {
  ignitionRequested = true;
}
/** Driver side: consume a pending replay request. */
export function takeIgnitionRequest(): boolean {
  const requested = ignitionRequested;
  ignitionRequested = false;
  return requested;
}

/** Slot of a target id in `fxFrame.targets` (0 when unknown / not predicted). */
export function slotOf(targets: readonly string[], target: string | null | undefined): number {
  if (!target) return 0;
  const i = targets.indexOf(target);
  return i > 0 ? i : 0;
}
