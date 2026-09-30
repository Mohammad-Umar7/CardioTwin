/**
 * Following the anatomy's live transforms WITHOUT owning or mutating the anatomy.
 *
 * vessels.json points are in the rest frame of the GLB. Whatever the 3D layer does to a coronary node —
 * layer explode, the structure offset of the wall it `rides`, a hinge, the heartbeat scale on
 * Layer_Coronary, a wrapper group — ends up in that node's matrixWorld. So the displayed position of a
 * rest-frame point p is
 *
 *     p_now = node.matrixWorld · (restWorld)⁻¹ · p
 *
 * with restWorld taken from the pristine glTF scene cached by drei's useGLTF (the 3D layer renders a
 * clone and never touches the original). One mat4 per node, uploaded as a uniform array.
 */
import { Matrix4, type Object3D } from 'three';

/** True when `object` and all its ancestors are visible (what the renderer would draw). */
export function isEffectivelyVisible(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** True when `object` is still part of `root`'s graph. */
export function isAttached(object: Object3D, root: Object3D): boolean {
  let o: Object3D | null = object;
  while (o.parent) o = o.parent;
  return o === root;
}

/** Inverse rest world matrix of every named node of a pristine scene (missing names → identity). */
export function restInverses(pristine: Object3D, names: readonly string[]): Matrix4[] {
  pristine.updateMatrixWorld(true);
  return names.map((name) => {
    const node = pristine.getObjectByName(name);
    return node ? node.matrixWorld.clone().invert() : new Matrix4();
  });
}

/**
 * Tracks the live copies of named nodes in the rendered scene and produces `live · rest⁻¹` per node.
 * Lookups are cached; a node that left the graph (remount, hot reload) is looked up again, at most
 * every `retryFrames` frames while missing.
 */
export class NodeTracker {
  readonly matrices: Matrix4[];
  /** 1 while the node renders, else 0 (its particles fade out with it). */
  readonly visibility: Float32Array;
  private readonly live: (Object3D | null)[];
  private missingFor = 0;

  constructor(
    readonly names: readonly string[],
    private readonly rest: readonly Matrix4[],
    private readonly retryFrames = 30,
  ) {
    this.matrices = names.map(() => new Matrix4());
    this.visibility = new Float32Array(names.length);
    this.live = names.map(() => null);
  }

  /** Refresh from the scene. Call inside onBeforeRender, when matrixWorld is current for this frame. */
  update(scene: Object3D): boolean {
    let missing = false;
    for (let i = 0; i < this.names.length; i += 1) {
      let node: Object3D | null = this.live[i] ?? null;
      if (!node || !isAttached(node, scene)) {
        node = this.missingFor % this.retryFrames === 0 ? (scene.getObjectByName(this.names[i]!) ?? null) : null;
        this.live[i] = node;
      }
      if (!node) {
        missing = true;
        this.visibility[i] = 0;
        continue;
      }
      this.matrices[i]!.multiplyMatrices(node.matrixWorld, this.rest[i]!);
      this.visibility[i] = isEffectivelyVisible(node) ? 1 : 0;
    }
    this.missingFor = missing ? this.missingFor + 1 : 0;
    return !missing;
  }
}
