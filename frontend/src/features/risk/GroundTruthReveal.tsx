import { Eye, EyeOff } from 'lucide-react';
import { Badge, Button, Tooltip } from '@/design';
import { useCohort } from '@/hooks/useData';
import { editedKeys, usePatientStore } from '@/state/patientStore';

/**
 * GroundTruthReveal (DESIGN_SYSTEM §5): TEST patients only. Places ● / ○ and "agrees ✓ / disagrees ✕"
 * beside every vessel, misses included. Dev patients show that they were used in development; Custom
 * patients have no ground truth.
 */
export function GroundTruthReveal() {
  const mode = usePatientStore((s) => s.mode);
  const split = usePatientStore((s) => s.split);
  const revealed = usePatientStore((s) => s.revealed);
  const setRevealed = usePatientStore((s) => s.setRevealed);
  const edited = usePatientStore((s) => editedKeys(s.features, s.recorded).length > 0);
  const hasPrediction = usePatientStore((s) => !!s.prediction);
  const cohort = useCohort();

  if (mode === 'custom' || cohort.status !== 'ready') {
    return (
      <Tooltip content="Ground truth exists only for cohort patients.">
        <span tabIndex={0} className="text-label font-normal text-tertiary">
          No cath result for a custom patient
        </span>
      </Tooltip>
    );
  }

  if (split !== 'test') {
    return (
      <p className="flex items-center gap-2 text-label font-normal text-tertiary">
        <Badge tone="outline">DEV</Badge> Seen during model development — pick a TEST patient for an honest check.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-tour="reveal">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={revealed ? 'ghost' : 'secondary'}
          disabled={!hasPrediction}
          iconLeft={revealed ? <EyeOff /> : <Eye />}
          onClick={() => setRevealed(!revealed)}
          aria-pressed={revealed}
        >
          {revealed ? 'Hide cath result' : 'Reveal cath result'}
        </Button>
        <Badge tone="accent">TEST</Badge>
      </div>
      <p className="text-label font-normal text-tertiary">
        This patient was never seen in training.
        {revealed && edited ? ' Ground truth refers to the recorded values, not your edits.' : ''}
      </p>
    </div>
  );
}
