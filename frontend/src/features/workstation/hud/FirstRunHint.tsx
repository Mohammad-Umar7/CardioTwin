import { useEffect, useState } from 'react';
import { StageCard } from '@/design';
import { useUiStore } from '@/state/uiStore';

/**
 * FirstRunHint — WORKSTATION_V2 §8.7: "Drag to rotate · Scroll to zoom · Click an artery", a chip centred
 * above the toolbar. Fades in 1.5 s after ignition, out on the first drag or after 8 s; remembered in
 * `uiStore.hintSeen` (persisted, try/catch) and never shown again. Rendered in StageLayout's `overlay`
 * slot; it positions itself from `uiStore.stageInsets` (centre of the free area, above the toolbar).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent D on creation; A never edits this file again.
 *
 * Contract:
 *   export interface FirstRunHintProps { className?: string }
 *   - Renders nothing once `hintSeen` is true or outside chrome `workstation`.
 *   - Dismiss: `setHintSeen()`.
 */
export interface FirstRunHintProps {
  className?: string;
}

const SHOW_AFTER_MS = 1500;
const HIDE_AFTER_MS = 8000;

export function FirstRunHint({ className }: FirstRunHintProps) {
  const seen = useUiStore((s) => s.hintSeen);
  const chrome = useUiStore((s) => s.chrome);
  const insets = useUiStore((s) => s.stageInsets);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (seen || chrome !== 'workstation') return;
    const show = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const hide = window.setTimeout(() => useUiStore.getState().setHintSeen(), SHOW_AFTER_MS + HIDE_AFTER_MS);
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) useUiStore.getState().setHintSeen();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, [seen, chrome]);

  if (seen || chrome !== 'workstation' || !shown) return null;
  return (
    <StageCard
      as="div"
      shape="chip"
      region="first-run-hint"
      role="note"
      style={{
        left: `calc((${insets.left}px + 100% - ${insets.right}px) / 2)`,
        bottom: `calc(${insets.bottom}px + 4px)`,
      }}
      className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-label font-normal text-secondary ${className ?? ''}`}
    >
      Drag to rotate · Scroll to zoom · Click an artery
    </StageCard>
  );
}
