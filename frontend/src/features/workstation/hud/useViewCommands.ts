import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Expand,
  Eye,
  EyeOff,
  FoldHorizontal,
  Gauge,
  Heart,
  Home,
  Layers,
  Orbit,
  Palette,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  SkipBack,
  SkipForward,
  Tags,
  UnfoldHorizontal,
  Video,
  Waves,
} from 'lucide-react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { PEEL_REST, TERRITORY_MODES, useViewerStore, type TerritoryMode } from '@/state/viewerStore';
import { useCameraState } from '@/three/camera/cameraState';
import { PROJECTIONS, cycleProjection } from '@/three/camera/presets';
import { LOOK_OPTIONS, lookOf, storeValueFor, useSceneControls } from '@/three/stage/sceneControls';
import { ANATOMY_LAYERS, layerVisible, resetLayers } from './layers';
import { DETENTS, OPEN_AT, usePeelPlayer } from './peel';
import { QUALITY_OPTIONS, setQuality } from './quality';

/** Ids of D's view commands beyond the canonical ones in `state/commandIds` (stable for recents). */
export const VIEW_CMD = {
  projection: (id: string) => `view.projection.${id}`,
  peelTo: (id: string) => `view.peel.${id}`,
  territory: (mode: TerritoryMode) => `view.territories.${mode}`,
  look: (look: string) => `view.look.${look}`,
  layer: (id: string) => `view.layer.${id}`,
  ghostLayers: 'view.layers.ghost',
  resetLayers: 'view.layers.reset',
  quality: (q: string) => `view.quality.${q}`,
  freeOrbit: 'view.orbit.free',
  back: 'view.camera.back',
  forward: 'view.camera.forward',
  frame: 'view.frame',
  replayAssembly: 'view.assembly.replay',
} as const;

const TERRITORY_TITLE: Record<TerritoryMode, string> = {
  off: 'Territories: off',
  selected: 'Territories: selected vessel only',
  all: 'Territories: all three',
};

/** The current projection preset, for `[` `]` (null after a free orbit or a best view). */
const currentPreset = () => {
  const cam = useCameraState.getState();
  return cam.viewKind === 'preset' ? cam.presetId : null;
};

/**
 * View and layer commands (WORKSTATION_V2 §4.9, §4.10, §9.3 D): projections, home, peel detents, dissect,
 * layers, look, territories, labels, beat, flow, quality, free orbit, camera history and framing. They use
 * the canonical `CMD` ids at priority 0, replacing the workstation's interim registrations, so the
 * palette, the global keys, the shortcut sheet and the toolbar tooltips all print the same thing.
 */
