import {
  Activity,
  BookOpenText,
  Box,
  Crosshair,
  Expand,
  EyeOff,
  Focus,
  Heart,
  Home,
  Layers,
  MessageSquareText,
  Palette,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Tags,
  Video,
  Waves,
} from 'lucide-react';
import { ESCAPE_PRIORITY, useEscapeLayer } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { useUiStore, type ExplainTab } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { PROJECTIONS, cycleProjection } from '@/three/camera/presets';

const EXPLAIN_TABS: { tab: ExplainTab; title: string; subtitle: string; keywords: string[]; icon: typeof Activity }[] = [
  { tab: 'why', title: 'Why', subtitle: 'What raises and lowers the estimate', keywords: ['shap', 'drivers', 'evidence'], icon: MessageSquareText },
  { tab: 'whatif', title: 'What-if', subtitle: 'Recorded versus edited inputs', keywords: ['compare', 'levers', 'counterfactual'], icon: SlidersHorizontal },
  { tab: 'physiology', title: 'Physiology', subtitle: 'Values outside the normal range', keywords: ['labs', 'reference', 'abnormal'], icon: Activity },
  { tab: 'model', title: 'Model', subtitle: 'How this estimate is made', keywords: ['auc', 'threshold', 'calibration', 'engine'], icon: BookOpenText },
];

function toggleFullscreen() {
  // Full screen applies to the app container, so the status line stays visible (LUMEN §9).
  if (document.fullscreenElement) void document.exitFullscreen?.();
  else void document.getElementById('app')?.requestFullscreen?.();
}

const lastPreset = () => {
  const cmd = useViewerStore.getState().cameraCommand;
  return cmd?.kind === 'preset' && cmd.preset && PROJECTIONS.some((p) => p.id === cmd.preset) ? cmd.preset : null;
};

/**
 * Workstation commands and the lower half of the Esc chain (WORKSTATION_V2 §4.10).
 *
 * The vessel, view and layer commands in `interim` are fallbacks (priority −1): the owners (C: vessels,
 * D: views and layers) register the same ids from `CMD` at priority 0 and replace them. Isolate and ghost
 * (O, G) and the Esc layers are A's: isolate/ghost → selection → focus mode, below palette, menus and
 * drawers.
 */
