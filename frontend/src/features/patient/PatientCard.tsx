import { ChevronsLeft, PanelLeftOpen, PencilLine, Search } from 'lucide-react';
import { Button, IconButton, Kbd, StageCard, withShortcut } from '@/design';
import { useCohort } from '@/hooks/useData';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { SHORTCUT } from '@/state/commandIds';
import { selectPatientCardExpanded, useUiStore } from '@/state/uiStore';

/**
 * PatientCard — WORKSTATION_V2 §5.5. Answers "What did the model see, and which inputs matter most for
 * the current target?". Rendered in StageLayout's `left` slot; the slot hugs the card's width.
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent B on creation; A never edits this file again.
 *
 * Contract:
 *   export interface PatientCardProps { className?: string }
 *   - Reads everything from the stores; no required props.
 *   - Card vs rail: `useUiStore(selectPatientCardExpanded)` (the user's `patientCardOpen`, auto-collapsed
 *     while the Explain drawer is open). Collapse / expand with `setPatientCardOpen(bool)`.
 *   - Card: w var(--card-left-w), StageCard material, `data-region="patient-card"`.
 *     Rail: 40 × 116 (`var(--rail-w)`), `data-region="patient-rail"`: ◧ expand · ✎ Edit inputs (I, accent
 *     dot while edited) · ⌕ palette.
 *   - Row click: `openDrawer('inputs', { field })`; abnormal link: `openDrawer('inputs', { section: 'abnormal' })`.
 *   - Hover a row: `highlightFeature(key)` (never anatomy).
 */
export interface PatientCardProps {
  className?: string;
}

export function PatientCard({ className }: PatientCardProps) {
  const expanded = useUiStore(selectPatientCardExpanded);
  const setOpen = useUiStore((s) => s.setPatientCardOpen);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const edits = usePatientStore(selectEditCount);
  const id = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  const cohort = useCohort();
  const patient = cohort.data?.patients.find((p) => p.id === id);

  if (!expanded) {
    return (
      <StageCard
        as="nav"
        aria-label="Patient record"
        region="patient-rail"
        shape="bare"
        className={`flex w-[var(--rail-w)] flex-col items-center gap-1 p-1 ${className ?? ''}`}
      >
        <IconButton label="Show the patient card" icon={<PanelLeftOpen />} size="md" onClick={() => setOpen(true)} />
        <span className="relative">
          <IconButton
            label="Edit inputs"
            tooltip={withShortcut('Edit inputs', SHORTCUT.inputs)}
            icon={<PencilLine />}
            size="md"
            onClick={() => openDrawer('inputs')}
          />
          {edits > 0 && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />}
        </span>
        <IconButton
          label="Search or jump to"
          tooltip={withShortcut('Search or jump to', 'Mod+K')}
          icon={<Search />}
          size="md"
          onClick={() => useUiStore.getState().setPaletteOpen(true)}
        />
      </StageCard>
    );
  }

  return (
    <StageCard
      as="aside"
      aria-label="Patient record"
      region="patient-card"
      enterDelay={60}
      title={mode === 'blank' ? 'Blank patient' : (patient?.summary ?? id ?? 'Patient')}
      actions={
        <IconButton
          label="Collapse to rail"
          icon={<ChevronsLeft />}
          size="sm"
          onClick={() => setOpen(false)}
        />
      }
      className={`flex w-[var(--card-left-w)] flex-col gap-3 ${className ?? ''}`}
    >
      <p className="text-body-s text-secondary">The inputs that drive this estimate appear here.</p>
      <Button
        variant="secondary"
        className="w-full justify-between"
        iconLeft={<PencilLine className="stroke-[1.5]" />}
        onClick={() => openDrawer('inputs')}
      >
        <span className="flex-1 text-left">Edit inputs</span>
        <Kbd>I</Kbd>
      </Button>
    </StageCard>
  );
}
