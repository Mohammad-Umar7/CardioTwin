import { Group, Object3D, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { NodeTracker, isAttached, isEffectivelyVisible, restInverses } from './sceneNodes';

/** A pristine rest pose and a live clone, as drei's useGLTF cache + the anatomy's clone provide them. */
function rig() {
  const build = () => {
    const root = new Group();
    const layer = new Group();
    layer.name = 'Layer_Coronary';
    const lad = new Object3D();
    lad.name = 'Coronary_LAD';
    lad.position.set(0.3, -0.1, 0.25); // GLB nodes are centred on themselves
    layer.add(lad);
    root.add(layer);
    return { root, layer, lad };
  };
  const pristine = build();
  const live = build();
  const scene = new Scene();
  scene.add(live.root);
  return { pristine, live, scene };
}

const apply = (tracker: NodeTracker, i: number, p: Vector3) => p.clone().applyMatrix4(tracker.matrices[i]!);

describe('NodeTracker (particles follow the anatomy without touching it)', () => {
  it('is the identity at rest: rest-frame centreline points land where the mesh is', () => {
    const { pristine, scene } = rig();
    const tracker = new NodeTracker(['Coronary_LAD'], restInverses(pristine.root, ['Coronary_LAD']));
    scene.updateMatrixWorld(true);
    expect(tracker.update(scene)).toBe(true);
    const p = new Vector3(0.31, -0.2, 0.3);
    expect(apply(tracker, 0, p).distanceTo(p)).toBeLessThan(1e-9);
    expect(tracker.visibility[0]).toBe(1);
  });

  it('follows explode offsets, riders and the heartbeat scale applied anywhere up the chain', () => {
    const { pristine, live, scene } = rig();
    const tracker = new NodeTracker(['Coronary_LAD'], restInverses(pristine.root, ['Coronary_LAD']));
    live.lad.position.add(new Vector3(-0.8, 0.18, 0.69)); // structure explode
    live.layer.scale.setScalar(0.97); // heartbeat on the layer
    scene.updateMatrixWorld(true);
    tracker.update(scene);
    const p = new Vector3(0.3, -0.1, 0.25); // the node origin in the rest frame
    const expected = new Vector3(0.3 - 0.8, -0.1 + 0.18, 0.25 + 0.69).multiplyScalar(0.97);
    expect(apply(tracker, 0, p).distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('fades with the node: hidden anywhere up the chain, or dissolved by the anatomy', () => {
    const { pristine, live, scene } = rig();
    let solid = 0.4;
    const tracker = new NodeTracker(['Coronary_LAD'], restInverses(pristine.root, ['Coronary_LAD']), 30, () => solid);
    scene.updateMatrixWorld(true);
    tracker.update(scene);
    expect(tracker.visibility[0]).toBeCloseTo(0.4, 6); // Float32Array storage
    live.layer.visible = false;
    tracker.update(scene);
    expect(tracker.visibility[0]).toBe(0);
    live.layer.visible = true;
    solid = 1;
    tracker.update(scene);
    expect(tracker.visibility[0]).toBe(1);
  });

  it('re-finds a node that was remounted and reports missing ones', () => {
    const { pristine, live, scene } = rig();
    const tracker = new NodeTracker(['Coronary_LAD', 'Coronary_XYZ'], restInverses(pristine.root, ['Coronary_LAD', 'Coronary_XYZ']), 1);
    scene.updateMatrixWorld(true);
    expect(tracker.update(scene)).toBe(false); // XYZ does not exist
    expect(tracker.visibility[1]).toBe(0);
    scene.remove(live.root);
    const fresh = rig().live.root;
    scene.add(fresh);
    scene.updateMatrixWorld(true);
    tracker.update(scene);
    expect(tracker.visibility[0]).toBe(1);
  });
});

describe('graph helpers', () => {
  it('knows attachment and effective visibility', () => {
    const scene = new Scene();
    const a = new Group();
    const b = new Object3D();
    a.add(b);
    expect(isAttached(b, scene)).toBe(false);
    scene.add(a);
    expect(isAttached(b, scene)).toBe(true);
    expect(isEffectivelyVisible(b)).toBe(true);
    a.visible = false;
    expect(isEffectivelyVisible(b)).toBe(false);
  });
});
