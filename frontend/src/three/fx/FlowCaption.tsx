import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { FLOW_CAPTION, FLOW_CAPTION_DETAIL, captionPlacement } from './caption';

/**
 * The caption that must accompany the flow particles wherever they are shown in the workstation
 * (clinical-safety wording). A plain DOM note over the canvas, created imperatively because this
 * component lives inside the R3F tree; it follows the free area (`uiStore.stageInsets`), the Flow toggle,
 * Calm / reduced motion and the stage, stays out of the way of the one-time first-run hint (same row),
 * and carries the full explanation as its accessible description and hover title.
 */
export function FlowCaption() {
  const gl = useThree((s) => s.gl);
  const reduced = useReducedMotion();
  const visible = useViewerStore((s) => s.stage === 'workstation' && s.bloodFlow && s.tier !== 'D');
  const insets = useUiStore((s) => s.stageInsets);
  const hintPending = useUiStore((s) => !s.hintSeen && s.chrome === 'workstation');

  useEffect(() => {
    const host = gl.domElement.parentElement?.parentElement ?? gl.domElement.parentElement;
    if (!host) return;
    const chip = document.createElement('div');
    chip.className =
      'pointer-events-auto absolute z-hud flex cursor-help select-none items-center gap-1.5 whitespace-nowrap text-label font-normal text-tertiary';
    chip.setAttribute('role', 'note');
    chip.setAttribute('aria-label', `${FLOW_CAPTION}. ${FLOW_CAPTION_DETAIL}`);
    chip.title = FLOW_CAPTION_DETAIL;
    chip.dataset.fxCaption = 'flow';
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'inline-block h-1 w-1 rounded-full';
    dot.style.background = 'rgb(var(--c-text-primary) / 0.85)';
    const text = document.createElement('span');
    text.textContent = FLOW_CAPTION;
    chip.append(dot, text);
    host.appendChild(chip);
    return () => chip.remove();
  }, [gl]);

  useEffect(() => {
    const chip = gl.domElement.parentElement?.parentElement?.querySelector<HTMLElement>('[data-fx-caption="flow"]');
    if (!chip) return;
    Object.assign(chip.style, captionPlacement(insets));
    const legacy = insets.left === 0 && insets.right === 0 && insets.bottom === 0;
    chip.style.display = visible && !reduced && (legacy || !hintPending) ? '' : 'none';
  }, [gl, visible, reduced, insets, hintPending]);

  return null;
}
