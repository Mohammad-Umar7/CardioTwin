/**
 * Where the persistent canvas is currently mounted. Pages render <CanvasSlot stage="…"/>; SceneHost
 * moves the single WebGL canvas into the most recently registered slot (and parks it off-screen,
 * paused, when no page wants it).
 */
import { create } from 'zustand';
import type { Stage } from '@/state/viewerStore';

export interface SceneSlotState {
  slot: HTMLElement | null;
  stage: Stage;
  register(el: HTMLElement, stage: Stage): void;
  unregister(el: HTMLElement): void;
}

export const useSceneSlot = create<SceneSlotState>()((set, get) => ({
  slot: null,
  stage: 'hidden',
  register: (el, stage) => set({ slot: el, stage }),
  unregister: (el) => {
    if (get().slot === el) set({ slot: null, stage: 'hidden' });
  },
}));
