import { useViewerStore } from '@/state/viewerStore';
import { FXComposer } from './FXComposer';

/**
 * Root of the scene effects layer (`three/fx`), mounted once inside the R3F <Canvas> by SceneCanvas.
 * Owns everything that is light rather than anatomy: the post chain (§7.7), coronary flow particles,
 * the per-beat pulse wave, the ignition sweep and the atmosphere. See `fx/README.md`.
 */
export function SceneFX() {
  const tier = useViewerStore((s) => s.tier);
  return <>{(tier === 'A' || tier === 'B') && <FXComposer tier={tier} />}</>;
}
