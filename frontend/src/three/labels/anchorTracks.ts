/**
 * Per-vessel anchor tracks for the dynamic label anchors (WORKSTATION_V2 §5.14): the vessel's GLB node,
 * its rest-frame origin (manifest `structures[].center`, which is the node's translation) and the
 * candidate points along its main trunk. Built once per manifest / centreline load; pure and tested.
 */
import { Matrix4, Vector3, type Object3D } from 'three';
import type { AnatomyManifest, VesselsFile } from '@/types/contracts';
import { AnchorChooser, buildCandidates, mainTrunk, type AnchorCandidate, type HeartAxisFrame } from './dynamicAnchor';

export interface AnchorTrack {
  target: string;
  /** GLB node the trunk belongs to (e.g. "Coronary_LAD"). */
  node: string;
  /** The node's rest translation in the anatomy frame, or null when the manifest does not say. */
  centre: Vector3 | null;
  candidates: AnchorCandidate[];
  chooser: AnchorChooser;
}

const vec = (v: unknown): Vector3 | null =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))
    ? new Vector3(v[0] as number, v[1] as number, v[2] as number)
    : null;

/** Heart long axis from the manifest (`heart.base_center`, `heart.long_axis`); a sane default otherwise. */
export function heartAxisFrame(manifest: AnatomyManifest | null | undefined): HeartAxisFrame {
  const heart = (manifest as { heart?: { base_center?: unknown; long_axis?: unknown } } | null | undefined)?.heart;
  const centre = vec(heart?.base_center) ?? new Vector3(0, 0, 0);
  const axis = vec(heart?.long_axis) ?? new Vector3(-0.77, 0.4, -0.5);
  return { centre, axis: axis.lengthSq() > 1e-10 ? axis.normalize() : new Vector3(0, 1, 0) };
}

export function buildTracks(
  manifest: AnatomyManifest | null | undefined,
  vessels: VesselsFile | null | undefined,
  targets: readonly string[],
  window?: readonly [number, number],
  count?: number,
): AnchorTrack[] {
  if (!vessels?.vessels?.length) return [];
  const frame = heartAxisFrame(manifest);
  const tracks: AnchorTrack[] = [];
  for (const target of targets) {
    const structure =
      manifest?.structures.find((s) => s.target === target && s.labelAnchor) ??
      manifest?.structures.find((s) => s.target === target && /^Coronary_/.test(s.node));
    const vessel =
      vessels.vessels.find((v) => v.id === target) ??
      vessels.vessels.find((v) => v.target === target && (!structure || v.node === structure.node));
    if (!vessel) continue;
    const candidates = buildCandidates(mainTrunk(vessel.segments as never), frame, window, count);
    if (candidates.length === 0) continue;
    const node = vessel.node;
    const centreStructure = manifest?.structures.find((s) => s.node === node);
    tracks.push({ target, node, centre: vec(centreStructure?.center), candidates, chooser: new AnchorChooser() });
  }
  return tracks;
}

const tmpInv = new Matrix4();
const tmpT = new Matrix4();

/**
 * The node's current "explode · assembly" transform (E·A), from the anatomy rig's matrix composition
 * `matrix = E · A · T(centre)` (three/anatomy/rig.ts): labels follow the peel and the assembly but never the
 * beat (DESIGN_SYSTEM §6), which runs in the vertex shaders and is not in the matrix. `beat`, when given, is a
 * matrix factored out of a node matrix of the older `E · A · B · T` form.
 */
export function restToDisplayed(mesh: Object3D, centre: Vector3, beat: Matrix4 | null, out = new Matrix4()): Matrix4 {
  out.copy(mesh.matrix).multiply(tmpT.makeTranslation(-centre.x, -centre.y, -centre.z));
  if (beat) {
    tmpInv.copy(beat).invert();
    out.multiply(tmpInv);
  }
  if (mesh.parent) out.premultiply(mesh.parent.matrixWorld);
  return out;
}
