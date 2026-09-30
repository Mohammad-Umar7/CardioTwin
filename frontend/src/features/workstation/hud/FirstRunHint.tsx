import { MousePointer2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StageCard } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/state/uiStore';
import { useCameraState } from '@/three/camera/cameraState';
import { usePresence } from './presence';

/**
 * FirstRunHint — WORKSTATION_V2 §8.7: "Drag to rotate · Scroll to zoom · Click an artery", a chip centred
 * above the toolbar (in the free area, so it follows the view offset). It fades in 1.5 s after the heart
 * first appears, and fades out over `base` on the first drag, wheel or key on the canvas, or after 8 s.
 * Remembered in `uiStore.hintSeen` (persisted, try/catch) and never shown again. Rendered in StageLayout's
 * `overlay` slot; only in the `workstation` chrome.
 */
export interface FirstRunHintProps {
  className?: string;
}

const SHOW_AFTER_MS = 1500;
const HIDE_AFTER_MS = 8000;
const EXIT_MS = 240;

export function FirstRunHint({ className }: FirstRunHintProps) {
  const seen = useUiStore((s) => s.hintSeen);
  const chrome = useUiStore((s) => s.chrome);
  const insets = useUiStore((s) => s.stageInsets);
  const ready = useCameraState((s) => s.firstFrame);
  const reduced = useIsReducedMotion();
  const [shown, setShown] = useState(false);
  const active = !seen && chrome === 'workstation' && ready;
  const presence = usePresence<true>(active && shown ? true : null, reduced, EXIT_MS);

  useEffect(() => {
    if (!active) return;
    const show = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const hide = window.setTimeout(() => dismiss(), SHOW_AFTER_MS + HIDE_AFTER_MS);
    function dismiss() {
      setShown(false);
      // Let the fade finish before the persisted flag unmounts the hint for good.
      window.setTimeout(() => useUiStore.getState().setHintSeen(), reduced ? 0 : EXIT_MS);
    }
    const onCanvasInput = (e: Event) => {
      if (e.target instanceof HTMLCanvasElement) dismiss();
    };
    window.addEventListener('pointerdown', onCanvasInput, true);
    window.addEventListener('wheel', onCanvasInput, { capture: true, passive: true });
    window.addEventListener('keydown', onCanvasInput, true);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      window.removeEventListener('pointerdown', onCanvasInput, true);
      window.removeEventListener('wheel', onCanvasInput, true);
      window.removeEventListener('keydown', onCanvasInput, true);
    };
  }, [active, reduced]);

  if (!presence.shown) return null;
  return (
    <StageCard
      as="div"
      shape="chip"
      region="first-run-hint"
      role="note"
      noEnter
      style={{
        left: `calc((${insets.left}px + 100% - ${insets.right}px) / 2)`,
        bottom: `${Math.max(insets.bottom, 12) + 4}px`,
      }}
      className={cn(
        'pointer-events-none absolute -translate-x-1/2 gap-2 whitespace-nowrap text-label font-normal text-secondary',
        'transition-[opacity,transform,left] duration-base ease-out motion-reduce:!translate-y-0',
        presence.phase === 'open' ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        className,
      )}
    >
      <MousePointer2 aria-hidden className="size-3.5 stroke-[1.5] text-tertiary" />
      <span>
        Drag to rotate <span className="text-tertiary">·</span> Scroll to zoom <span className="text-tertiary">·</span> Click an artery
      </span>
    </StageCard>
  );
}
