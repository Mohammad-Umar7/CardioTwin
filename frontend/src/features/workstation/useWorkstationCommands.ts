import { Crosshair, EyeOff, Focus, Heart, Home, Layers, SkipBack, SkipForward, Tags, Waves } from 'lucide-react';
import { ESCAPE_PRIORITY, useEscapeLayer } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { PROJECTIONS, cycleProjection } from '@/three/camera/presets';

const lastPreset = () => {
  const cmd = useViewerStore.getState().cameraCommand;
  return cmd?.kind === 'preset' && cmd.preset && PROJECTIONS.some((p) => p.id === cmd.preset) ? cmd.preset : null;
};

/**
 * Workstation commands and the lower half of the Esc chain (WORKSTATION_V2 §4.10).
 *
 * The vessel, view and layer commands here are INTERIM (priority −1): they keep the existing keys working
 * until their owners (C: vessels, D: views and layers) register the same ids from `CMD` at priority 0.
 * The Esc layers are A's: isolate/ghost → selection → focus mode, below palette, menus and drawers.
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
    {
      id: CMD.isolate,
      group: 'views',
      title: selected ? `Isolate ${selected}` : 'Isolate the selected vessel',
      shortcut: SHORTCUT.isolate,
      icon: Focus,
      when: () => viewer().selectedStructure !== null,
      run: () => viewer().setIsolate(!viewer().isolate),
    },
    {
      id: CMD.ghost,
      group: 'views',
      title: 'Ghost other structures',
      shortcut: SHORTCUT.ghost,
      icon: EyeOff,
      when: () => viewer().selectedStructure !== null,
      run: () => viewer().setGhostOthers(!viewer().ghostOthers),
    },
  ];

  useRegisterCommands('workstation.interim', interim, [index, selected], { priority: -1 });

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
