/** Which geometry may bloom (pure helpers of FXComposer; tested in bloomSelection.test.ts). */
import { Mesh, type Object3D } from 'three';

/** Render layer that marks bloom-eligible geometry (coronary meshes) for the selective bloom depth mask. */
export const BLOOM_LAYER = 11;
/**
 * Depth tolerance of the mask (orthographic depth over near 0.1 – far 50 ≈ 7.5 mm): the anatomy inflates
 * vessels and applies non-affine beat terms in its vertex shaders, which the depth-only selection pass
 * does not replay.
 */
export const MASK_EPSILON = 0.00015;
/** Rescan the scene for coronary meshes this often (frames). */
export const SCAN_EVERY = 60;

/** Meshes of the coronary tree (any mesh under a `Coronary_*` node), excluding the fx layer's own twins. */
export function coronaryMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.ctFx) return;
    for (let p: Object3D | null = o; p; p = p.parent) {
      if (p.name.startsWith('Coronary_')) {
        out.push(o);
        return;
      }
    }
  });
  return out;
}
