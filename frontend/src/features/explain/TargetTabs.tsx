import { Tabs } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useViewerStore } from '@/state/viewerStore';
import { TARGET_ORDER } from '@/types/contracts';
import { useExplainTarget } from './useExplainTarget';

/**
 * TargetTabs (DESIGN_SYSTEM §5): CAD · LAD · LCX · RCA, synced with the 3D selection. Choosing a vessel
 * selects it in 3D (camera flies to its view); choosing CAD clears the selection.
 */
export function TargetTabs({ idBase = 'why' }: { idBase?: string }) {
  const index = useSchemaIndex();
  const target = useExplainTarget();
  const select = useViewerStore((s) => s.select);
  const ids = index?.targets.map((t) => t.id) ?? [...TARGET_ORDER];
  return (
    <Tabs
      idBase={idBase}
      label="Explanation target"
      value={target}
      onChange={(v) => select(v === 'CAD' ? null : v)}
      items={ids.map((id) => ({ value: id, label: id }))}
    />
  );
}
