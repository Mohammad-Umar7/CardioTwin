/**
 * Camera history (WORKSTATION_V2 §9.3 D, P2): Back / Forward through the poses the camera settled at,
 * like a browser. Pure and unit-tested; the camera rig pushes a pose each time the camera comes to rest
 * after a command or a free orbit, and never while it is replaying the history itself.
 */

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Two poses closer than this (scene units, position and target) are the same history entry. */
export const POSE_EPSILON = 0.02;
export const HISTORY_LIMIT = 24;

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

export function samePose(a: Pose, b: Pose, eps = POSE_EPSILON): boolean {
  return dist(a.position, b.position) < eps && dist(a.target, b.target) < eps;
}

export class CameraHistory {
  private entries: Pose[] = [];
  private index = -1;

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /** Records a settled pose. Drops the forward branch (a new move after Back); ignores repeats. */
  push(pose: Pose): boolean {
    const current = this.entries[this.index];
    if (current && samePose(current, pose)) return false;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(clonePose(pose));
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  get canBack(): boolean {
    return this.index > 0;
  }

  get canForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  back(): Pose | null {
    if (!this.canBack) return null;
    this.index -= 1;
    return clonePose(this.entries[this.index]!);
  }

  forward(): Pose | null {
    if (!this.canForward) return null;
    this.index += 1;
    return clonePose(this.entries[this.index]!);
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
  }
}

export const clonePose = (p: Pose): Pose => ({ position: [...p.position], target: [...p.target] });
