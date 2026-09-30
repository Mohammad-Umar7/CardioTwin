import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useViewerStore } from '@/state/viewerStore';

export const FLOW_CAPTION = 'Illustrative flow — not a haemodynamic simulation';
export const FLOW_CAPTION_DETAIL =
  'Particles show the direction of coronary blood flow (ostium → distal) and its timing: coronary inflow is ' +
  'mostly diastolic, so it surges as the heart relaxes and nearly stalls while it contracts; the light wave ' +
  'marks that surge once per beat. Density, speed and warmth echo each vessel’s predicted stenosis ' +
  'probability. Nothing here is measured or simulated flow, pressure or FFR.';

/**
 * The caption that must accompany the flow particles wherever they are shown in the workstation
 * (clinical-safety wording). A plain DOM caption anchored top-right over the canvas, directly under the HUD
 * watermark, created imperatively because this component lives inside the R3F tree. It follows the
 * Flow toggle, Calm / reduced motion and the stage, and carries the full explanation as its accessible
 * description and hover title.
 */
export function FlowCaption() {
  const gl = useThree((s) => s.gl);
  const reduced = useReducedMotion();
  const visible = useViewerStore((s) => s.stage === 'workstation' && s.bloodFlow && s.tier !== 'D');

  useEffect(() => {
    const host = gl.domElement.parentElement?.parentElement ?? gl.domElement.parentElement;
    if (!host) return;
    const chip = document.createElement('div');
    // Right-aligned under the canvas HUD's "NOT FOR DIAGNOSTIC USE" watermark (projections 24 px + gap +
    // watermark line), in the same quiet disclaimer voice, so the two caveats read as one block.
    chip.className =
      'pointer-events-auto absolute right-3 top-[62px] z-hud flex cursor-help select-none items-center gap-1.5 whitespace-nowrap text-[0.6875rem] font-medium leading-4 text-tertiary/80';
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
    if (chip) chip.style.display = visible && !reduced ? '' : 'none';
  }, [gl, visible, reduced]);

  return null;
}
