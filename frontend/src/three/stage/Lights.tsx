import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { PMREMGenerator, type Texture } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LIGHTS } from '@/theme/tokens';

/**
 * Lighting rig (DESIGN_SYSTEM §7.2), no shadow maps. Key, rim and fill are children of the camera so the
 * lit side always faces the viewer and colours stay true to the legend at any orbit angle; the
 * hemisphere light stays in world space.
 */
export function Lights() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  // The camera must be part of the scene graph for its children (the lights) to render.
  useEffect(() => {
    if (!camera.parent) scene.add(camera);
    return () => {
      if (camera.parent === scene) scene.remove(camera);
    };
  }, [camera, scene]);

  return (
    <>
      <hemisphereLight args={[LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity]} />
      {createPortal(
        <>
          <directionalLight color={LIGHTS.key.color} intensity={LIGHTS.key.intensity} position={[...LIGHTS.key.position]} />
          <directionalLight color={LIGHTS.rim.color} intensity={LIGHTS.rim.intensity} position={[...LIGHTS.rim.position]} />
          <directionalLight color={LIGHTS.fill.color} intensity={LIGHTS.fill.intensity} position={[...LIGHTS.fill.position]} />
        </>,
        camera,
      )}
    </>
  );
}

/**
 * Image-based ambient: RoomEnvironment → PMREM, generated once in code (no network, no HDRI file).
 * Materials opt in with `envMapIntensity` (0.35 on opaque tissue and vessels, 0 on transparent layers).
 */
export function SceneEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const texture = useMemo<Texture>(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);

  useEffect(() => {
    const previous = scene.environment;
    scene.environment = texture;
    return () => {
      scene.environment = previous;
      texture.dispose();
    };
  }, [scene, texture]);

  return null;
}
