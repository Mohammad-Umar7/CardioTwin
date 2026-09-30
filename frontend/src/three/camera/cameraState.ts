/**
 * Camera-side UI state (a small documented store, like stage/sceneControls): what the View menu calls the
 * current view, the Free-orbit preference, Back/Forward availability and the first-frame signal the
 * canvas slot crossfades on. Written by the camera rig and the HUD; the viewer store stays the single
 * source of truth for selection, peel and layers (commands still go through `viewerStore`).
 */
import { create } from 'zustand';
import { PROJECTIONS, formatCarm } from './presets';

export type ViewKind = 'home' | 'preset' | 'focus' | 'custom';

export interface CameraViewState {
  /** How the camera got to where it is; 'custom' after a free orbit (V2 §5.11 View menu). */
  viewKind: ViewKind;
  /** Projection preset id while `viewKind === 'preset'` (e.g. 'LAO45'). */
  presetId: string | null;
  /** Trigger text of the View menu: "Home", "LAO 45", "RAO 30 · CRA 25", "Custom". */
  viewLabel: string;
  /** Unclamped orbit (⋯ › Free orbit): polar 1–179°, distance 1.2–12. */
  freeOrbit: boolean;
  canBack: boolean;
  canForward: boolean;
  /** Back / Forward / frame requests for the rig (monotonic nonce so repeats re-trigger). */
  request: { kind: 'back' | 'forward'; nonce: number } | null;
  /**
   * True once the canvas has drawn a frame with anatomy in it (V2 §5.18): the workstation slot crossfades
   * the poster to the live canvas on this signal, not on the GLB load.
   */
  firstFrame: boolean;

  setView(kind: ViewKind, detail?: { presetId?: string | null; label?: string }): void;
  setFreeOrbit(on: boolean): void;
  setHistory(canBack: boolean, canForward: boolean): void;
  back(): void;
  forward(): void;
  markFirstFrame(): void;
}

let nonce = 0;

export function presetLabel(id: string | null | undefined): string | null {
  return PROJECTIONS.find((p) => p.id === id)?.label ?? null;
}

/** View-menu text for a C-arm direction that is not a named preset ("RAO 30 CRA 25"). */
export function angleLabel(azimuth: number, elevation: number): string {
  return formatCarm(azimuth, elevation).replace(/°/g, '').replace(' · ', ' ');
}

export const useCameraState = create<CameraViewState>()((set) => ({
  viewKind: 'home',
  presetId: null,
  viewLabel: 'Home',
  freeOrbit: false,
  canBack: false,
  canForward: false,
  request: null,
  firstFrame: false,

  setView: (viewKind, detail = {}) =>
    set(() => {
      const presetId = viewKind === 'preset' ? (detail.presetId ?? null) : null;
      const viewLabel =
        detail.label ??
        (viewKind === 'home' ? 'Home' : viewKind === 'preset' ? (presetLabel(presetId) ?? 'Custom') : 'Custom');
      return { viewKind, presetId, viewLabel };
    }),
  setFreeOrbit: (freeOrbit) => set({ freeOrbit }),
  setHistory: (canBack, canForward) => set((s) => (s.canBack === canBack && s.canForward === canForward ? s : { canBack, canForward })),
  back: () => set({ request: { kind: 'back', nonce: (nonce += 1) } }),
  forward: () => set({ request: { kind: 'forward', nonce: (nonce += 1) } }),
  markFirstFrame: () => set((s) => (s.firstFrame ? s : { firstFrame: true })),
}));
