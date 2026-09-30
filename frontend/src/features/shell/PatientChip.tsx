import { Badge } from '@/design';
import { useCohort } from '@/hooks/useData';
import { compactSummary, splitLabel } from '@/lib/patients';
import { editedKeys, usePatientStore } from '@/state/patientStore';

/** Top-bar patient chip: mono ID + compact summary + TEST/DEV tag (+ edit count). Hidden on landing. */
export function PatientChip() {
  const id = usePatientStore((s) => s.selectedPatientId);
  const split = usePatientStore((s) => s.split);
  const mode = usePatientStore((s) => s.mode);
  const edits = usePatientStore((s) => editedKeys(s.features, s.recorded).length);
  const cohort = useCohort();
  const patient = cohort.data?.patients.find((p) => p.id === id);

  if (!id && mode !== 'custom') return null;
  return (
    <div className="hidden items-center gap-2 text-label text-secondary md:flex" aria-label="Current patient">
      <span className="mono text-mono-s text-primary">{mode === 'custom' ? 'Custom' : id}</span>
      {patient && <span className="hidden whitespace-nowrap min-[1280px]:inline">{compactSummary(patient.summary)}</span>}
      <Badge tone={split === 'test' ? 'accent' : 'outline'}>{splitLabel(mode === 'custom' ? null : split)}</Badge>
      {edits > 0 && (
        <span className="inline-flex items-center gap-1 text-accent">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {edits} {edits === 1 ? 'edit' : 'edits'}
        </span>
      )}
    </div>
  );
}
