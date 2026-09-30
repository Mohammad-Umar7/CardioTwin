/**
 * Lighting data for both looks (DESIGN_SYSTEM §7.2 Clinical, §7.9 Realistic) and the code-built studio
 * environment used for the Realistic look's reflections.
 */
import { BackSide, Color, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, SphereGeometry } from 'three';
import { LIGHTS } from '@/theme/tokens';
import type { SceneLook } from './sceneControls';

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

