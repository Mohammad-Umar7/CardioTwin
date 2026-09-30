/**
 * Per-frame facts about the anatomy that other scene layers may read inside useFrame (no React state,
 * module singleton — one canvas per page). Written only by the anatomy rig.
 *
 *   sceneRuntime.assembly  cold-load assembly clock: `t` seconds, `done`, and `igniteAt` — the fx layer
 *                          should start the coronary ignition when `t >= igniteAt` (or immediately when
 *                          `done` was already true at mount: no assembly this session).
 *   sceneRuntime.peel      displayed (spring-smoothed) peel scalar and how open the heart is (0..1).
 *   sceneRuntime.beat      cardiac phase and the ventricular / atrial activations actually applied.
 */
import { ASSEMBLY_DURATION, ASSEMBLY_IGNITE_AT } from '../anatomy/assembly';

export const sceneRuntime = {
  anatomyReady: false,
  assembly: { t: ASSEMBLY_DURATION, done: true, playing: false, igniteAt: ASSEMBLY_IGNITE_AT, duration: ASSEMBLY_DURATION },
  peel: { e: 0.6, heartOpen: 0 },
  beat: { phase: 0, v: 0, a: 0, bpm: 72 },
};

export type SceneRuntime = typeof sceneRuntime;
