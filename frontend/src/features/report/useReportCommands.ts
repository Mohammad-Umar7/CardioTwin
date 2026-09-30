/**
 * Palette commands for the printable report (WORKSTATION_V2 §4.9 registry). Mounted through
 * `<ReportCommands />` (ReportCommands.tsx) once inside the router.
 *
 *   - "Open printable report" (Pages): from any route, opens `/report` for the current patient.
 *   - "Print or save report as PDF" (Actions): only on `/report`, once the estimate is up to date.
 */
import { FileText, Printer } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import type { Command } from '@/state/commandStore';
import { usePatientStore } from '@/state/patientStore';

export const REPORT_PATH = '/report';

export const REPORT_CMD = {
  open: 'page.report',
  print: 'report.print',
} as const;

/** Warm the lazily loaded report chunk so the navigation paints without a fallback. */
const preload = () => void import('./ReportPage');

export function useReportCommands(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onReport = pathname === REPORT_PATH;

  const commands: Command[] = [
    {
      id: REPORT_CMD.open,
      group: 'pages',
      title: 'Open printable report',
      subtitle: 'Two-page summary of this patient’s estimate, ready to print or save as PDF',
      keywords: ['report', 'print', 'pdf', 'export', 'save', 'summary', 'document', 'handout'],
      icon: FileText,
      when: () => !onReport && Object.keys(usePatientStore.getState().features).length > 0,
      run: () => {
        preload();
        navigate(REPORT_PATH);
      },
    },
    {
      id: REPORT_CMD.print,
      group: 'actions',
      title: 'Print or save report as PDF',
      keywords: ['print', 'pdf', 'save', 'export'],
      icon: Printer,
      when: () => onReport && usePatientStore.getState().status === 'ready',
      run: () => window.print(),
    },
  ];

  useRegisterCommands('report', commands, [onReport]);
}

