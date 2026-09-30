import { Pin, PinOff, RotateCcw } from 'lucide-react';
import { Button, SegmentedControl, Tooltip } from '@/design';
import { useSchema } from '@/hooks/useData';
import { pickDefaultPatient, schemaDefaults } from '@/lib/patients';
import { useCohort } from '@/hooks/useData';
import { editedKeys, usePatientStore } from '@/state/patientStore';

/** Cohort ○ / Custom ● switch. Custom starts from the current inputs; Cohort reopens the default TEST patient. */
export function PatientModeSwitch() {
  const mode = usePatientStore((s) => s.mode);
  const schema = useSchema();
  const cohort = useCohort();
  return (
    <SegmentedControl
      label="Patient source"
      size="xs"
      value={mode}
      options={[
        { value: 'cohort', label: 'Cohort', disabled: cohort.status !== 'ready' },
        { value: 'custom', label: 'Custom', disabled: !schema.data },
      ]}
      onChange={(next) => {
        const store = usePatientStore.getState();
        if (next === 'custom' && schema.data) store.startCustom(schemaDefaults(schema.data));
        if (next === 'cohort' && cohort.data) {
          const p = pickDefaultPatient(cohort.data.patients);
          if (p) store.loadPatient(p);
        }
      }}
    />
  );
}

/**
 * WhatIfBar (DESIGN_SYSTEM §5): "n edits vs recorded", ↺ reset, and the A/B pin — pinning keeps the
 * current estimate as a baseline so every value shows "was → now" until unpinned.
 */
export function WhatIfBar() {
  const edits = usePatientStore((s) => editedKeys(s.features, s.recorded).length);
  const mode = usePatientStore((s) => s.mode);
  const baseline = usePatientStore((s) => s.baseline);
  const hasPrediction = usePatientStore((s) => !!s.prediction);
  const resetAll = usePatientStore((s) => s.resetAll);
  const pinBaseline = usePatientStore((s) => s.pinBaseline);
  const clearBaseline = usePatientStore((s) => s.clearBaseline);

  return (
    <div className="flex items-center gap-2" data-tour="what-if">
      <span className="min-w-0 flex-1 truncate text-label font-normal text-secondary" aria-live="polite">
        {edits === 0 ? (
          <span className="text-tertiary">{mode === 'custom' ? 'Custom inputs' : 'Recorded values'}</span>
        ) : (
          <>
            <span className="font-semibold text-accent">{edits}</span> {edits === 1 ? 'edit' : 'edits'} vs{' '}
            {mode === 'custom' ? 'defaults' : 'recorded'}
          </>
        )}
      </span>
      <Tooltip content={baseline ? 'Unpin the A/B baseline' : 'Pin the current estimate as baseline A; later changes show was → now'}>
        <Button
          size="sm"
          variant={baseline ? 'secondary' : 'ghost'}
          disabled={!hasPrediction}
          onClick={() => (baseline ? clearBaseline() : pinBaseline())}
          iconLeft={baseline ? <PinOff /> : <Pin />}
          aria-pressed={!!baseline}
          className={baseline ? 'border-accent/50 text-accent' : undefined}
        >
          A/B
        </Button>
      </Tooltip>
      <Tooltip content="Reset every input to the recorded value">
        <Button size="sm" variant="ghost" disabled={edits === 0} onClick={resetAll} iconLeft={<RotateCcw />}>
          Reset
        </Button>
      </Tooltip>
    </div>
  );
}
