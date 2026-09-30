import { useProgress } from '@react-three/drei';
import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import type { Group } from 'three';
import { useAnatomyGlbUrl } from '@/hooks/useData';
import { useViewerStore } from '@/state/viewerStore';
import { GlbAnatomy } from './GlbAnatomy';
import { ProceduralHeart } from './ProceduralHeart';
import { useHeartbeat } from './useHeartbeat';

class GlbErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn('CardioTwin: anatomy GLB failed to load; showing the procedural heart instead.', error);
    useViewerStore.getState().setAnatomySource('error');
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Publishes GLB loading progress to the viewer store for the HUD hairline ("Loading anatomy 42 %"). */
function LoadingReporter() {
  const { progress, active } = useProgress();
  const setAnatomySource = useViewerStore((s) => s.setAnatomySource);
  useEffect(() => {
    if (active) setAnatomySource('loading', { loaded: progress, total: 100 });
  }, [progress, active, setAnatomySource]);
  return null;
}

/** Procedural heart wrapper: the whole placeholder (heart + coronaries) beats as one. */
function BeatingGroup({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useHeartbeat((scale) => group.current?.scale.setScalar(scale));
  return <group ref={group}>{children}</group>;
}

/**
 * Anatomy switch: the BodyParts3D GLB when deployed (probed with a HEAD request), otherwise — or if it
 * fails to load — the procedural placeholder heart. Predictions never wait for either.
 */
export function Anatomy() {
  const glb = useAnatomyGlbUrl();
  if (glb.status === 'loading') return null;
  const url = glb.data;
  return (
    <>
      {url ? (
        <GlbErrorBoundary
          fallback={
            <BeatingGroup>
              <ProceduralHeart />
            </BeatingGroup>
          }
        >
          <Suspense fallback={<LoadingReporter />}>
            <GlbAnatomy url={url} />
          </Suspense>
        </GlbErrorBoundary>
      ) : (
        <BeatingGroup>
          <ProceduralHeart />
        </BeatingGroup>
      )}
    </>
  );
}
