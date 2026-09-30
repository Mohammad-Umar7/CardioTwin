import { StageCard } from '@/design';
import { selectEditCount, usePatientStore } from '@/state/patientStore';

/**
 * WhatIfPill — WORKSTATION_V2 §5.7: `● What-if · 2 changes · [Hold to compare] · [Reset]`. Rendered in
 * StageLayout's `top` (context) slot, after the selection chip. The stage frame is drawn by StageLayout
 * (`frame` prop, wired to the edit count by WorkstationPage).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent B on creation; A never edits this file again.
 *
 * Contract:
 *   export interface WhatIfPillProps { className?: string }
 *   - Renders nothing while `selectEditCount(patientStore) === 0`.
 *   - Hold to compare: `setComparing(true)` on press, `false` on release; everyone who shows numbers reads
 *     `selectDisplayedPrediction` (recorded baseline while comparing). Keyboard: Space-hold, `aria-pressed`.
 *   - Reset: `resetAll()` + an Undo toast (6 s) via `uiStore.pushToast`.
 *   - Material: StageCard `shape="chip"` (h 32, r-full), `data-region="whatif-pill"`.
 */
export interface WhatIfPillProps {
  className?: string;
}

export function WhatIfPill({ className }: WhatIfPillProps) {
  const edits = usePatientStore(selectEditCount);
  const resetAll = usePatientStore((s) => s.resetAll);
  if (edits === 0) return null;
  return (
    <StageCard as="div" shape="chip" region="whatif-pill" className={className}>
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      <span className="text-body-s font-semibold text-primary">What-if</span>
      <span className="text-label font-normal text-secondary">
        {edits} {edits === 1 ? 'change' : 'changes'}
      </span>
      <button
        type="button"
        onClick={resetAll}
        className="rounded-sm px-1 text-label font-medium text-secondary hover:text-primary"
      >
        Reset
      </button>
    </StageCard>
  );
}
