import { Component, Suspense, type ReactNode } from 'react';
import { useAnatomyGlbUrl, useVessels } from '@/hooks/useData';
import { useViewerStore } from '@/state/viewerStore';
import type { CentrelineFile } from './centreline';
import { FlowParticles, PARTICLES_BY_TIER } from './FlowParticles';
import { FxDriver } from './FxDriver';
import { FXComposer } from './FXComposer';

/** An effect that fails (driver bug, missing float textures) must never take the anatomy down with it. */
class FxBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn(`CardioTwin fx: ${this.props.name} disabled after an error.`, error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Root of the scene effects layer (`three/fx`), mounted once inside the R3F <Canvas> by SceneCanvas.
 * Owns everything that is light rather than anatomy: the post chain (§7.7), coronary flow particles,
 * the per-beat pulse wave, the ignition sweep and the atmosphere. See `fx/README.md`.
 */
export function SceneFX() {
  const tier = useViewerStore((s) => s.tier);
  const source = useViewerStore((s) => s.anatomySource);
  const glb = useAnatomyGlbUrl().data;
  const vessels = useVessels().data as CentrelineFile | undefined;
  const particles = tier === 'A' || tier === 'B' ? PARTICLES_BY_TIER[tier] : 0;

  return (
    <>
      <FxDriver />
      {source === 'glb' && glb && vessels && (
        <FxBoundary name="flow particles">
          <Suspense fallback={null}>
            <FlowParticles url={glb} centrelines={vessels} count={particles} />
          </Suspense>
        </FxBoundary>
      )}
      {(tier === 'A' || tier === 'B') && <FXComposer tier={tier} />}
    </>
  );
}
