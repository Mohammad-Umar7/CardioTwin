import { X } from 'lucide-react';
import { useId } from 'react';
import { Drawer, IconButton } from '@/design';
import { ExplainPanel } from '@/features/explain/ExplainPanel';
import { PhysiologyTable } from '@/features/explain/PhysiologyTable';
import { useExplainTarget } from '@/features/explain/useExplainTarget';
import { useUiStore } from '@/state/uiStore';

/**
 * ExplainDrawer — WORKSTATION_V2 §5.10. Answers "Show me all the evidence". Rendered in StageLayout's
 * `drawers` slot; docks to the stage's right edge over the right column (which StageLayout fades out) and
 * auto-collapses the patient card to its rail (`selectPatientCardExpanded`).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent C on creation; A never edits this file again.
 *
 * Contract:
 *   export interface ExplainDrawerProps { className?: string }
 *   - Open state: `useUiStore(s => s.drawer === 'explain')`; tab: `explainTab` / `setExplainTab`
 *     ('why' | 'whatif' | 'physiology' | 'model'); close with `closeDrawer()`.
 *   - Width `var(--drawer-explain-w)` (440 / 400), `data-region="explain-drawer"`.
 *   - Title carries the CAD numeral (`data-prob="CAD"`): it is P(CAD)'s fallback home while the drawer
 *     covers the Risk card.
 * The stub hosts the legacy WHY panel and physiology table.
 */
export interface ExplainDrawerProps {
  className?: string;
}

export function ExplainDrawer({ className }: ExplainDrawerProps) {
  const open = useUiStore((s) => s.drawer === 'explain');
  const close = useUiStore((s) => s.closeDrawer);
  const target = useExplainTarget();
  const titleId = useId();

  return (
    <Drawer open={open} side="right" onClose={close} labelledBy={titleId} region="explain-drawer" className={className}>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-hairline pl-4 pr-2">
        <h2 id={titleId} className="eyebrow text-secondary">
          Explain
        </h2>
        <IconButton label="Close · Esc" icon={<X />} size="sm" onClick={close} />
      </header>
      <div className="panel-scroll flex min-h-0 flex-1 flex-col gap-6 px-4 py-4">
        <ExplainPanel idBase="explain-drawer" />
        <section aria-labelledby="explain-physiology" className="flex flex-col gap-2">
          <h3 id="explain-physiology" className="eyebrow text-secondary">
            Physiology
          </h3>
          <PhysiologyTable target={target} />
        </section>
      </div>
    </Drawer>
  );
}
