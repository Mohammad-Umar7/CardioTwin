import { X } from 'lucide-react';
import { useId } from 'react';
import { Button, Drawer, IconButton } from '@/design';
import { ClinicalForm } from '@/features/patient/ClinicalForm';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';

/**
 * InputsDrawer — WORKSTATION_V2 §5.6. Answers "What if I change something?". Rendered in StageLayout's
 * `drawers` slot; docks to the stage's left edge over the patient card (which StageLayout fades out).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent B on creation; A never edits this file again.
 *
 * Contract:
 *   export interface InputsDrawerProps { className?: string }
 *   - Open state: `useUiStore(s => s.drawer === 'inputs')`; close with `closeDrawer()` (Esc is handled by
 *     design/Drawer at the drawer level of the Esc chain).
 *   - `focusField` (raw key) = row to focus and expand on open; `inputsSection` = section to scroll to.
 *   - Width `var(--drawer-inputs-w)` (400 / 360), `data-region="inputs-drawer"`, footer "Done" is the only
 *     filled button on screen.
 * The stub hosts the legacy ClinicalForm so every input stays reachable until B's drawer lands.
 */
export interface InputsDrawerProps {
  className?: string;
}

export function InputsDrawer({ className }: InputsDrawerProps) {
  const open = useUiStore((s) => s.drawer === 'inputs');
  const close = useUiStore((s) => s.closeDrawer);
  const edits = usePatientStore(selectEditCount);
  const titleId = useId();

  return (
    <Drawer open={open} side="left" onClose={close} labelledBy={titleId} region="inputs-drawer" className={className}>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-hairline pl-4 pr-2">
        <h2 id={titleId} className="eyebrow text-secondary">
          Edit inputs
        </h2>
        <IconButton label="Close · Esc" icon={<X />} size="sm" onClick={close} />
      </header>
      <div className="panel-scroll min-h-0 flex-1">
        <ClinicalForm />
      </div>
      <footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-hairline px-4">
        <span className="text-label font-normal text-tertiary">
          {edits > 0 ? `${edits} ${edits === 1 ? 'change' : 'changes'} · applied instantly` : 'Changes apply instantly'}
        </span>
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      </footer>
    </Drawer>
  );
}
