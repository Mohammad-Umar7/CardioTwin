import { Component, Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewerStore } from '@/state/viewerStore';
import { useSceneSlot } from './sceneSlot';
import { WebGLFallback } from './WebGLFallback';
import { probeWebGL } from './webgl';

const SceneCanvas = lazy(() => import('./SceneCanvas'));

/** The one DOM node that holds the canvas; moved (never re-created) between page slots. */
const host: HTMLDivElement | null = typeof document !== 'undefined' ? document.createElement('div') : null;
if (host) {
  host.className = 'absolute inset-0';
  host.dataset.sceneHost = '';
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error('CardioTwin: the 3D scene crashed; switching to the 2D schematic.', error);
    useViewerStore.getState().setTier('D', true);
  }
  override render() {
    return this.state.failed ? <WebGLFallback /> : this.props.children;
  }
}

/**
 * Owns the single persistent canvas (DESIGN_SYSTEM §4: "One persistent <Canvas> lives in the app
 * shell"). The canvas is rendered through a portal into a detached host element; the host is appended to
 * the active page's <CanvasSlot/> (or parked off-screen and paused), so route changes move the canvas
 * without remounting the WebGL context or reloading the GLB. Tier D swaps in the 2D schematic.
 */
export function SceneHost() {
  const parkRef = useRef<HTMLDivElement>(null);
  const slot = useSceneSlot((s) => s.slot);
  const stage = useSceneSlot((s) => s.stage);
  const tier = useViewerStore((s) => s.tier);
  const [everShown, setEverShown] = useState(false);

  useEffect(() => {
    if (!probeWebGL().webgl2) useViewerStore.getState().setTier('D', true);
  }, []);

  useLayoutEffect(() => {
    const target = slot ?? parkRef.current;
    if (!host || !target) return;
    if (host.parentElement !== target) target.appendChild(host);
    if (slot) setEverShown(true);
    useViewerStore.getState().setStage(slot ? stage : 'hidden');
  }, [slot, stage]);

  return (
    <>
      <div
        ref={parkRef}
        aria-hidden
        className="pointer-events-none fixed left-[-10000px] top-0 h-[400px] w-[600px] overflow-hidden"
      />
      {host &&
        everShown &&
        createPortal(
          tier === 'D' ? (
            <WebGLFallback />
          ) : (
            <SceneErrorBoundary>
              <Suspense fallback={null}>
                <SceneCanvas active={!!slot} />
              </Suspense>
            </SceneErrorBoundary>
          ),
          host,
        )}
    </>
  );
}
