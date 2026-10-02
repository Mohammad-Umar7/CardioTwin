/**
 * 3D viewer state shared by the canvas, the HUD and the dashboard panels.
 *
 * Per-frame values (damped probabilities, camera angles) never live here: the scene animates them
 * through refs in useFrame. This store only holds discrete, user-meaningful state.
 */
import { create } from 'zustand';
import type { CameraPose, TargetId } from '@/types/contracts';

export type ViewMode = 'anatomy' | 'risk' | 'xray' | 'flow';
/** Render quality tier (DESIGN_SYSTEM §7.7): A full, B balanced (start), C lite, D static 2D fallback. */
export type RenderTier = 'A' | 'B' | 'C' | 'D';
/** Which page currently hosts the persistent canvas. */
export type Stage = 'hero' | 'workstation' | 'hidden';
export type MyocardiumLook = 'clay' | 'anat';
export type AnatomySource = 'loading' | 'glb' | 'procedural' | 'error';

/**
 * Territory tint (V2 §2, §5.15): off · only the selected vessel's territory (default) · all three.
 * The legacy `territories` boolean is kept in sync (= mode !== 'off') until every reader migrates.
 */
export type TerritoryMode = 'off' | 'selected' | 'all';
export const TERRITORY_MODES: readonly TerritoryMode[] = ['off', 'selected', 'all'];

/** Layer ids match `manifest.layers[].id`; unknown layers default to visible. */
export type LayerVisibility = Record<string, boolean>;

export const PEEL_REST = 0.6;

export interface CameraCommand {
  kind: 'home' | 'preset' | 'focus';
  /** Projection preset id (e.g. 'AP', 'LAO45') for kind 'preset'. */
  preset?: string;
  /** Target to fly to for kind 'focus'. */
  target?: TargetId;
  /** Monotonic id so repeating the same command re-triggers it. */
  nonce: number;
}

export interface ViewerState {
  viewMode: ViewMode;
  /** Peel scalar e ∈ [0, 1]; rest state 0.60 ("lungs aside"). */
  explode: number;
  /** Selected vessel target (also drives the WHY tab); null = whole heart / CAD. */
  selectedStructure: TargetId | null;
  hoveredStructure: TargetId | null;
  layerVisibility: LayerVisibility;
  heartbeat: boolean;
  bloodFlow: boolean;
  territories: boolean;
  labels: boolean;
  ghostLayers: boolean;
  /** Landing turntable only; never on in the workstation. */
  autoRotate: boolean;
  look: MyocardiumLook;
  /** In-app Calm mode (reduced motion), toggled with key C. */
  calm: boolean;
  tier: RenderTier;
  /** True once the user or a hard limit chose the tier; the performance monitor stops switching. */
  tierLocked: boolean;
  fps: number | null;
  stage: Stage;
  anatomySource: AnatomySource;
  /** Bytes of the GLB loaded so far / total, while loading. */
  anatomyProgress: { loaded: number; total: number } | null;
  /**
   * The loaded anatomy's shader programs are compiling (stage/warmup.ts): the canvas renders no frames until they
   * are ready, so no frame ever waits on a compile. `warmProgress` is the share ready, 0..1.
   */
  warming: boolean;
  warmProgress: number | null;
  cameraCommand: CameraCommand | null;
  /** Live C-arm readout, updated at most a few times per second by the camera rig. */
  carm: { azimuth: number; elevation: number } | null;
  /** V2: territory tint mode; `territories` mirrors `territoryMode !== 'off'`. */
  territoryMode: TerritoryMode;
  /** V2 (O): heart + the selected artery + its territory only. Only meaningful while a vessel is selected. */
  isolate: boolean;
  /** V2 (G): ghost every structure except the selected vessel. Only meaningful while a vessel is selected. */
  ghostOthers: boolean;
  /** V2: camera pose before select / isolate, so Esc can fly back (set by the camera rig). */
  cameraReturn: CameraPose | null;

  setViewMode(mode: ViewMode): void;
  setExplode(e: number): void;
  select(target: TargetId | null): void;
  hover(target: TargetId | null): void;
  setLayerVisible(layer: string, visible: boolean): void;
  toggle(key: 'heartbeat' | 'bloodFlow' | 'territories' | 'labels' | 'ghostLayers' | 'autoRotate' | 'calm'): void;
  set<K extends keyof ViewerSettable>(key: K, value: ViewerSettable[K]): void;
  setTier(tier: RenderTier, lock?: boolean): void;
  /** Quality "Auto": clears the lock so the performance monitor may move the tier again. */
  unlockTier(): void;
  setFps(fps: number | null): void;
  setStage(stage: Stage): void;
  setAnatomySource(source: AnatomySource, progress?: { loaded: number; total: number } | null): void;
  setWarming(warming: boolean, progress?: number | null): void;
  flyHome(): void;
  flyToPreset(preset: string): void;
  focusTarget(target: TargetId): void;
  setCarm(carm: { azimuth: number; elevation: number } | null): void;
  setTerritoryMode(mode: TerritoryMode): void;
  /** T: off → selected → all → off. */
  cycleTerritoryMode(): void;
  /** Ignored (stays false) while nothing is selected. */
  setIsolate(on: boolean): void;
  /** Ignored (stays false) while nothing is selected. */
  setGhostOthers(on: boolean): void;
  setCameraReturn(pose: CameraPose | null): void;
}

