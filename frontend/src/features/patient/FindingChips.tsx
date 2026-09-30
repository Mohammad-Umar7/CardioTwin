import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Tooltip } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import type { FeatureSpec, TargetId } from '@/types/contracts';
import { useChangeTick, useCurrentTarget } from './hooks';
import { isPresent, sameValue } from './lib/values';
import { counterfactualCopy } from './lib/copy';
import { useFlipCounterfactuals, type Counterfactuals } from './useCounterfactuals';

interface ChipProps {
  spec: FeatureSpec;
  rowId: string;
  target: TargetId;
  counterfactuals: Counterfactuals | null;
}

function FindingChip({ spec, rowId, target, counterfactuals }: ChipProps) {
  const value = usePatientStore((s) => s.features[spec.key]);
  const recorded = usePatientStore((s) => s.recorded[spec.key]);
  const imputed = usePatientStore((s) => s.prediction?.imputed.includes(spec.key) ?? false);
  const highlighted = useUiStore((s) => s.highlightedFeature === spec.key);
  const reduced = useIsReducedMotion();
  const present = isPresent(value);
  const edited = !sameValue(value, recorded);
  const tick = useChangeTick(value);
  const flippedP = counterfactuals?.flipped.get(spec.key);
  const tip = flippedP && counterfactuals ? counterfactualCopy(present, target, counterfactuals.base, flippedP) : null;

  const chip = (
    <button
      type="button"
      data-row-id={rowId}
      data-feature={spec.key}
      aria-pressed={present}
      onClick={() => usePatientStore.getState().setFeature(spec.key, present ? 0 : 1)}
      onPointerEnter={() => useUiStore.getState().highlightFeature(spec.key)}
      onPointerLeave={() => useUiStore.getState().highlightFeature(null)}
      className={cn(
        'relative inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border px-2 text-label transition-colors duration-fast ease-out',
        present
          ? 'border-accent/70 bg-[var(--accent-subtle)] text-primary hover:border-accent'
          : 'border-line text-secondary hover:border-line-strong hover:bg-surface-1 hover:text-primary',
        highlighted && !present && 'bg-surface-1 text-primary',
        imputed && 'border-dashed',
      )}
    >
      {edited && <span aria-hidden className="absolute -left-[3px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent ring-2 ring-panel" />}
      {present && <Check aria-hidden className="size-3 shrink-0 stroke-[2] text-accent" />}
      <span className="truncate">{spec.label}</span>
      {edited && <span className="sr-only">, edited, recorded {isPresent(recorded) ? 'present' : 'absent'}</span>}
      {tick > 0 && (
        <motion.span
          key={tick}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm shadow-[inset_0_0_0_1px_rgb(var(--c-accent))]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 1.2, ease: 'easeIn' }}
        />
      )}
    </button>
  );

  return (
    <div className="max-w-full">
      <Tooltip content={tip} delay={300}>
        {chip}
      </Tooltip>
    </div>
  );
}

export interface FindingChipsProps {
  specs: readonly FeatureSpec[];
  /** Accessible name of the group, e.g. "Symptoms findings". */
  label: string;
  /** Prefix for the chips' row ids (unique per cloud). */
  idPrefix: string;
  /** Optional leading word ("Present:"), visually de-emphasised. */
  lead?: string;
  className?: string;
}

/**
 * FindingChips (WORKSTATION_V2 §5.6): the binary inputs of a section or group as one wrapping cloud of
 * `aria-pressed` toggle buttons. Present = accent-subtle fill + ✓; edited = accent dot on the leading
 * edge; hover shows the counterfactual for the current target ("If present: CAD 99 % (▲ +1 pt)").
 */
export function FindingChips({ specs, label, idPrefix, lead, className }: FindingChipsProps) {
  const target = useCurrentTarget();
  const counterfactuals = useFlipCounterfactuals(specs.map((s) => s.key));
  if (specs.length === 0) return null;
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5 px-1 py-1', className)}>
      {/* The lead flows inline so the chips wrap under it and use the full width (the group label names it). */}
      {lead && (
        <span aria-hidden className="pr-0.5 text-label font-normal text-tertiary">
          {lead}
        </span>
      )}
      {specs.map((spec) => (
        <FindingChip key={spec.key} spec={spec} rowId={`${idPrefix}:${spec.key}`} target={target} counterfactuals={counterfactuals} />
      ))}
    </div>
  );
}
