import { Crosshair, Eye, EyeOff, FlaskConical, Gauge, MessageSquareText, SlidersHorizontal, Stethoscope } from 'lucide-react';
import { useSchemaIndex } from '@/hooks/useData';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { CMD, SHORTCUT } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore, type ExplainTab } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useCanReveal } from './useRiskView';

const EXPLAIN_TABS: { tab: ExplainTab; title: string; subtitle: string; icon: Command['icon']; keywords: string[] }[] = [
  { tab: 'why', title: 'Explain › Why', subtitle: 'What raises and lowers the estimate', icon: MessageSquareText, keywords: ['shap', 'drivers', 'reasons', 'waterfall'] },
  { tab: 'whatif', title: 'Explain › What-if', subtitle: 'Recorded vs edited, biggest levers', icon: SlidersHorizontal, keywords: ['levers', 'counterfactual', 'compare'] },
  { tab: 'physiology', title: 'Explain › Physiology', subtitle: 'Values outside the normal range', icon: Stethoscope, keywords: ['labs', 'reference', 'abnormal', 'range'] },
  { tab: 'model', title: 'Explain › Model', subtitle: 'Threshold, accuracy on unseen patients', icon: Gauge, keywords: ['auc', 'threshold', 'calibration', 'performance'] },
];

/**
 * Palette commands for vessels and explanations (WORKSTATION_V2 §4.9, §9.3 C): Focus LAD / LCX / RCA (1 2 3,
 * replacing the workstation's interim bindings), Explain CAD / LAD / LCX / RCA, the four Explain tabs, and
 * Reveal / Hide cath result (TEST patients only). Registered at priority 0 while the Risk card is mounted.
 */
export function useRiskCommands(): void {
  const index = useSchemaIndex();
  const selected = useViewerStore((s) => s.selectedStructure);
  const revealed = usePatientStore((s) => s.revealed);
  const canReveal = useCanReveal();
  const viewer = useViewerStore.getState;
  const ui = useUiStore.getState;

  const targets = index?.targets ?? [];
  const vessels = index?.vessels ?? [];

  const commands: Command[] = [
    ...vessels.slice(0, SHORTCUT.vessels.length).map(
      (v, i): Command => ({
        id: CMD.selectVessel(v.id),
        group: 'vessels',
        title: `Focus ${v.id}`,
        subtitle: v.label,
        keywords: [v.id, v.label, 'select', 'artery', 'vessel'],
        shortcut: SHORTCUT.vessels[i],
        icon: Crosshair,
        run: () => viewer().select(v.id),
      }),
    ),
    // Context first: with a vessel selected, "Explain LAD" leads the explain commands.
    ...[...targets]
      .sort((a, b) => Number(b.id === selected) - Number(a.id === selected))
      .map(
        (t): Command => ({
          id: CMD.explainVessel(t.id),
          group: 'vessels',
          title: `Explain ${t.id}`,
          subtitle: t.id === 'CAD' ? 'Why the overall estimate is what it is' : `Why ${t.label.toLowerCase()} is flagged or not`,
          keywords: [t.id, t.label, 'why', 'explain', 'shap'],
          icon: MessageSquareText,
          run: () => {
            viewer().select(t.id === 'CAD' ? null : t.id);
            ui().openDrawer('explain', { tab: 'why' });
          },
        }),
      ),
    ...EXPLAIN_TABS.map(
      ({ tab, title, subtitle, icon, keywords }): Command => ({
        id: `explain.tab.${tab}`,
        group: 'actions',
        title,
        subtitle,
        keywords: ['explain', ...keywords],
        icon,
        run: () => ui().openDrawer('explain', { tab }),
      }),
    ),
    {
      id: 'risk.reveal',
      group: 'actions',
      title: revealed ? 'Hide cath result' : 'Reveal cath result',
      subtitle: 'Held-out test patient: compare with angiography',
      keywords: ['cath', 'truth', 'ground truth', 'angiography', 'reveal', 'label'],
      icon: revealed ? EyeOff : Eye,
      when: () => canReveal,
      run: () => usePatientStore.getState().setRevealed(!usePatientStore.getState().revealed),
    },
    {
      id: 'explain.levers',
      group: 'actions',
      title: 'Show the biggest levers',
      subtitle: 'Model counterfactuals for the current target',
      keywords: ['what if', 'counterfactual', 'levers', 'change'],
      icon: FlaskConical,
      run: () => ui().openDrawer('explain', { tab: 'whatif' }),
    },
  ];

  useRegisterCommands('risk', commands, [index, selected, revealed, canReveal]);
}
