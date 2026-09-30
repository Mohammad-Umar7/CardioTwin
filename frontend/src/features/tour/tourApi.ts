/**
 * Entry points into the guided demo that callers outside the tour use (landing CTA, top bar, palette).
 * The tour snapshots the app when it opens and restores it on exit (WORKSTATION_V2 §6.3); callers that
 * navigate before opening pass the route they came from, so exiting returns there.
 */
import type { NavigateFunction } from 'react-router-dom';
import { ROUTES, loadWorkstation } from '@/routes';
import { useUiStore } from '@/state/uiStore';

let origin: string | null = null;

/** Route the next tour should return to on exit (set by `startGuidedDemo`, read once by the tour). */
export function takeTourOrigin(): string | null {
  const o = origin;
  origin = null;
  return o;
}

/**
 * Opens the guided demo on the workstation. `from` is the current route (pathname + search), restored
 * when the demo ends. `chapter` resumes at a chapter's first beat.
 */
export function startGuidedDemo(navigate: NavigateFunction, from: string, step = 0): void {
  origin = from;
  void loadWorkstation();
  if (!from.startsWith(ROUTES.workstation)) navigate(ROUTES.workstation);
  useUiStore.getState().openTour(step);
}
