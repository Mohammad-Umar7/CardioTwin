import { FlaskConical, RotateCcw } from 'lucide-react';
import { SegmentedControl } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';

/** The one what-if the landing offers (V2 §6.1 P3 "live lever"). */
export const HERO_LEVER_KEY = 'Typical Chest Pain';

const OPTIONS = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
] as const;

/**
 * "Try a what-if: Typical angina No | Yes" under the hero copy. Flipping it re-scores the heart live: the vessel labels
 * and colours update and the vessels ripple. The edit is an ordinary what-if, so it carries into the
 * workstation (where the what-if pill offers Reset); here a one-click ↺ restores the recorded value.
 */
export function LiveLever() {
  const schema = useSchemaIndex();
  const spec = schema?.byKey.get(HERO_LEVER_KEY);
  const value = usePatientStore((s) => s.features[HERO_LEVER_KEY]);
  const recorded = usePatientStore((s) => s.recorded[HERO_LEVER_KEY]);
  const setFeature = usePatientStore((s) => s.setFeature);
  if (!spec || spec.type !== 'binary' || (value !== 0 && value !== 1)) return null;
  const edited = value !== recorded;

  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2.5 rounded-full py-1 pl-2 pr-1.5 text-label font-normal text-secondary transition-shadow duration-base',
        'bg-white/[0.035] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
        edited && 'shadow-[inset_0_0_0_1px_rgba(86,194,230,0.35),0_0_24px_-8px_rgba(86,194,230,0.6)]',
      )}
    >
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-full bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(86,194,230,0.3)]"
        >
          <FlaskConical className="size-3.5 stroke-[1.75]" />
        </span>
        {edited && <span aria-hidden className="size-1.5 rounded-full bg-accent shadow-[0_0_6px_rgba(86,194,230,0.9)]" />}
        <span className="text-tertiary">Try a what-if:</span>
        <span className="text-primary">{spec.label}</span>
      </span>
      <SegmentedControl
        label={`What if: ${spec.label}`}
        size="xs"
        options={OPTIONS}
        value={value as 0 | 1}
        onChange={(v) => setFeature(HERO_LEVER_KEY, v)}
      />
      {edited && recorded !== undefined && (
        <button
          type="button"
          onClick={() => setFeature(HERO_LEVER_KEY, recorded)}
          className="inline-flex size-6 items-center justify-center rounded-full text-secondary transition-colors duration-instant hover:bg-white/[0.07] hover:text-primary"
          aria-label={`Reset ${spec.label} to the recorded value`}
          title="Back to the recorded value"
        >
          <RotateCcw aria-hidden className="size-3 stroke-[1.75]" />
        </button>
      )}
    </div>
  );
}
