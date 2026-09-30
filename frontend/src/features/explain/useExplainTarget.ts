import { useViewerStore } from '@/state/viewerStore';

/** The target whose explanation is shown: the selected vessel, or CAD when nothing is selected. */
export function useExplainTarget(): string {
  return useViewerStore((s) => s.selectedStructure) ?? 'CAD';
}
