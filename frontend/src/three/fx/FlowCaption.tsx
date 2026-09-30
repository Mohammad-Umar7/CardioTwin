import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { sceneRuntime } from '../stage/sceneRuntime';
import { FLOW_CAPTION, FLOW_CAPTION_DETAIL, captionPlacement, captionVisible } from './caption';
import { IGNITE_DONE, fxFrame } from './fxState';

/**
 * The caption that must accompany the flow particles wherever they are shown in the workstation
 * (clinical-safety wording). A plain DOM note over the canvas, created imperatively because this
 * component lives inside the R3F tree. It
 *   - sits in ONE fixed spot (canvas centre, above the toolbar row: `captionPlacement`), so it never jumps
 *     between rest, focus mode and open drawers;
 *   - sits on a dark scrim, so its text keeps ≥ 4.5 : 1 contrast over any tissue behind it;
 *   - shows only while flow is really on screen: the Flow toggle, Calm / reduced motion and the tier, but
 *     also the lit coronary tree (not during the assembly, not under a closed chest: `captionVisible`);
 *   - stays out of the way of the one-time first-run hint (same row) and carries the full explanation as
 *     its accessible description and hover title.
 */
export function FlowCaption() {
  const gl = useThree((s) => s.gl);
  const reduced = useReducedMotion();
  const enabled = useViewerStore((s) => s.stage === 'workstation' && s.bloodFlow && s.tier !== 'D');
  const hintPending = useUiStore((s) => !s.hintSeen && s.chrome === 'workstation');
  const chip = useRef<HTMLDivElement | null>(null);
  const shown = useRef<boolean | null>(null);

  useEffect(() => {
    const host = gl.domElement.parentElement?.parentElement ?? gl.domElement.parentElement;
    if (!host) return;
    const el = document.createElement('div');
    el.className =
      'pointer-events-auto absolute z-hud flex cursor-help select-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-label font-normal text-secondary transition-opacity duration-fast ease-out';
    el.style.background = 'rgb(var(--c-bg-app) / 0.78)';
    el.style.boxShadow = '0 0 0 1px rgb(var(--c-text-primary) / 0.06)';
    el.setAttribute('role', 'note');
    el.setAttribute('aria-label', `${FLOW_CAPTION}. ${FLOW_CAPTION_DETAIL}`);
    el.title = FLOW_CAPTION_DETAIL;
    el.dataset.fxCaption = 'flow';
    Object.assign(el.style, captionPlacement());
    el.style.display = 'none';
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'inline-block h-1 w-1 rounded-full';
    dot.style.background = 'rgb(var(--c-text-primary) / 0.85)';
    const text = document.createElement('span');
    text.textContent = FLOW_CAPTION;
    el.append(dot, text);
    host.appendChild(el);
    chip.current = el;
    shown.current = null;
    return () => {
      el.remove();
      chip.current = null;
    };
  }, [gl]);

  // Per frame, without React state: only touch the DOM when visibility flips.
  useFrame(() => {
    const el = chip.current;
    if (!el) return;
    let solid = 0;
    for (const [node, v] of Object.entries(sceneRuntime.nodes)) if (node.startsWith('Coronary_')) solid = Math.max(solid, v.solid);
    const visible =
      enabled &&
      !reduced &&
      !hintPending &&
      captionVisible({ flowOpacity: fxFrame.flowOpacity, ignited: fxFrame.ignite >= IGNITE_DONE, coronarySolid: solid, peel: sceneRuntime.peel.e });
    if (visible === shown.current) return;
    shown.current = visible;
    el.style.display = visible ? '' : 'none';
  });

  return null;
}
