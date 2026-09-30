/**
 * Transient input interaction state shared by the patient components (not persisted, not app state):
 * whether a value is being dragged, so rankings never reorder mid-drag (V2 §9.3 B accept criteria).
 */
import { create } from 'zustand';

interface InteractionState {
  /** A numeric track is being dragged. */
  dragging: boolean;
  setDragging(dragging: boolean): void;
}

export const useInputInteraction = create<InteractionState>()((set) => ({
  dragging: false,
  setDragging: (dragging) => set({ dragging }),
}));
