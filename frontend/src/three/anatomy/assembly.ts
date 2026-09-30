/**
 * Cold-load ASSEMBLY choreography (pure; unit tested in assembly.test.ts).
 *
 * On the first load of a session the anatomy does not simply appear: each layer flies in from its explode
 * direction and materialises, outside-in — skin → muscle → ribs → lungs → great vessels → the heart halves
 * close — and the coronary tree ignites once the heart has closed (the ignition sweep itself belongs to the
 * fx layer; `ASSEMBLY_IGNITE_AT` tells it when). ≈ 2.2 s in total, skippable by any input (it then
 * finishes within `SKIP_FINISH_S`), and replaced by the rest state under reduced motion.
 *
 * Motion is a critically damped response (a spring without bounce, LUMEN §6: no overshoot): the offset
 * starts at 1 (fully out), decays monotonically to 0 and lands with zero velocity.
 */

export type AssemblyStageId = 'skin' | 'muscle' | 'skeleton' | 'lungs' | 'diaphragm' | 'greatVessels' | 'heartPosterior' | 'heartAnterior' | 'coronary';

export interface AssemblyStage {
  id: AssemblyStageId;
  /** Start time (s) after the anatomy is ready. */
  start: number;
  /** Flight duration (s). */
  duration: number;
  /** How far out the layer starts, as a multiple of its fly-in vector. */
  distance: number;
}

/** The choreography, in the order the owner asked for. */
export const ASSEMBLY_STAGES: readonly AssemblyStage[] = [
  // Outer layers overlap tightly: in the workstation they settle as faint ghosts at the frame's edges, so
  // the heart itself starts assembling after 0.4 s instead of waiting for them.
  { id: 'skin', start: 0, duration: 0.8, distance: 1.25 },
  { id: 'muscle', start: 0.08, duration: 0.8, distance: 1.25 },
  { id: 'skeleton', start: 0.16, duration: 0.85, distance: 1.3 },
  { id: 'lungs', start: 0.26, duration: 0.85, distance: 1.4 },
  { id: 'diaphragm', start: 0.3, duration: 0.8, distance: 1.3 },
  { id: 'greatVessels', start: 0.38, duration: 0.9, distance: 1 },
  { id: 'heartPosterior', start: 0.55, duration: 1.0, distance: 1 },
  // The anterior half swings shut last and carries the coronaries that ride on it.
  { id: 'heartAnterior', start: 0.95, duration: 1.2, distance: 1 },
  { id: 'coronary', start: 0.95, duration: 1.2, distance: 1 },
];

export const ASSEMBLY_DURATION = Math.max(...ASSEMBLY_STAGES.map((s) => s.start + s.duration));
/** When the fx layer should start the coronary ignition (the heart has just closed). */
export const ASSEMBLY_IGNITE_AT = 1.95;
/** After a skip, the remaining motion is compressed into this many seconds. */
export const SKIP_FINISH_S = 0.15;

/** Layer id (manifest) → stage. Heart-layer nodes are split by the caller (anterior / posterior / roots). */
export const STAGE_OF_LAYER: Readonly<Record<string, AssemblyStageId>> = {
  skin: 'skin',
  muscle: 'muscle',
  skeleton: 'skeleton',
  lungs: 'lungs',
  diaphragm: 'diaphragm',
  coronary: 'coronary',
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Critically damped decay normalised to land exactly at 0 when u = 1:
 * f(u) = (1 + ωu)·e^(−ωu), rescaled so f(0) = 1, f(1) = 0. Monotone non-increasing, zero slope at both ends.
 */
const OMEGA = 5.5;
const F1 = (1 + OMEGA) * Math.exp(-OMEGA);
export function settle(u: number): number {
  const x = clamp01(u);
  const f = (1 + OMEGA * x) * Math.exp(-OMEGA * x);
  return (f - F1) / (1 - F1);
}

export interface StagePose {
  /** Multiple of the fly-in vector still to travel (0 = at rest). */
  offset: number;
  /** Materialisation 0..1 (dithered dissolve for opaque tissue, alpha for ghosts). */
  reveal: number;
}

const DONE: StagePose = { offset: 0, reveal: 1 };

/** Pose of a stage `t` seconds into the assembly. */
export function stagePose(stage: AssemblyStage, t: number): StagePose {
  const u = (t - stage.start) / stage.duration;
  if (u >= 1 - 1e-9) return DONE;
  if (u <= 0) return { offset: stage.distance, reveal: 0 };
  return { offset: stage.distance * settle(u), reveal: clamp01(u / 0.45) };
}

export function stageById(id: AssemblyStageId): AssemblyStage {
  return ASSEMBLY_STAGES.find((s) => s.id === id)!;
}

/**
 * Assembly clock: advances with frame time; `skip()` compresses what is left into SKIP_FINISH_S. Reduced
 * motion or a second visit starts it finished.
 */
export class AssemblyClock {
  t = 0;
  private rate = 1;
  constructor(done = false) {
    if (done) this.t = ASSEMBLY_DURATION;
  }

  get done(): boolean {
    return this.t >= ASSEMBLY_DURATION;
  }

  get progress(): number {
    return clamp01(this.t / ASSEMBLY_DURATION);
  }

  tick(dt: number): void {
    if (this.done) return;
    this.t = Math.min(ASSEMBLY_DURATION, this.t + Math.max(0, Math.min(dt, 0.1)) * this.rate);
  }

  skip(): void {
    if (this.done) return;
    this.rate = Math.max(this.rate, (ASSEMBLY_DURATION - this.t) / SKIP_FINISH_S);
  }

  finish(): void {
    this.t = ASSEMBLY_DURATION;
  }

  restart(): void {
    this.t = 0;
    this.rate = 1;
  }
}
