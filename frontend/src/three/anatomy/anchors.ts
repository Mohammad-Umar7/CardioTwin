/**
 * Label anchors published by whichever anatomy is on screen (GLB or procedural) and consumed by the
 * label projector. Positions and normals are in WORLD space at rest (not affected by the heartbeat), so
 * labels never jitter with the beat (DESIGN_SYSTEM §6 "Labels are anchored in a group that does not beat").
 */
import { Vector3 } from 'three';
import type { TargetId } from '@/types/contracts';

export interface LabelAnchor {
  target: TargetId;
  position: Vector3;
  /** Outward surface normal at the anchor; dot(normal, viewDir) < 0 → label is on the far side. */
  normal: Vector3;
}

const anchors = new Map<string, LabelAnchor>();
let version = 0;

export function setAnchors(list: LabelAnchor[]): void {
  anchors.clear();
  for (const a of list) anchors.set(a.target, a);
  version += 1;
}

export function clearAnchors(): void {
  anchors.clear();
  version += 1;
}

export const getAnchors = (): ReadonlyMap<string, LabelAnchor> => anchors;
export const anchorsVersion = (): number => version;

export const toVector = (v: readonly number[] | undefined | null): Vector3 | null =>
  v && v.length >= 3 ? new Vector3(v[0], v[1], v[2]) : null;
