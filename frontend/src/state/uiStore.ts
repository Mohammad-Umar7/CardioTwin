/**
 * UI chrome state: chrome preset, drawers, palette, stage insets, tour, details dialog, toasts.
 * `disclaimerAccepted`, `tourCompleted`, `patientCardOpen` and `hintSeen` persist in localStorage (through
 * `safeLocalStorage`, so blocked storage degrades to per-session state); everything else is per session.
 *
 * Note on the disclaimer (DESIGN_SYSTEM §9): there is no blocking consent modal. The status line is
 * permanent; `disclaimerAccepted` only records that the user has opened the Details dialog once, so the
 * "Details ›" affordance can stop drawing attention to itself.
 *
 * V2 additions (WORKSTATION_V2 §9.2) are additive; no existing field was renamed.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { noteOpener } from '@/lib/focusReturn';
import { safeLocalStorage } from './safeStorage';

/** Compact-layout (< 1100 px) tabs: Summary · Record · Why (V2 §4.7). */
export type MobileTab = 'inputs' | 'risk' | 'why';
export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

/** Chrome presets (V2 §4.1): which regions float over the stage. */
export type Chrome = 'workstation' | 'focus' | 'tour' | 'landing';
/** Docked drawers (V2 §5.4). Only one is open at a time. */
export type DrawerId = 'inputs' | 'explain';
/** Explain drawer tabs (V2 §5.10). */
export type ExplainTab = 'why' | 'whatif' | 'physiology' | 'model';
/** Inputs drawer sections (V2 §5.6) a caller can ask the drawer to scroll to. */
export type InputsSection = 'changed' | 'abnormal' | 'key' | 'all';

/**
 * The part of the stage covered by chrome, in CSS px from each stage edge, published by `StageLayout`
 * (V2 §4.1). Each side = the stage inset (12) + the covering card/drawer extent + a 12 px breathing gap,
 * or 0 when nothing covers that side (top is the bare 12 px inset while cards are shown). The free area is
 * the stage rectangle minus these insets; the 3D agent centres the heart in it (`camera.setViewOffset`)
 * and keeps the label lanes inside it.
 */
export interface StageInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OpenDrawerOptions {
  /** Explain drawer tab to show. */
  tab?: ExplainTab;
  /** Inputs drawer: raw feature key of the row to focus and expand. */
  field?: string;
  /** Inputs drawer: section to scroll to. */
  section?: InputsSection;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface PanelsState {
  /** Active tab of the compact (< 1100 px) workstation. */
  mobileTab: MobileTab;
}

export interface UiState {
  tourOpen: boolean;
  tourStep: number;
  tourCompleted: boolean;
  /**
   * Width (px) of the guided demo's caption while it is docked in the left stage column, else 0. The left
   * card is veiled (invisible, inert) meanwhile, and the stage insets reserve the caption's column, so the
   * camera frames the heart beside it, never under it.
   */
  tourDockLeft: number;
  disclaimerAccepted: boolean;
  detailsOpen: boolean;
  shortcutsOpen: boolean;
  panels: PanelsState;
  toasts: Toast[];
  /** Feature linked across the form, the narrative and the SHAP rows while hovered (never anatomy). */
  highlightedFeature: string | null;

  // ------------------------------------------------------------------ V2 (WORKSTATION_V2 §9.2)
  /** Chrome preset; StageLayout shows and hides regions from it. */
  chrome: Chrome;
  /** Open drawer, or null. */
  drawer: DrawerId | null;
  explainTab: ExplainTab;
  /** Inputs drawer row to focus and expand (raw feature key), or null. */
  focusField: string | null;
  /** Inputs drawer section to scroll to, or null. */
  inputsSection: InputsSection | null;
  /** The user's choice for the patient card (card vs 40 px rail). Persisted. See `selectPatientCardExpanded`. */
  patientCardOpen: boolean;
  paletteOpen: boolean;
  /** Published by StageLayout; read by the 3D camera (view offset) and the label lanes. */
  stageInsets: StageInsets;
  /** The same without the guided demo's docked caption (the demo decides where its caption goes from these). */
  stageInsetsBase: StageInsets;
  /** The first-run canvas hint was shown or dismissed. Persisted. */
  hintSeen: boolean;

