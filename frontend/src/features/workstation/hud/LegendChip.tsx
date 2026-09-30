import { StageCard } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useViewerStore } from '@/state/viewerStore';
import { riskGradientCss } from '@/theme/risk';

/**
 * LegendChip — WORKSTATION_V2 §5.13: `Low ▁▂▃▅▆▇ Very high` with the current target's threshold tick.
 * Rendered in StageLayout's `bottomLeft` slot (x 12, bottom 12, 212 × 40; 184 × 36 at 1280).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent D on creation; A never edits this file again.
 *
 * Contract:
 *   export interface LegendChipProps { className?: string }
 *   - StageCard, `data-region="legend"`; expands on hover/focus into a 280 px popover (band ladder,
 *     threshold sentence, LM "not predicted", territory and flow notes, "Vessel-level risk · no lesion
 *     localisation"). No scale numerals at rest.
 */
export interface LegendChipProps {
  className?: string;
}

export function LegendChip({ className }: LegendChipProps) {
  const selected = useViewerStore((s) => s.selectedStructure);
  const index = useSchemaIndex();
  const target = index?.targets.find((t) => t.id === (selected ?? 'CAD'));
  const threshold = target?.threshold ?? null;
  return (
    <StageCard
      as="div"
      shape="bare"
      region="legend"
      enterDelay={180}
      role="img"
      aria-label={`Risk colour scale from low to very high${threshold != null ? `; tick marks the ${target?.id} decision threshold` : ''}`}
      className={`flex h-[var(--toolbar-h)] w-[212px] items-center gap-2 px-3 max-[1439.98px]:w-[184px] ${className ?? ''}`}
    >
      <span className="text-label font-normal text-tertiary">Low</span>
      <span className="relative h-1.5 flex-1 rounded-xs" style={{ backgroundImage: riskGradientCss() }}>
        {threshold != null && (
          <span
            aria-hidden
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary"
            style={{ left: `${threshold * 100}%` }}
          />
        )}
      </span>
      <span className="whitespace-nowrap text-label font-normal text-secondary">Very high</span>
    </StageCard>
  );
}
