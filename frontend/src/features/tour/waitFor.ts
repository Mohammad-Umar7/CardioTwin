/**
 * Small async helpers for flows that cross a route change (landing deep links, the guided demo):
 * wait until the persistent canvas has moved to a page, or until an element exists and has a size.
 * Every wait is bounded and cancellable, so a missing region never hangs a flow.
 */
import { useViewerStore, type Stage } from '@/state/viewerStore';

/** Resolves on the next animation frame (or a 16 ms timeout where rAF is unavailable). */
export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

export const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Resolves `true` once the viewer stage equals `stage` and two frames have passed (so the camera rig has
 * applied the stage pose and a later command is not overridden by it), or `false` after `timeoutMs`.
 */
export function waitForStage(stage: Stage, timeoutMs = 4000, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      if (!ok) {
        resolve(false);
        return;
      }
      void nextFrame()
        .then(nextFrame)
        .then(() => resolve(true));
    };
    const unsubscribe = useViewerStore.subscribe((s) => {
      if (s.stage === stage) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', () => finish(false), { once: true });
    if (useViewerStore.getState().stage === stage) finish(true);
  });
}

/** First element matching any selector in the comma-separated list that has a layout box. */
export function findVisible(selectors: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const sel of selectors.split(',')) {
    const s = sel.trim();
    if (!s) continue;
    let els: NodeListOf<HTMLElement>;
    try {
      els = document.querySelectorAll<HTMLElement>(s);
    } catch {
      continue;
    }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** Polls (per frame) until `findVisible(selectors)` returns an element, or null after `timeoutMs`. */
export async function waitForElement(selectors: string, timeoutMs = 2000, signal?: AbortSignal): Promise<HTMLElement | null> {
  const start = performance.now();
  while (!signal?.aborted) {
    const el = findVisible(selectors);
    if (el) return el;
    if (performance.now() - start > timeoutMs) return null;
    await nextFrame();
  }
  return null;
}
