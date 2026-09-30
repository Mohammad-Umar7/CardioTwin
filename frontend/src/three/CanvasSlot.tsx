import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HairlineProgress } from '@/design';
import { useAnatomyGlbUrl } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { assetUrl } from '@/services/staticData';
import { useViewerStore, type Stage } from '@/state/viewerStore';
import { useCameraState } from './camera/cameraState';
import { posterFor } from './posters';
import { useSceneSlot } from './sceneSlot';

export interface CanvasSlotProps {
  /** Which camera pose / behaviour the page wants ('hero' = landing turntable, 'workstation' = home pose). */
  stage: Exclude<Stage, 'hidden'>;
  /** HUD overlays rendered above the canvas (z-hud). */
  children?: ReactNode;
  className?: string;
  /**
   * Painted under the canvas until WebGL draws its first frame with anatomy (no blank flash), beneath the
   * stage's own still (`POSTERS`, V2 §5.18) — e.g. the landing's backdrop gradient.
   */
  placeholder?: ReactNode;
}

/** V2 §5.18: the canvas crossfades in over 300 ms on its first rendered frame. */
const CROSSFADE_MS = 300;
/** The loader waits 200 ms before showing and then stays at least 400 ms, so it never flashes. */
const LOADER_DELAY_MS = 200;
const LOADER_MIN_MS = 400;

/** The workstation poster at 1440 (also the route fallback's). */
export const WORKSTATION_POSTER = 'posters/workstation.webp';

function StagePoster({ src }: { src: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return (
    <img
      src={assetUrl(src)}
      alt=""
      aria-hidden
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
      className="absolute inset-0 h-full w-full select-none object-cover"
    />
  );
}

/** `true` after `on` has held for `delay` ms, and then for at least `min` ms once shown. */
function useSteadyFlag(on: boolean, delay: number, min: number): boolean {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (on && !shown) {
      const t = window.setTimeout(() => {
        since.current = performance.now();
        setShown(true);
      }, delay);
      return () => window.clearTimeout(t);
    }
    if (!on && shown) {
      const left = Math.max(0, min - (performance.now() - since.current));
      const t = window.setTimeout(() => setShown(false), left);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [on, shown, delay, min]);
  return shown;
}

/** GLB size from a HEAD request, for "Loading anatomy 3.1 / 7.8 MB" (null when the server does not say). */
function useGlbBytes(url: string | null | undefined): number | null {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => Number(r.headers.get('content-length')))
      .then((n) => alive && Number.isFinite(n) && n > 0 && setBytes(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return bytes;
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

/**
 * Loading state of the stage (V2 §5.18): a 1 px accent hairline across the top of the stage and
 * "Loading anatomy 3.1 / 7.8 MB" in label / text-tertiary at the bottom-left (above the legend chip).
 */
function StageLoader({ loading }: { loading: boolean }) {
  const progress = useViewerStore((s) => s.anatomyProgress);
  const glb = useAnatomyGlbUrl().data;
  const bytes = useGlbBytes(glb);
  const shown = useSteadyFlag(loading, LOADER_DELAY_MS, LOADER_MIN_MS);
  if (!shown) return null;
  // The loader reports whole files, so 0 % until the GLB is in: show the size alone (indeterminate hairline)
  // rather than a progress that looks stuck.
  const raw = progress && progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : 0;
  const share = raw > 0 ? raw : null;
  const text =
    share === null
      ? bytes
        ? `Loading anatomy · ${mb(bytes)} MB`
        : 'Loading anatomy…'
      : bytes
        ? `Loading anatomy ${mb(share * bytes)} / ${mb(bytes)} MB`
        : `Loading anatomy ${Math.round(share * 100)} %`;
  return (
    <>
      <HairlineProgress value={share} label="Loading anatomy" className="pointer-events-none absolute inset-x-0 top-0 z-hud" />
      <p
        role="status"
        className="num pointer-events-none absolute bottom-[calc(var(--stage-inset,12px)+var(--toolbar-h,40px)+8px)] left-[var(--stage-inset,12px)] z-hud text-label font-normal text-tertiary"
      >
        {text}
      </p>
    </>
  );
}

/**
 * Where a page wants the persistent 3D canvas. Mounting registers the slot; the shell's SceneHost moves
 * the canvas in. Children are HUD layers positioned over the canvas.
 *
 * Loading (V2 §5.18, P0-4): the placeholder (the workstation poster by default) is painted from the first
 * paint; the canvas layer stays transparent until the camera rig reports the first frame with anatomy in
 * it, then crossfades in over 300 ms — on that frame, not on the GLB load, so no blank frame is ever
 * visible. Once the canvas has drawn, later visits show it at once.
 */
export function CanvasSlot({ stage, children, className, placeholder }: CanvasSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const register = useSceneSlot((s) => s.register);
  const unregister = useSceneSlot((s) => s.unregister);
  const firstFrame = useCameraState((s) => s.firstFrame);
  const tier = useViewerStore((s) => s.tier);
  const reduced = useIsReducedMotion();
  const ready = firstFrame || tier === 'D';
  // The stage's still (for this slot's size) over the page's own placeholder (the landing's backdrop).
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const w = rootRef.current?.getBoundingClientRect().width ?? 0;
    if (w > 0) setWidth(w);
  }, []);
  const poster = (
    <div aria-hidden className="absolute inset-0 bg-void">
      {placeholder}
      <StagePoster src={posterFor(stage, width)} />
    </div>
  );
  // Keep the poster under the canvas until the crossfade has finished, then drop it.
  const [posterGone, setPosterGone] = useState(ready);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setPosterGone(true), reduced ? 0 : CROSSFADE_MS + 100);
    return () => window.clearTimeout(t);
  }, [ready, reduced]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    register(el, stage);
    return () => unregister(el);
  }, [stage, register, unregister]);

  return (
    <div ref={rootRef} className={cn('relative isolate overflow-hidden bg-void', className)}>
      {!posterGone && poster}
      <div
        ref={ref}
        data-ready={ready}
        className={cn(
          'absolute inset-0 transition-opacity ease-out',
          reduced ? 'duration-0' : 'duration-300',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      />
      {stage === 'workstation' && <StageLoader loading={!ready} />}
      {children}
    </div>
  );
}
