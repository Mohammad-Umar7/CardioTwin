import { PatientPicker } from '@/features/patient/PatientPicker';

/**
 * PatientSwitcher — WORKSTATION_V2 §5.2: the content of the popover opened from the top-bar PatientChip
 * (agent A owns the chip/trigger and the popover shell: 420 × ≤ 520, surface/3, e-3).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent B on creation; A never edits this file again.
 *
 * Contract:
 *   export interface PatientSwitcherProps {
 *     onClose(): void;     // call after a patient is loaded / a blank patient started (closes the popover)
 *     className?: string;
 *   }
 *   - Autofocused search (ID, sex, age, summary) · Curated cases (features/patient/curated.ts) · Held-out
 *     test (61) · Development (242) · footer: New blank patient (`patientStore.startBlank(schemaDefaults)`),
 *     Random test patient.
 *   - Never reveals cath labels in the copy.
 * The stub hosts the legacy PatientPicker combobox.
 */
export interface PatientSwitcherProps {
  onClose(): void;
  className?: string;
}

export function PatientSwitcher({ className }: PatientSwitcherProps) {
  return (
    <div className={className} data-region="patient-switcher">
      <PatientPicker />
    </div>
  );
}
