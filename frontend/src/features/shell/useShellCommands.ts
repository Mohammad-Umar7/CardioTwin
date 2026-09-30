import {
  BookOpen,
  Home,
  Keyboard,
  LayoutDashboard,
  LineChart,
  Maximize2,
  MessageSquareText,
  PencilLine,
  PlayCircle,
  Search,
  Wind,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { ROUTES, loadWorkstation } from '@/routes';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

/**
 * App-level commands (agent A): palette, shortcut sheet, calm mode, focus mode, the two drawers and the
 * pages. The guided demo is registered here as an interim command (priority −1) until the tour owns it.
 */
export function useShellCommands(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onWorkstation = pathname.startsWith(ROUTES.workstation);

  const ui = () => useUiStore.getState();
  const go = (to: string) => () => navigate(to);

  const shell: Command[] = [
    {
      id: CMD.paletteOpen,
      group: 'actions',
      title: 'Command palette',
      shortcut: SHORTCUT.palette,
      icon: Search,
      run: () => ui().setPaletteOpen(!ui().paletteOpen),
    },
    {
      id: CMD.inputsDrawer,
      group: 'actions',
      title: 'Edit inputs',
      subtitle: 'All clinical inputs',
      keywords: ['inputs', 'form', 'what if', 'change'],
      shortcut: SHORTCUT.inputs,
      icon: PencilLine,
      when: () => onWorkstation,
      run: () => ui().toggleDrawer('inputs'),
    },
    {
      id: CMD.explainDrawer,
      group: 'actions',
      title: 'Explain',
      subtitle: 'Why, what-if, physiology, model',
      keywords: ['shap', 'why', 'evidence', 'drivers'],
      shortcut: SHORTCUT.explain,
      icon: MessageSquareText,
      when: () => onWorkstation,
      run: () => ui().toggleDrawer('explain'),
    },
    {
      id: CMD.focusMode,
      group: 'views',
      title: 'Focus mode',
      subtitle: 'Hide the cards',
      keywords: ['fullscreen', 'zen', 'hide ui'],
      shortcut: SHORTCUT.focusMode,
      icon: Maximize2,
      when: () => onWorkstation,
      run: () => ui().toggleFocusMode(),
    },
    {
      id: CMD.calm,
      group: 'views',
      title: 'Calm mode',
      subtitle: 'Reduced motion',
      keywords: ['reduce motion', 'animation'],
      shortcut: SHORTCUT.calm,
      icon: Wind,
      run: () => useViewerStore.getState().toggle('calm'),
    },
    {
      id: CMD.shortcuts,
      group: 'actions',
      title: 'Keyboard shortcuts',
      keywords: ['keys', 'help', 'hotkeys'],
      shortcut: SHORTCUT.shortcuts,
      icon: Keyboard,
      run: () => ui().setShortcutsOpen(true),
    },
    { id: CMD.pageWorkstation, group: 'pages', title: 'Workstation', icon: LayoutDashboard, run: go(ROUTES.workstation) },
    {
      id: CMD.pagePerformance,
      group: 'pages',
      title: 'Model performance',
      keywords: ['roc', 'auc', 'calibration', 'metrics'],
      icon: LineChart,
      run: go(ROUTES.performance),
    },
    {
      id: CMD.pageMethodology,
      group: 'pages',
      title: 'Methodology',
      keywords: ['method', 'data', 'protocol'],
      icon: BookOpen,
      run: go(ROUTES.methodology),
    },
    { id: CMD.pageHome, group: 'pages', title: 'Home', subtitle: 'Landing page', icon: Home, run: go(ROUTES.landing) },
  ];

  const interim: Command[] = [
    {
      id: CMD.tourStart,
      group: 'actions',
      title: 'Start guided demo',
      keywords: ['tour', 'demo', 'walkthrough'],
      icon: PlayCircle,
      run: () => {
        if (!onWorkstation) {
          void loadWorkstation();
          navigate(ROUTES.workstation);
        }
        ui().openTour(0);
      },
    },
  ];

  useRegisterCommands('shell', shell, [onWorkstation]);
  useRegisterCommands('shell.interim', interim, [onWorkstation], { priority: -1 });
}