export function useViewCommands(): void {
  const reduced = useIsReducedMotion();
  const selected = useViewerStore((s) => s.selectedStructure);
  const heartbeat = useViewerStore((s) => s.heartbeat);
  const flow = useViewerStore((s) => s.bloodFlow);
  const labels = useViewerStore((s) => s.labels);
  const look = useViewerStore((s) => s.look);
  const territoryMode = useViewerStore((s) => s.territoryMode);
  const visibility = useViewerStore((s) => s.layerVisibility);
  const ghostLayers = useViewerStore((s) => s.ghostLayers);
  const stage = useViewerStore((s) => s.stage);
  const open = useViewerStore((s) => s.explode >= OPEN_AT);
  // ▶ Explode from the heart view opens the heart directly; only from a closed chest does it dissect first.
  const chestClosed = useViewerStore((s) => s.explode < PEEL_REST - 0.02);
  const freeOrbit = useCameraState((s) => s.freeOrbit);
  const viewer = () => useViewerStore.getState();

  const commands: Command[] = [
    {
      id: CMD.home,
      group: 'views',
      title: 'Home view',
      subtitle: 'Clears the selection',
      keywords: ['reset view', 'centre', 'heart'],
      shortcut: SHORTCUT.home,
      icon: Home,
      run: () => viewer().flyHome(),
    },
    {
      id: CMD.projectionPrev,
      group: 'views',
      title: 'Previous projection',
      keywords: ['view', 'angle', 'c-arm', 'lao', 'rao'],
      shortcut: SHORTCUT.projectionPrev,
      icon: SkipBack,
      run: () => viewer().flyToPreset(cycleProjection(currentPreset(), -1).id),
    },
    {
      id: CMD.projectionNext,
      group: 'views',
      title: 'Next projection',
      keywords: ['view', 'angle', 'c-arm', 'lao', 'rao'],
      shortcut: SHORTCUT.projectionNext,
      icon: SkipForward,
      run: () => viewer().flyToPreset(cycleProjection(currentPreset(), 1).id),
    },
    ...PROJECTIONS.map(
      (p): Command => ({
        id: VIEW_CMD.projection(p.id),
        group: 'views',
        title: `View: ${p.label}`,
        subtitle: 'C-arm projection',
        keywords: ['projection', 'angle', 'c-arm', p.id, p.label.replace(/\s/g, '')],
        icon: Video,
        run: () => viewer().flyToPreset(p.id),
      }),
    ),
    {
      id: VIEW_CMD.frame,
      group: 'views',
      title: selected ? `Frame ${selected}` : 'Frame the selection',
      subtitle: 'Double-click a vessel',
      keywords: ['zoom', 'focus', 'best view'],
      icon: Crosshair,
      when: () => viewer().selectedStructure !== null,
      run: () => {
        const t = viewer().selectedStructure;
        if (t) viewer().focusTarget(t);
      },
    },
    {
      id: CMD.peel,
      group: 'views',
      title: open ? 'Assemble the heart' : 'Explode the heart',
      subtitle: open ? 'Close the heart' : chestClosed ? 'Skin, ribs, lungs, then open the heart' : 'Separate the heart and open it',
      keywords: ['peel', 'exploded view', 'explode', 'open heart', 'dissection', 'assemble'],
      shortcut: SHORTCUT.peel,
      icon: open ? FoldHorizontal : UnfoldHorizontal,
      run: () => usePeelPlayer.getState().toggle(reduced),
    },
    ...DETENTS.map(
      (d): Command => ({
        id: VIEW_CMD.peelTo(d.id),
        group: 'views',
        title: `Peel: ${d.label}`,
        keywords: ['peel', 'explode', 'dissect', 'layers'],
        icon: ScanLine,
        run: () => {
          usePeelPlayer.getState().stop();
          viewer().setExplode(d.value);
        },
      }),
    ),
    {
      id: CMD.territories,
      group: 'views',
      title: 'Cycle territories',
      subtitle: 'Off · Selected · All',
      keywords: ['territory', 'tint', 'myocardium', 'perfusion'],
      shortcut: SHORTCUT.territories,
      icon: Layers,
      run: () => viewer().cycleTerritoryMode(),
    },
    ...TERRITORY_MODES.filter((m) => m !== territoryMode).map(
      (m): Command => ({
        id: VIEW_CMD.territory(m),
        group: 'views',
        title: TERRITORY_TITLE[m],
        keywords: ['territory', 'tint', 'myocardium'],
        icon: Layers,
        run: () => viewer().setTerritoryMode(m),
      }),
    ),
    {
      id: CMD.labels,
      group: 'views',
      title: labels ? 'Hide vessel labels' : 'Show vessel labels',
      keywords: ['labels', 'names', 'annotations'],
      shortcut: SHORTCUT.labels,
      icon: Tags,
      run: () => viewer().toggle('labels'),
    },
    {
      id: CMD.beat,
      group: 'views',
      title: heartbeat ? 'Stop the heartbeat' : 'Start the heartbeat',
      subtitle: "At the patient's pulse",
      keywords: ['beat', 'pulse', 'animation', 'heart rate'],
      shortcut: SHORTCUT.beat,
      icon: Heart,
      run: () => viewer().toggle('heartbeat'),
    },
    {
      id: CMD.flow,
      group: 'views',
      title: flow ? 'Hide coronary flow' : 'Show coronary flow',
      subtitle: 'Illustrative',
      keywords: ['flow', 'blood', 'particles'],
      shortcut: SHORTCUT.flow,
      icon: Waves,
      run: () => viewer().toggle('bloodFlow'),
    },
    ...LOOK_OPTIONS.filter((o) => o.value !== lookOf(look)).map(
      (o): Command => ({
        id: VIEW_CMD.look(o.value),
        group: 'views',
        title: `Look: ${o.label}`,
        subtitle: o.hint,
        keywords: ['look', 'material', 'clay', 'anatomical', 'realistic', 'clinical'],
        icon: Palette,
        run: () => viewer().set('look', storeValueFor(o.value)),
      }),
    ),
    ...ANATOMY_LAYERS.map((l): Command => {
      const on = layerVisible(l.id, visibility, stage);
      return {
        id: VIEW_CMD.layer(l.id),
        group: 'views',
        title: `${on ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`,
        subtitle: 'Anatomy layer',
        keywords: ['layer', l.id, l.label],
        icon: on ? EyeOff : Eye,
        run: () => viewer().setLayerVisible(l.id, !layerVisible(l.id, viewer().layerVisibility, viewer().stage)),
      };
    }),
    {
      id: VIEW_CMD.ghostLayers,
      group: 'views',
      title: ghostLayers ? 'Hide removed layers completely' : 'Ghost removed layers',
      keywords: ['ghost', 'layers', 'transparent'],
      icon: Layers,
      run: () => viewer().toggle('ghostLayers'),
    },
    {
      id: VIEW_CMD.resetLayers,
      group: 'views',
      title: 'Reset layers',
      keywords: ['layers', 'default'],
      icon: RotateCcw,
      run: resetLayers,
    },
    ...QUALITY_OPTIONS.map(
      (q): Command => ({
        id: VIEW_CMD.quality(q.value),
        group: 'views',
        title: `Quality: ${q.label}`,
        subtitle: q.value === 'auto' ? 'Adapts to the frame rate' : `Render ${q.hint}`,
        keywords: ['quality', 'performance', 'tier', 'fps'],
        icon: Gauge,
        run: () => setQuality(q.value),
      }),
    ),
    {
      id: VIEW_CMD.freeOrbit,
      group: 'views',
      title: freeOrbit ? 'Clamp the orbit' : 'Free orbit',
      subtitle: freeOrbit ? 'Keep the heart in view' : 'Unclamped angles and zoom',
      keywords: ['orbit', 'rotate', 'unlock', 'camera'],
      icon: Orbit,
      run: () => useCameraState.getState().setFreeOrbit(!useCameraState.getState().freeOrbit),
    },
    {
      id: VIEW_CMD.back,
      group: 'views',
      title: 'Camera back',
      subtitle: 'Previous view',
      keywords: ['history', 'undo view'],
      icon: ArrowLeft,
      when: () => useCameraState.getState().canBack,
      run: () => useCameraState.getState().back(),
    },
    {
      id: VIEW_CMD.forward,
      group: 'views',
      title: 'Camera forward',
      subtitle: 'Next view',
      keywords: ['history', 'redo view'],
      icon: ArrowRight,
      when: () => useCameraState.getState().canForward,
      run: () => useCameraState.getState().forward(),
    },
    {
      id: VIEW_CMD.replayAssembly,
      group: 'views',
      title: 'Replay the assembly',
      subtitle: 'Rebuild the heart from its parts',
      keywords: ['assembly', 'intro', 'animation', 'rebuild'],
      icon: RefreshCcw,
      run: () => useSceneControls.getState().replayAssembly(),
    },
    {
      id: 'view.fullscreen',
      group: 'views',
      title: 'Full screen',
      keywords: ['fullscreen', 'present', 'projector'],
      icon: Expand,
      run: () => {
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else void (document.getElementById('app') ?? document.documentElement).requestFullscreen?.();
      },
    },
  ];

  useRegisterCommands('hud.view', commands, [
    selected,
    heartbeat,
    flow,
    labels,
    look,
    territoryMode,
    visibility,
    ghostLayers,
    stage,
    open,
    chestClosed,
    freeOrbit,
    reduced,
  ]);
}