export function useWorkstationCommands(): void {
  const index = useSchemaIndex();
  const selected = useViewerStore((s) => s.selectedStructure);
  const isolate = useViewerStore((s) => s.isolate);
  const ghostOthers = useViewerStore((s) => s.ghostOthers);
  const chrome = useUiStore((s) => s.chrome);
  const vessels = index?.vessels ?? [];
  const viewer = () => useViewerStore.getState();

  const interim: Command[] = [
    ...vessels.slice(0, SHORTCUT.vessels.length).map(
      (v, i): Command => ({
        id: CMD.selectVessel(v.id),
        group: 'vessels',
        title: `Focus ${v.id}`,
        subtitle: v.label,
        keywords: [v.id, v.label],
        shortcut: SHORTCUT.vessels[i],
        icon: Crosshair,
        run: () => viewer().select(v.id),
      }),
    ),
    ...vessels.map(
      (v): Command => ({
        id: CMD.explainVessel(v.id),
        group: 'vessels',
        title: `Explain ${v.id}`,
        subtitle: 'Why this vessel is flagged or not',
        keywords: [v.id, v.label, 'why', 'shap'],
        icon: MessageSquareText,
        run: () => {
          viewer().select(v.id);
          useUiStore.getState().openDrawer('explain', { tab: 'why' });
        },
      }),
    ),
    ...EXPLAIN_TABS.map(
      ({ tab, title, subtitle, keywords, icon }): Command => ({
        id: CMD.explainTab(tab),
        group: 'actions',
        title: `Explain › ${title}`,
        subtitle,
        keywords,
        icon,
        run: () => useUiStore.getState().openDrawer('explain', { tab }),
      }),
    ),
    ...PROJECTIONS.map(
      (p): Command => ({
        id: CMD.projection(p.id),
        group: 'views',
        title: `View ${p.label}`,
        subtitle: 'C-arm projection',
        keywords: [p.id, p.label.replace(/\s+/g, ''), 'projection', 'angle', 'c-arm'],
        icon: Video,
        run: () => viewer().flyToPreset(p.id),
      }),
    ),
    {
      id: CMD.look('clay'),
      group: 'views',
      title: 'Look: Clay',
      subtitle: 'Neutral myocardium; only the vessels carry colour',
      keywords: ['material', 'look', 'matte'],
      icon: Box,
      run: () => viewer().set('look', 'clay'),
    },
    {
      id: CMD.look('anat'),
      group: 'views',
      title: 'Look: Anatomical',
      subtitle: 'Tissue colours',
      keywords: ['material', 'look', 'realistic', 'flesh'],
      icon: Palette,
      run: () => viewer().set('look', 'anat'),
    },
    {
      id: CMD.fullscreen,
      group: 'views',
      title: 'Full screen',
      keywords: ['fullscreen', 'presentation', 'maximise'],
      icon: Expand,
      run: toggleFullscreen,
    },
    {
      id: CMD.home,
      group: 'views',
      title: 'Home view',
      subtitle: 'Clears the selection',
      shortcut: SHORTCUT.home,
      icon: Home,
      run: () => viewer().flyHome(),
    },
    {
      id: CMD.projectionPrev,
      group: 'views',
      title: 'Previous projection',
      keywords: ['view', 'angle', 'lao', 'rao'],
      shortcut: SHORTCUT.projectionPrev,
      icon: SkipBack,
      run: () => viewer().flyToPreset(cycleProjection(lastPreset(), -1).id),
    },
    {
      id: CMD.projectionNext,
      group: 'views',
      title: 'Next projection',
      keywords: ['view', 'angle', 'lao', 'rao'],
      shortcut: SHORTCUT.projectionNext,
      icon: SkipForward,
      run: () => viewer().flyToPreset(cycleProjection(lastPreset(), 1).id),
    },
    { id: CMD.beat, group: 'views', title: 'Heartbeat', shortcut: SHORTCUT.beat, icon: Heart, run: () => viewer().toggle('heartbeat') },
    {
      id: CMD.flow,
      group: 'views',
      title: 'Coronary flow',
      subtitle: 'Illustrative',
      shortcut: SHORTCUT.flow,
      icon: Waves,
      run: () => viewer().toggle('bloodFlow'),
    },
    {
      id: CMD.territories,
      group: 'views',
      title: 'Territories',
      subtitle: 'Off · Selected · All',
      keywords: ['territory', 'tint', 'myocardium'],
      shortcut: SHORTCUT.territories,
      icon: Layers,
      run: () => viewer().cycleTerritoryMode(),
    },
    { id: CMD.labels, group: 'views', title: 'Labels', shortcut: SHORTCUT.labels, icon: Tags, run: () => viewer().toggle('labels') },
  ];

  useRegisterCommands('workstation.interim', interim, [index, selected], { priority: -1 });

  // Isolate and ghost are the selection's verbs (V2 §4.10, "New, selection only"); they exist only while
  // a vessel is selected, and Esc undoes them before it clears the selection (the Esc layers below).
  const selection: Command[] = [
    {
      id: CMD.isolate,
      group: 'views',
      title: selected ? (isolate ? 'Show everything again' : `Isolate ${selected}`) : 'Isolate the selected vessel',
      subtitle: 'Heart, the artery and its territory only',
      keywords: ['isolate', 'solo', 'hide others'],
      shortcut: SHORTCUT.isolate,
      icon: Focus,
      when: () => viewer().selectedStructure !== null,
      run: () => viewer().setIsolate(!viewer().isolate),
    },
    {
      id: CMD.ghost,
      group: 'views',
      title: selected ? (ghostOthers ? 'Solid anatomy again' : `Ghost everything but ${selected}`) : 'Ghost other structures',
      subtitle: 'Fade the other structures to glass',
      keywords: ['ghost', 'x-ray', 'transparent', 'fade'],
      shortcut: SHORTCUT.ghost,
      icon: EyeOff,
      when: () => viewer().selectedStructure !== null,
      run: () => viewer().setGhostOthers(!viewer().ghostOthers),
    },
  ];
  useRegisterCommands('workstation.selection', selection, [selected, isolate, ghostOthers]);

  useEscapeLayer(
    isolate || ghostOthers,
    () => {
      viewer().setIsolate(false);
      viewer().setGhostOthers(false);
    },
    ESCAPE_PRIORITY.isolate,
  );
  useEscapeLayer(selected !== null, () => viewer().select(null), ESCAPE_PRIORITY.selection);
  useEscapeLayer(chrome === 'focus', () => useUiStore.getState().setChrome('workstation'), ESCAPE_PRIORITY.focus);
}