  openTour(step?: number): void;
  closeTour(completed?: boolean): void;
  setTourStep(step: number): void;
  setTourDockLeft(width: number): void;
  openDetails(): void;
  closeDetails(): void;
  setShortcutsOpen(open: boolean): void;
  setPanels(patch: Partial<PanelsState>): void;
  pushToast(toast: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
  highlightFeature(key: string | null): void;

  /** Entering `focus` closes any open drawer (focus mode shows the stage and the answer pill only). */
  setChrome(chrome: Chrome): void;
  /** `\`: focus ⇄ workstation. No-op on the other presets (tour, landing). */
  toggleFocusMode(): void;
  /** Opens `d` (closing any other drawer) and applies the options. A drawer is working chrome, so
   *  opening one leaves focus mode. */
  openDrawer(d: DrawerId, opts?: OpenDrawerOptions): void;
  closeDrawer(): void;
  /** I / E keys: closes `d` if it is open, otherwise opens it. */
  toggleDrawer(d: DrawerId, opts?: OpenDrawerOptions): void;
  setExplainTab(tab: ExplainTab): void;
  setFocusField(key: string | null): void;
  setPatientCardOpen(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  /** No-op when the insets did not change (safe to call from a ResizeObserver). */
  setStageInsets(insets: StageInsets, base?: StageInsets): void;
  setHintSeen(seen?: boolean): void;
}

export const ZERO_INSETS: StageInsets = Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 });

const sameInsets = (a: StageInsets, b: StageInsets) =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * Whether the patient card shows as the full card (true) or as the 40 px rail (false): the user's choice,
 * except that the Explain drawer auto-collapses it (V2 §4.5) and it is restored when the drawer closes.
 */
export const selectPatientCardExpanded = (s: Pick<UiState, 'patientCardOpen' | 'drawer'>): boolean =>
  s.patientCardOpen && s.drawer !== 'explain';

const CLOSED_DRAWER = { drawer: null, focusField: null, inputsSection: null } as const;

let toastId = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      tourOpen: false,
      tourStep: 0,
      tourCompleted: false,
      tourDockLeft: 0,
      disclaimerAccepted: false,
      detailsOpen: false,
      shortcutsOpen: false,
      panels: { mobileTab: 'risk' },
      toasts: [],
      highlightedFeature: null,

      chrome: 'workstation',
      drawer: null,
      explainTab: 'why',
      focusField: null,
      inputsSection: null,
      patientCardOpen: true,
      paletteOpen: false,
      stageInsets: ZERO_INSETS,
      stageInsetsBase: ZERO_INSETS,
      hintSeen: false,

      openTour: (step = 0) => set({ tourOpen: true, tourStep: step }),
      closeTour: (completed = false) =>
        set((s) => ({ tourOpen: false, tourDockLeft: 0, tourCompleted: s.tourCompleted || completed })),
      setTourStep: (tourStep) => set({ tourStep }),
      setTourDockLeft: (width) => {
        const tourDockLeft = Math.max(0, Math.round(width));
        if (get().tourDockLeft !== tourDockLeft) set({ tourDockLeft });
      },
      openDetails: () => set({ detailsOpen: true, disclaimerAccepted: true }),
      closeDetails: () => set({ detailsOpen: false }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setPanels: (patch) => set((s) => ({ panels: { ...s.panels, ...patch } })),
      pushToast: (toast) => {
        toastId += 1;
        const id = toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
        return id;
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      highlightFeature: (highlightedFeature) => set({ highlightedFeature }),

      setChrome: (chrome) => set(chrome === 'focus' ? { chrome, ...CLOSED_DRAWER } : { chrome }),
      toggleFocusMode: () =>
        set((s) =>
          s.chrome === 'focus'
            ? { chrome: 'workstation' }
            : s.chrome === 'workstation'
              ? { chrome: 'focus', ...CLOSED_DRAWER }
              : {},
        ),
      openDrawer: (drawer, opts = {}) => {
        // Before any card turns inert: the element that asked is where focus returns on close.
        if (get().drawer !== drawer) noteOpener(`drawer:${drawer}`);
        set((s) => ({
          drawer,
          explainTab: opts.tab ?? s.explainTab,
          focusField: drawer === 'inputs' ? (opts.field ?? null) : null,
          inputsSection: drawer === 'inputs' ? (opts.section ?? null) : null,
          ...(s.chrome === 'focus' ? { chrome: 'workstation' as const } : null),
        }));
      },
      closeDrawer: () => set(CLOSED_DRAWER),
      toggleDrawer: (drawer, opts) => {
        if (get().drawer === drawer) get().closeDrawer();
        else get().openDrawer(drawer, opts);
      },
      setExplainTab: (explainTab) => set({ explainTab }),
      setFocusField: (focusField) => set({ focusField }),
      setPatientCardOpen: (patientCardOpen) => set({ patientCardOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setStageInsets: (insets, base = insets) => {
        const s = get();
        const patch: Partial<Pick<UiState, 'stageInsets' | 'stageInsetsBase'>> = {};
        if (!sameInsets(s.stageInsets, insets)) patch.stageInsets = { ...insets };
        if (!sameInsets(s.stageInsetsBase, base)) patch.stageInsetsBase = { ...base };
        if (patch.stageInsets || patch.stageInsetsBase) set(patch);
      },
      setHintSeen: (hintSeen = true) => set({ hintSeen }),
    }),
    {
      name: 'cardiotwin.ui',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({
        disclaimerAccepted: s.disclaimerAccepted,
        tourCompleted: s.tourCompleted,
        patientCardOpen: s.patientCardOpen,
        hintSeen: s.hintSeen,
      }),
    },
  ),
);
