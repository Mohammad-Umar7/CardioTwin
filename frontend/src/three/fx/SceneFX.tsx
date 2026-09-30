import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { Vector3 } from 'three';
import { useAnatomyGlbUrl, useVessels } from '@/hooks/useData';
import { useViewerStore, type RenderTier } from '@/state/viewerStore';
import { Atmosphere } from './Atmosphere';
import { computeArcLengths, type CentrelineFile } from './centreline';
import { FlowCaption } from './FlowCaption';
import { FlowParticles, PARTICLES_BY_TIER } from './FlowParticles';
import { FxDriver } from './FxDriver';
import { FXComposer } from './FXComposer';
import { VesselOverlay } from './VesselOverlay';

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

const noValue = () => undefined;

/**
 * Flow for the BodyParts3D anatomy: the pristine glTF (cached by drei, already loaded by the anatomy)
 * gives each coronary node's rest transform; vessels.json gives the centrelines.
 */
function GlbFlowLayer({ url, centrelines, tier }: { url: string; centrelines: CentrelineFile; tier: RenderTier }) {
  const pristine = useGLTF(url, false, true).scene;
  const { restOffsetOf, treeLengthOf } = useMemo(() => {
    pristine.updateMatrixWorld(true);
    const rest = new Map<string, Vector3>();
    const tree = new Map<string, number>();
    const arc = computeArcLengths(centrelines);
    centrelines.vessels.forEach((v, i) => {
      const node = pristine.getObjectByName(v.node);
      if (node) rest.set(v.node, new Vector3().setFromMatrixPosition(node.matrixWorld));
      tree.set(v.node, arc.treeLength.get(arc.treeOf[i]!) ?? 1);
    });
    return { restOffsetOf: (n: string) => rest.get(n), treeLengthOf: (n: string) => tree.get(n) };
  }, [pristine, centrelines]);
  const particles = tier === 'A' || tier === 'B' ? PARTICLES_BY_TIER[tier] : 0;
  return (
    <>
      <FlowParticles pristine={pristine} centrelines={centrelines} count={particles} />
      <VesselOverlay tier={tier} restOffsetOf={restOffsetOf} treeLengthOf={treeLengthOf} />
    </>
  );
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

  return (
    <>
      <FxDriver />
      <FlowCaption />
      {tier !== 'D' && (
        <FxBoundary name="atmosphere">
          <Atmosphere tier={tier} />
        </FxBoundary>
      )}
      {source === 'glb' && glb && vessels ? (
        <FxBoundary name="coronary flow">
          <Suspense fallback={null}>
            <GlbFlowLayer url={glb} centrelines={vessels} tier={tier} />
          </Suspense>
        </FxBoundary>
      ) : (
        (source === 'procedural' || source === 'error') && (
          // The placeholder heart has its own tubes (with _ARCLEN) but no centrelines: light only.
          <FxBoundary name="vessel overlay">
            <VesselOverlay tier={tier} restOffsetOf={noValue} treeLengthOf={noValue} />
          </FxBoundary>
        )
      )}
      {(tier === 'A' || tier === 'B') && <FXComposer tier={tier} />}
    </>
  );
}
