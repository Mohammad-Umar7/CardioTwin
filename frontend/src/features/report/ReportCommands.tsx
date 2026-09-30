import { useReportCommands } from './useReportCommands';

/**
 * Headless mount point for the report's palette commands ("Open printable report", "Print or save
 * report as PDF"). Mount it once inside the router, next to the shell's own command hooks; it renders
 * nothing and unregisters on unmount.
 */
export function ReportCommands(): null {
  useReportCommands();
  return null;
}
