import { RotateCcw } from 'lucide-react';
import { Button } from '@/design';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { resetAllEdits } from './profileActions';

/**
 * @deprecated V2 removed the permanent what-if header row, the Cohort/Custom switch and the A/B pin
 * (WORKSTATION_V2 §5.20): the stage shows `WhatIfPill` only while edits exist, the baseline is automatic
 * and "New blank patient" lives in the switcher. These two exports survive only so the `?layout=legacy`
 * left panel (features/workstation/panels.tsx) keeps compiling; delete this file with that layout.
 */
export function PatientModeSwitch() {
  return null;
}

/** @deprecated See the module note. Legacy-layout edit count + Reset (with Undo); nothing when unedited. */
export function WhatIfBar() {
  const edits = usePatientStore(selectEditCount);
  if (edits === 0) return null;
  return (
    <div className="flex items-center gap-2" data-tour="what-if">
      <span className="min-w-0 flex-1 truncate text-label font-normal text-secondary" aria-live="polite">
        <span className="num font-semibold text-accent">{edits}</span> {edits === 1 ? 'edit' : 'edits'} vs recorded
      </span>
      <Button size="sm" variant="ghost" onClick={resetAllEdits} iconLeft={<RotateCcw />}>
        Reset
      </Button>
    </div>
  );
}