type ViewerSettable = Pick<
  ViewerState,
  'heartbeat' | 'bloodFlow' | 'territories' | 'labels' | 'ghostLayers' | 'autoRotate' | 'calm' | 'look'
>;

let nonce = 0;
const nextNonce = () => (nonce += 1);

/** Isolate and ghost exist only while a vessel is selected (V2 §1.7), so clearing the selection ends them. */
const CLEARED_SELECTION_MODES = { isolate: false, ghostOthers: false } as const;

const territoryPatch = (territoryMode: TerritoryMode): Pick<ViewerState, 'territoryMode' | 'territories'> => ({
  territoryMode,
  territories: territoryMode !== 'off',
});

export const useViewerStore = create<ViewerState>()((set) => ({
  viewMode: 'risk',
  explode: PEEL_REST,
  selectedStructure: null,
  hoveredStructure: null,
  layerVisibility: {},
  heartbeat: true,
  bloodFlow: true,
  territories: true,
  labels: true,
  ghostLayers: true,
  autoRotate: false,
  look: 'clay',
  calm: false,
  tier: 'B',
  tierLocked: false,
  fps: null,
  stage: 'hidden',
  anatomySource: 'loading',
  anatomyProgress: null,
  warming: false,
  warmProgress: null,
  cameraCommand: null,
  carm: null,
  territoryMode: 'selected',
  isolate: false,
  ghostOthers: false,
  cameraReturn: null,

  setViewMode: (viewMode) => set({ viewMode }),
  setExplode: (e) => set({ explode: Math.min(1, Math.max(0, e)) }),
  select: (target) =>
    set(() =>
      target
        ? { selectedStructure: target, cameraCommand: { kind: 'focus', target, nonce: nextNonce() } }
        : { selectedStructure: null, ...CLEARED_SELECTION_MODES },
    ),
  hover: (hoveredStructure) => set({ hoveredStructure }),
  setLayerVisible: (layer, visible) =>
    set((s) => ({ layerVisibility: { ...s.layerVisibility, [layer]: visible } })),
  toggle: (key) =>
    set((s) =>
      key === 'territories'
        ? territoryPatch(s.territories ? 'off' : 'selected')
        : ({ [key]: !s[key] } as Partial<ViewerState>),
    ),
  set: (key, value) =>
    set((s) =>
      key === 'territories'
        ? territoryPatch(value ? (s.territoryMode === 'off' ? 'selected' : s.territoryMode) : 'off')
        : ({ [key]: value } as Partial<ViewerState>),
    ),
  setTier: (tier, lock = false) => set((s) => ({ tier, tierLocked: lock || s.tierLocked })),
  unlockTier: () => set({ tierLocked: false }),
  setFps: (fps) => set({ fps }),
  setStage: (stage) => set({ stage }),
  setAnatomySource: (anatomySource, anatomyProgress = null) => set({ anatomySource, anatomyProgress }),
  setWarming: (warming, warmProgress = null) => set({ warming, warmProgress: warming ? warmProgress : null }),
  flyHome: () =>
    set({ cameraCommand: { kind: 'home', nonce: nextNonce() }, selectedStructure: null, ...CLEARED_SELECTION_MODES }),
  flyToPreset: (preset) => set({ cameraCommand: { kind: 'preset', preset, nonce: nextNonce() } }),
  focusTarget: (target) =>
    set({ selectedStructure: target, cameraCommand: { kind: 'focus', target, nonce: nextNonce() } }),
  setCarm: (carm) => set({ carm }),
  setTerritoryMode: (mode) => set(territoryPatch(mode)),
  cycleTerritoryMode: () =>
    set((s) => territoryPatch(TERRITORY_MODES[(TERRITORY_MODES.indexOf(s.territoryMode) + 1) % TERRITORY_MODES.length]!)),
  setIsolate: (on) => set((s) => ({ isolate: on && s.selectedStructure !== null })),
  setGhostOthers: (on) => set((s) => ({ ghostOthers: on && s.selectedStructure !== null })),
  setCameraReturn: (cameraReturn) => set({ cameraReturn }),
}));
