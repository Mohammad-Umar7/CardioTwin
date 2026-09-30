import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Mesh, PMREMGenerator, type MeshBasicMaterial, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useViewerStore } from '@/state/viewerStore';
import { lookOf, type SceneLook } from './sceneControls';
import { RIGS, buildStudioScene } from './studio';

/**
 * Lighting rig (DESIGN_SYSTEM §7.2), no shadow maps. Key, rim and fill are children of the camera so the
 * lit side always faces the viewer and colours stay true to the legend at any orbit angle; the
 * hemisphere light stays in world space.
 */
export function Lights() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const look = lookOf(useViewerStore((s) => s.look));
  const rig = RIGS[look];

  // The camera must be part of the scene graph for its children (the lights) to render.
  useEffect(() => {
    if (!camera.parent) scene.add(camera);
    return () => {
      if (camera.parent === scene) scene.remove(camera);
    };
  }, [camera, scene]);

  return (
    <>
      <hemisphereLight args={[rig.hemisphere.sky, rig.hemisphere.ground, rig.hemisphere.intensity]} />
      {createPortal(
        <>
          <directionalLight color={rig.key.color} intensity={rig.key.intensity} position={[...rig.key.position]} />
          <directionalLight color={rig.rim.color} intensity={rig.rim.intensity} position={[...rig.rim.position]} />
          <directionalLight color={rig.fill.color} intensity={rig.fill.intensity} position={[...rig.fill.position]} />
        </>,
        camera,
      )}
    </>
  );
}

function pmremFrom(gl: WebGLRenderer, look: SceneLook): Texture {
  const pmrem = new PMREMGenerator(gl);
  const source = look === 'realistic' ? buildStudioScene() : new RoomEnvironment();
  const tex = pmrem.fromScene(source, 0.04).texture;
  pmrem.dispose();
  source.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return tex;
}

/**
 * Image-based ambient: generated once per look in code (RoomEnvironment for Clinical, the studio above for
 * Realistic) → PMREM. Materials opt in with `envMapIntensity`.
 */
export function SceneEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const look = lookOf(useViewerStore((s) => s.look));
  const cache = useMemo(() => new Map<SceneLook, Texture>(), []);

  useEffect(() => {
    let tex = cache.get(look);
    if (!tex) {
      tex = pmremFrom(gl, look);
      cache.set(look, tex);
    }
    scene.environment = tex;
    invalidate();
  }, [cache, gl, look, scene, invalidate]);

  useEffect(
    () => () => {
      scene.environment = null;
      cache.forEach((t) => t.dispose());
      cache.clear();
    },
    [cache, scene],
  );

  return null;
}
