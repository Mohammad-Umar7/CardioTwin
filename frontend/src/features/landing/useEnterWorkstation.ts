/**
 * "Enter Workstation": the hero's call to action, and the top bar's Workstation link while the landing is up.
 *
 * Cinematic path (the 3D hero is drawn, motion is allowed, the hero is on screen):
 *   0 ms      the copy and the hero's veils clear and the camera rig plays the dolly (stage/heroIntro.ts): the
 *             chest's glass clears (the skin first, the rib cage softly after it) while the camera moves in on
 *             the heart and lands on the workstation's own home framing, for the free area its cards will leave;
 *   1720 ms   the route changes to the existing workstation. On wide screens the canvas keeps its exact
 *             rectangle, so the last frame here is the workstation's first and the canvas is handed over
 *             without a veil; the workstation's cards, labels and risk colours then arrive as usual.
 * Simple path (reduced motion or Calm, no 3D yet or none at all, the hero scrolled away): the copy fades for a
 *   moment and the route changes; the workstation loads as it always does.
 *
 * Repeated calls while leaving are ignored. The route change runs on a timer, never on frames, so the 3D can
 * never hold anyone back.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { computeStageInsets } from '@/features/workstation/stageInsets';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { ROUTES } from '@/routes';
import { selectPatientCardExpanded, useUiStore, type StageInsets } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useCameraState } from '@/three/camera/cameraState';
import { announceSeamlessHandoff } from '@/three/sceneSlot';
import { useHeroIntro } from '@/three/stage/heroIntro';
import { sceneRuntime } from '@/three/stage/sceneRuntime';

/** The camera move (ms). */
export const DOLLY_MS = 1700;
/** The route change, right as the camera lands. */
export const NAVIGATE_AT_MS = 1720;
/** The simple path's fade before the route change (ms). */
export const SIMPLE_FADE_MS = 180;
/** The guided demo's exit before the tour takes over (ms). */
export const DEMO_EXIT_MS = 240;

/** Below this width the workstation stacks (its canvas is a different rectangle: no seamless handoff). */
const WORKSTATION_STAGE_FROM = 1100;

export type LeaveMode = 'cinematic' | 'simple' | null;

const NONE: StageInsets = { left: 0, right: 0, top: 0, bottom: 0 };

function cssPx(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * The insets the workstation's stage will publish on arrival (its patient card, risk column and toolbar, from
 * the same tokens and the same rule StageLayout measures them with), or none when the workstation stacks.
 */
export function predictedWorkstationInsets(viewportWidth: number): { insets: StageInsets; handoff: boolean } {
  if (!(viewportWidth >= WORKSTATION_STAGE_FROM)) return { insets: NONE, handoff: false };
  const ui = useUiStore.getState();
  const left = selectPatientCardExpanded(ui) ? cssPx('--card-left-w', 280) : cssPx('--rail-w', 40);
  const insets = computeStageInsets({
    chrome: 'workstation',
    drawer: ui.drawer,
    stageInset: cssPx('--stage-inset', 12),
    left: { width: left, height: 1 },
    right: { width: cssPx('--card-right-w', 352), height: 1 },
    bottom: { width: 1, height: cssPx('--toolbar-h', 40) },
    drawerInputsWidth: cssPx('--drawer-inputs-w', 400),
    drawerExplainWidth: cssPx('--drawer-explain-w', 440),
  });
  return { insets, handoff: true };
}

/** The 3D hero can carry the dolly: drawn, warm, on this page, and at least half of it on screen. */
function dollyReady(stage: HTMLElement | null): boolean {
  const viewer = useViewerStore.getState();
  if (viewer.tier === 'D' || viewer.anatomySource !== 'glb' || viewer.warming || viewer.stage !== 'hero') return false;
  if (!useCameraState.getState().firstFrame || !sceneRuntime.anatomyShown) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  const rect = stage?.getBoundingClientRect();
  if (!rect || !(rect.height > 0)) return false;
  const shown = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return shown >= rect.height * 0.5;
}

export interface WorkstationEntry {
  /** How the page is leaving (drives the copy's exit), or null while it stays. */
  leaving: LeaveMode;
  /** Plays the transition and opens the workstation. True = handled (always, while mounted). */
  enter(): boolean;
  /** Fades the copy, then runs `run` (another way out, e.g. the guided demo). */
  leave(run: () => void): void;
}

export function useEnterWorkstation(stageRef: RefObject<HTMLElement>): WorkstationEntry {
  const navigate = useNavigate();
  const reduced = useIsReducedMotion();
  const [leaving, setLeaving] = useState<LeaveMode>(null);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // A fresh landing always starts at rest (a dolly cut short by Back must not carry over). Before the canvas
  // moves in: SceneHost switches the stage after this page's layout effects.
  useLayoutEffect(() => {
    useHeroIntro.getState().reset();
  }, []);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
      document.documentElement.style.removeProperty('overflow');
    },
    [],
  );

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const enter = useCallback((): boolean => {
    if (busy.current) return true;
    busy.current = true;
    if (reducedRef.current || !dollyReady(stageRef.current)) {
      setLeaving('simple');
      later(reducedRef.current ? 0 : SIMPLE_FADE_MS, () => navigate(ROUTES.workstation));
      return true;
    }
    setLeaving('cinematic');
    // The page holds still while the camera moves (and loses its scrollbar, so the canvas already has the
    // workstation stage's width when the dolly solves its landing).
    const root = document.documentElement;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    root.style.overflow = 'hidden';
    const { insets, handoff } = predictedWorkstationInsets(window.innerWidth);
    useHeroIntro.getState().enter(DOLLY_MS, insets);
    later(NAVIGATE_AT_MS, () => {
      const host = document.querySelector<HTMLElement>('[data-scene-host]');
      if (handoff && host) announceSeamlessHandoff(host.getBoundingClientRect());
      navigate(ROUTES.workstation);
    });
    return true;
    // `navigate` is stable for the router's lifetime; the refs carry the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = useCallback((run: () => void) => {
    if (busy.current) return;
    busy.current = true;
    setLeaving('simple');
    later(reducedRef.current ? 0 : DEMO_EXIT_MS, () => {
      busy.current = false;
      run();
      // The tour usually takes the page elsewhere; if it does not, the copy comes back.
      setLeaving(null);
    });
  }, []);

  return { leaving, enter, leave };
}
