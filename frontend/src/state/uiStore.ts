/**
 * UI chrome state: tour, details dialog, panel layout, toasts. `disclaimerAccepted` and
 * `tourCompleted` persist in localStorage; everything else is per session.
 *
 * Note on the disclaimer (DESIGN_SYSTEM §9): there is no blocking consent modal. The status line is
 * permanent; `disclaimerAccepted` only records that the user has opened the Details dialog once, so the
 * "Details ›" affordance can stop drawing attention to itself.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RightTab = 'risk' | 'why' | 'physiology';
export type MobileTab = 'inputs' | 'risk' | 'why';
export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface PanelsState {
  rightTab: RightTab;
  mobileTab: MobileTab;
  /** Group shown in the 1280-px flyout (null = closed). */
  flyoutGroup: string | null;
  flyoutPinned: boolean;
  /** Expanded accordion groups in the ≥1440 left panel. */
  openGroups: string[];
}

export interface UiState {
  tourOpen: boolean;
  tourStep: number;
  tourCompleted: boolean;
  disclaimerAccepted: boolean;
  detailsOpen: boolean;
  shortcutsOpen: boolean;
  panels: PanelsState;
  toasts: Toast[];

  openTour(step?: number): void;
  closeTour(completed?: boolean): void;
  setTourStep(step: number): void;
  openDetails(): void;
  closeDetails(): void;
  setShortcutsOpen(open: boolean): void;
  setPanels(patch: Partial<PanelsState>): void;
  toggleGroup(groupId: string, exclusive?: boolean): void;
  pushToast(toast: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      tourOpen: false,
      tourStep: 0,
      tourCompleted: false,
      disclaimerAccepted: false,
      detailsOpen: false,
      shortcutsOpen: false,
      panels: {
        rightTab: 'risk',
        mobileTab: 'risk',
        flyoutGroup: null,
        flyoutPinned: false,
        openGroups: ['demographics', 'symptoms'],
      },
      toasts: [],

      openTour: (step = 0) => set({ tourOpen: true, tourStep: step }),
      closeTour: (completed = false) =>
        set((s) => ({ tourOpen: false, tourCompleted: s.tourCompleted || completed })),
      setTourStep: (tourStep) => set({ tourStep }),
      openDetails: () => set({ detailsOpen: true, disclaimerAccepted: true }),
      closeDetails: () => set({ detailsOpen: false }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setPanels: (patch) => set((s) => ({ panels: { ...s.panels, ...patch } })),
      toggleGroup: (groupId, exclusive = false) =>
        set((s) => {
          const open = s.panels.openGroups.includes(groupId);
          const openGroups = open
            ? s.panels.openGroups.filter((g) => g !== groupId)
            : exclusive
              ? [groupId]
              : [...s.panels.openGroups, groupId];
          return { panels: { ...s.panels, openGroups } };
        }),
      pushToast: (toast) => {
        toastId += 1;
        const id = toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
        return id;
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'cardiotwin.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ disclaimerAccepted: s.disclaimerAccepted, tourCompleted: s.tourCompleted }),
    },
  ),
);
