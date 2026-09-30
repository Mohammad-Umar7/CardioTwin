import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Stage } from '@/state/viewerStore';
import { useSceneSlot } from './sceneSlot';

export interface CanvasSlotProps {
  /** Which camera pose / behaviour the page wants ('hero' = landing turntable, 'workstation' = home pose). */
  stage: Exclude<Stage, 'hidden'>;
  /** HUD overlays rendered above the canvas (z-hud). */
  children?: ReactNode;
  className?: string;
  /** Shown under the canvas until WebGL paints its first frame (no blank flash). */
  placeholder?: ReactNode;
}

/**
 * Where a page wants the persistent 3D canvas. Mounting registers the slot; the shell's SceneHost moves
 * the canvas in. Children are HUD layers positioned over the canvas.
 */
export function CanvasSlot({ stage, children, className, placeholder }: CanvasSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const register = useSceneSlot((s) => s.register);
  const unregister = useSceneSlot((s) => s.unregister);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    register(el, stage);
    return () => unregister(el);
  }, [stage, register, unregister]);

  return (
    <div className={cn('relative isolate overflow-hidden bg-void', className)}>
      {placeholder && <div className="absolute inset-0">{placeholder}</div>}
      <div ref={ref} className="absolute inset-0" />
      {children}
    </div>
  );
}
