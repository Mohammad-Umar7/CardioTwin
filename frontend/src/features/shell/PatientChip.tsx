import { ChevronDown } from 'lucide-react';
import { Badge, Popover, Skeleton, Tooltip } from '@/design';
import { useCohort } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { PatientSwitcher } from '@/features/patient/PatientSwitcher';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { SPLIT_COPY, sexAgeLine } from './patientIdentity';

/**
 * Top-bar PatientChip (WORKSTATION_V2 §5.2): the only identity on screen and the trigger of the patient
 * switcher. h 32, r-sm, ghost button: mono ID, the split tag (TEST accent outline, DEV outline), ▾, and a
 * 6 px accent dot while edits exist. It opens `PatientSwitcher` (agent B) in a 420 px popover.
 */
export function PatientChip({ className }: { className?: string }) {
  const id = usePatientStore((s) => s.selectedPatientId);
  const split = usePatientStore((s) => s.split);
  const mode = usePatientStore((s) => s.mode);
  const edits = usePatientStore(selectEditCount);
  const cohort = useCohort();
  const patient = cohort.data?.patients.find((p) => p.id === id);

  if (!id && mode === 'cohort') {
    return cohort.status === 'error' ? null : <Skeleton className={cn('h-5 w-16', className)} />;
  }

  const blank = mode !== 'cohort';
  const title = blank ? 'Blank patient' : id!;
  const tooltip = [sexAgeLine(patient), !blank && split ? SPLIT_COPY[split] : 'Schema defaults · not a cohort patient']
    .filter(Boolean)
    .join(' · ');

  return (
    <Popover
      label="Switch patient"
      placement="bottom"
      width={420}
      className="max-w-[calc(100vw-16px)] p-3"
      trigger={({ ref, ...props }) => (
        <Tooltip content={tooltip} placement="bottom">
          <button
            ref={ref}
            type="button"
            {...props}
            data-region="patient-chip"
            aria-label={`Patient ${title}${edits > 0 ? `, ${edits} ${edits === 1 ? 'edit' : 'edits'}` : ''}. Switch patient`}
            className={cn(
              'relative inline-flex h-8 items-center gap-2 rounded-sm border border-transparent px-2 text-label text-secondary transition-colors duration-fast',
              'hover:bg-white/[0.05] aria-expanded:border-white/15 aria-expanded:bg-white/[0.08]',
              className,
            )}
          >
            <span className={cn('whitespace-nowrap text-primary', blank ? 'text-body-s font-medium' : 'mono text-mono-s')}>
              {title}
            </span>
            {!blank && split && <Badge tone={split === 'test' ? 'accent' : 'outline'}>{split === 'test' ? 'TEST' : 'DEV'}</Badge>}
            <ChevronDown aria-hidden className="size-3.5 stroke-[1.5] text-tertiary" />
            {edits > 0 && <span aria-hidden className="absolute right-0.5 top-1 size-1.5 rounded-full bg-accent" />}
          </button>
        </Tooltip>
      )}
    >
      {(close) => <PatientSwitcher onClose={close} />}
    </Popover>
  );
}
