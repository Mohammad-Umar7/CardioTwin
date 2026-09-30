import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BackSide,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useViewerStore } from '@/state/viewerStore';
import { LIGHTS } from '@/theme/tokens';
import { lookOf, type SceneLook } from './sceneControls';

/**
 * Camera-attached rig per look. Clinical = LUMEN §7.2 exactly. Realistic (§7.9) = a warmer, stronger key
 * for the wet highlights, a cool rim that backlights the silhouette (it also drives the subsurface
 * back-scatter in the tissue shader) and a slightly lower hemisphere so the creases stay deep.
 */
interface DirLight {
  color: string;
  intensity: number;
  position: readonly [number, number, number];
}
export interface LightRig {
  hemisphere: { sky: string; ground: string; intensity: number };
  key: DirLight;
  rim: DirLight;
  fill: DirLight;
  envMapIntensity: number;
}

export const RIGS: Record<SceneLook, LightRig> = {
  clinical: LIGHTS,
  realistic: {
    hemisphere: { sky: '#DCE6F2', ground: '#3A2522', intensity: 0.42 },
    key: { color: '#FFE8D8', intensity: 2.7, position: [-3, 4, 5] },
    rim: { color: '#A6C6FF', intensity: 2.3, position: [2.5, 2, -4] },
    fill: { color: '#FFF3EC', intensity: 0.32, position: [4, -1, 3] },
    envMapIntensity: 0.75,
  },
};

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

/**
 * A photographic studio in code (no HDRI file, no network): a dark cyclorama with a large warm softbox
 * above-left, a tall cool strip behind-right, a soft top panel and a dim warm bounce from below. Its
 * reflections are what make the clearcoat read as a wet epicardium — long soft highlights instead of the
 * room's small box lights.
 */
export function buildStudioScene(): Scene {
  const scene = new Scene();
  const dome = new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: new Color('#0B0D11'), side: BackSide }));
  scene.add(dome);
  const panel = (w: number, h: number, color: string, intensity: number, pos: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(9, 6, '#FFF1E4', 7, [-6, 7, 8]); // key softbox
  panel(2.2, 12, '#B9D2FF', 6, [9, 2, -7]); // rim strip
  panel(10, 10, '#FFFFFF', 1.6, [0, 12, 0]); // top
  panel(12, 5, '#7A4034', 0.5, [0, -9, 4]); // warm bounce
  panel(3, 8, '#FFE9DA', 2.2, [10, 1, 6]); // fill card
  return scene;
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
