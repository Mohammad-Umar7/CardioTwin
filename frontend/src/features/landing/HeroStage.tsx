import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { HairlineProgress } from '@/design';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { assetUrl } from '@/services/staticData';
import { useViewerStore } from '@/state/viewerStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { useCameraState } from '@/three/camera/cameraState';
import { posterFor, type PosterLayout } from '@/three/posters';
import { heroRuntime, useHeroIntro } from '@/three/stage/heroIntro';
import { LANDING_SPLIT_AT, useOnScreen } from './useLandingStage';

/** Painted under the canvas until its first frame: the stage's own dark, lit behind the torso. */
export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ background: 'radial-gradient(52% 70% at 68% 46%, #10151B 0%, #0A0D11 58%, #07090C 100%)' }}
    />
  );
}

/** Without WebGL: the hero's still, so the landing never shows an empty stage. */
function HeroStill({ layout }: { layout: PosterLayout }) {
  const [failed, setFailed] = useState(false);
  const [width] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  return (
    <>
      <HeroBackdrop />
      {!failed && (
        <img
          src={assetUrl(posterFor('hero', width, layout))}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      )}
      <p className="absolute bottom-4 right-5 text-label font-normal text-tertiary">Interactive 3D is not available on this device</p>
    </>
  );
}

const LOADER_DELAY_MS = 700;

/** A quiet line while the anatomy streams in on a slow connection (never on a fast one). */
function HeroLoading() {
  const firstFrame = useCameraState((s) => s.firstFrame);
  const progress = useViewerStore((s) => s.anatomyProgress);
  // Once the model is in, the stage waits for its shaders and its first frame, not for bytes.
  const preparing = useViewerStore((s) => s.warming || s.anatomySource !== 'loading');
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (firstFrame) return;
    const t = window.setTimeout(() => setShown(true), LOADER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [firstFrame]);
  if (firstFrame || !shown) return null;
  const share = progress && progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : null;
  return (
    <>
      <HairlineProgress value={preparing ? null : share} label="Loading the 3D anatomy" className="absolute inset-x-0 top-0" />
      <p role="status" className="absolute bottom-4 right-5 text-label font-normal text-tertiary">
        {preparing ? 'Preparing the 3D heart…' : share ? `Loading the 3D anatomy · ${Math.round(share * 100)} %` : 'Loading the 3D anatomy…'}
      </p>
    </>
  );
}

/**
 * Mouse position over the page as −1..1 from the stage's centre, for the camera's parallax (no React state;
 * touch and pen-less devices leave it inactive).
 */
function usePointerParallax(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const pointer = heroRuntime.pointer;
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    if (!fine) {
      pointer.active = false;
      return;
    }
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      pointer.x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2));
      pointer.y = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2));
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      pointer.active = false;
    };
  }, [ref]);
}

export interface HeroStageProps {
  className?: string;
}

/**
 * The hero's 3D stage: the persistent canvas showing the upper torso with the heart inside it. It is a
 * presentation (the copy carries the message, the workstation is where the heart is explored), so it is inert:
 * no pointer capture, no focus stop, nothing for a screen reader, and the page scrolls over it on touch. It moves
 * on its own only while on screen; tier D (no WebGL) shows a still instead.
 */
export function HeroStage({ className }: HeroStageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = useViewerStore((s) => s.tier);
  const layout: PosterLayout = useMediaQuery(`(min-width: ${LANDING_SPLIT_AT}px)`) ? 'split' : 'stacked';

  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = true;
  }, []);

  usePointerParallax(ref);
  // The hero moves on its own only while it is on screen; the lite tier (a slow device) keeps it still, so no
  // frames are drawn while nothing is asked of it.
  const onScreen = useRef(true);
  const updateLive = useCallback(() => {
    useHeroIntro.getState().setLive(onScreen.current && useViewerStore.getState().tier !== 'C');
  }, []);
  const onVisibility = useCallback(
    (visible: boolean) => {
      onScreen.current = visible;
      updateLive();
    },
    [updateLive],
  );
  useOnScreen(ref, onVisibility);
  useEffect(updateLive, [tier, updateLive]);
  useEffect(() => () => useHeroIntro.getState().setLive(false), []);

  return (
    <div ref={ref} aria-hidden data-region="landing-stage" className={cn('pointer-events-none relative overflow-hidden', className)}>
      {tier === 'D' ? (
        <HeroStill layout={layout} />
      ) : (
        <CanvasSlot stage="hero" className="absolute inset-0" placeholder={<HeroBackdrop />} posterLayout={layout} />
      )}
      {tier !== 'D' && <HeroLoading />}
    </div>
  );
}
