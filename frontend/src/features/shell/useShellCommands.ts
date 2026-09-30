import {
  BookOpen,
  Home,
  Info,
  Keyboard,
  LayoutDashboard,
  Link2,
  LineChart,
  Maximize2,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Search,
  Wind,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { ROUTES } from '@/routes';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useInterimCommands } from './useInterimCommands';

/** Copies the current URL (the shareable view state, V2 §7) and confirms with a toast. */
async function copyCurrentLink(): Promise<void> {
  const ui = useUiStore.getState();
  try {
    await navigator.clipboard.writeText(window.location.href);
    ui.pushToast({ tone: 'success', message: 'Link to this view copied' });
  } catch {
    ui.pushToast({ tone: 'info', message: 'Copy the address bar to share this view' });
  }
}

/**
 * App-level commands (agent A): palette, shortcut sheet, calm and focus modes, the two drawers, the
 * patient card, Details, "Copy link to this view" and the pages. Also mounts the interim lists other
 * owners replace (`useInterimCommands`).
 */
export function useShellCommands(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onWorkstation = pathname.startsWith(ROUTES.workstation);
  const cardOpen = useUiStore((s) => s.patientCardOpen);
  useInterimCommands();

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
      id: CMD.patientCard,
      group: 'views',
      title: cardOpen ? 'Collapse the patient card' : 'Show the patient card',
      subtitle: cardOpen ? 'To a 40 px rail' : 'Top inputs for the current target',
      keywords: ['record', 'rail', 'left', 'sidebar'],
      icon: cardOpen ? PanelLeftClose : PanelLeftOpen,
      when: () => onWorkstation && ui().chrome === 'workstation',
      run: () => ui().setPatientCardOpen(!ui().patientCardOpen),
    },
    {
      id: CMD.copyLink,
      group: 'actions',
      title: 'Copy link to this view',
      subtitle: 'Patient, vessel, view and panel',
      keywords: ['share', 'url', 'permalink'],
      icon: Link2,
      when: () => onWorkstation,
      run: () => void copyCurrentLink(),
    },
    {
      id: CMD.details,
      group: 'actions',
      title: 'Intended use & details',
      subtitle: 'Decision support only · dataset · licences',
      keywords: ['disclaimer', 'about', 'license', 'credits', 'safety'],
      icon: Info,
      run: () => ui().openDetails(),
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

  useRegisterCommands('shell', shell, [onWorkstation, cardOpen]);
}
