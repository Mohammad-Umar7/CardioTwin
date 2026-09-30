/**
 * Scene controls owned by the 3D layer (a small documented store, see DESIGN_SYSTEM §7.9) plus a
 * normalised read of the viewer store.
 *
 * - LOOK. `viewerStore.look` stays the single source of truth; `'anat'` means **Realistic** (the upgraded
 *   anatomical look) and `'clay'` means **Clinical** (LUMEN clay). Realistic is the default: the first
 *   scene mount switches an untouched store to it once (`ensureRealisticDefault`). Future values
 *   `'realistic' | 'clinical'` are understood too, so the store type can be widened without touching us.
 * - SECTION. A clipping plane through the heart along the manifest's cut plane (`section`, `sectionDepth`).
 * - FALLBACKS for Wave-0 viewer fields (`territoryMode`, `isolate`, `ghostOthers`): when the viewer store
 *   carries them they win; until then these local fields drive the scene, so the toolbar can already bind.
 * - REPLAY. `replayAssembly()` re-runs the cold-load assembly (for the tour / a "rebuild" button).
 */
import { create } from 'zustand';
import { useViewerStore } from '@/state/viewerStore';

export type SceneLook = 'realistic' | 'clinical';
export type TerritoryMode = 'off' | 'selected' | 'all';

export interface SceneControlsState {
  /** Clipping plane through the heart (cut plane of the two halves). */
  section: boolean;
  /** Offset of the section plane along its normal, scene units (0 = the anatomical cut plane). */
  sectionDepth: number;
  /** Local fallbacks until the viewer store has them (V2 §9.2 Wave 0). */
  territoryMode: TerritoryMode;
  isolate: boolean;
  ghostOthers: boolean;
  /** Cardiac veins (hidden by default; "not modelled"). */
  showVeins: boolean;
  /** Bumped to replay the cold-load assembly. */
  assemblyNonce: number;

  setSection(on: boolean): void;
  setSectionDepth(depth: number): void;
  setTerritoryMode(mode: TerritoryMode): void;
  setIsolate(on: boolean): void;
  setGhostOthers(on: boolean): void;
  setShowVeins(on: boolean): void;
  replayAssembly(): void;
}

export const useSceneControls = create<SceneControlsState>()((set) => ({
  section: false,
  sectionDepth: 0,
  territoryMode: 'selected',
  isolate: false,
  ghostOthers: false,
  showVeins: false,
  assemblyNonce: 0,
  setSection: (section) => set({ section }),
  setSectionDepth: (sectionDepth) => set({ sectionDepth: Math.max(-0.6, Math.min(0.6, sectionDepth)) }),
  setTerritoryMode: (territoryMode) => set({ territoryMode }),
  setIsolate: (isolate) => set(isolate ? { isolate, ghostOthers: false } : { isolate }),
  setGhostOthers: (ghostOthers) => set(ghostOthers ? { ghostOthers, isolate: false } : { ghostOthers }),
  setShowVeins: (showVeins) => set({ showVeins }),
  replayAssembly: () => set((s) => ({ assemblyNonce: s.assemblyNonce + 1 })),
}));

/** Realistic unless the store explicitly says clay / clinical. */
export function lookOf(storeLook: unknown): SceneLook {
  return storeLook === 'clay' || storeLook === 'clinical' ? 'clinical' : 'realistic';
}

/** Store value that selects a look (the store type is `'clay' | 'anat'` today). */
export const storeValueFor = (look: SceneLook) => (look === 'realistic' ? 'anat' : 'clay') as 'anat' | 'clay';

/** Human names for the Look menu (§7.9): Realistic first, as the primary option. */
export const LOOK_OPTIONS: readonly { value: SceneLook; label: string; hint: string }[] = [
  { value: 'realistic', label: 'Realistic', hint: 'Wet tissue, subsurface light, anatomical colour' },
  { value: 'clinical', label: 'Clinical', hint: 'Achromatic clay: only risk carries colour' },
];

let defaulted = false;
/** Switch an untouched store to Realistic once per page load (the store's own default is clay). */
export function ensureRealisticDefault(): void {
  if (defaulted) return;
  defaulted = true;
  const v = useViewerStore.getState();
  if (v.look === 'clay') v.set('look', 'anat');
}

/** Test hook. */
export function resetRealisticDefault(): void {
  defaulted = false;
}

export interface SceneRead {
  look: SceneLook;
  territoryMode: TerritoryMode;
  isolate: boolean;
  ghostOthers: boolean;
}

/** Normalised view of viewer + local controls; prefers the viewer store's Wave-0 fields when present. */
export function readScene(): SceneRead {
  const v = useViewerStore.getState() as ReturnType<typeof useViewerStore.getState> & {
    territoryMode?: TerritoryMode;
    isolate?: boolean;
    ghostOthers?: boolean;
  };
  const c = useSceneControls.getState();
  const territoryMode = v.territoryMode ?? (v.territories ? c.territoryMode : 'off');
  return {
    look: lookOf(v.look),
    territoryMode,
    isolate: v.isolate ?? c.isolate,
    ghostOthers: v.ghostOthers ?? c.ghostOthers,
  };
}
