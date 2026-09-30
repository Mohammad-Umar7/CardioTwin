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
  // The canvas always fills its slot, even for the frame between a move (parked 600×400 → a page slot) and
  // R3F's resize: a briefly stretched frame instead of a small one painted over the page's copy.
  const style = document.createElement('style');
  style.textContent = '[data-scene-host] canvas{width:100%!important;height:100%!important}';
  document.head.appendChild(style);
}

/**
 * Dev helper for re-rendering the stage stills (`public/posters/*.webp`, see posters.ts; V2 §5.18): open the
 * page at the poster's viewport (1440×900 or 1280×720) with nothing selected, let the heart settle, then
 * in the console
 *   const blob = await __ctPoster(); open(URL.createObjectURL(blob))
 * and save the image. It renders one frame synchronously and captures the canvas at its CSS size (the
 * stage size, view offset included), so the still matches the live first frame pixel for pixel.
 */
function installPosterHelper(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  (window as unknown as { __ctPoster?: (quality?: number) => Promise<Blob | null> }).__ctPoster = (quality = 0.86) =>
    new Promise((resolve) => {
      const canvas = host?.querySelector('canvas');
      if (!canvas) return resolve(null);
      const out = document.createElement('canvas');
      out.width = Math.round(canvas.clientWidth);
      out.height = Math.round(canvas.clientHeight);
      // Render now and copy in the same task: the drawing buffer is not preserved across frames.
      const step = (window as unknown as { __ct?: { frames?: (n: number, ms: number) => Promise<void> } }).__ct?.frames;
      void step?.(1, 0);
      out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
      out.toBlob((blob) => resolve(blob), 'image/webp', quality);
    });
}
installPosterHelper();

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
    // The parked canvas must not be reachable by keyboard or assistive technology.
    if (parkRef.current) parkRef.current.inert = true;
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
