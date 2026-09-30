import { AnimatePresence, motion } from 'framer-motion';
import { BandChip, Kbd, Probability, StageCard, Tooltip } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SHORTCUT } from '@/state/commandIds';
import { useUiStore } from '@/state/uiStore';
import { EASE } from '@/theme/tokens';
import { useRiskView } from './useRiskView';
import { flaggedCount } from './verdict';

export interface AnswerPillProps {
  className?: string;
}

/** Leave focus mode and put keyboard focus on the Risk card once it is back. */
function exitToRiskCard() {
  useUiStore.getState().setChrome('workstation');
  window.setTimeout(() => document.getElementById('risk-summary')?.focus({ preventScroll: true }), 260);
}

/**
 * AnswerPill — WORKSTATION_V2 §5.16: `CAD 98 % ▌VERY HIGH · 3 of 3 flagged · Exit \`. The fallback home of
 * P(CAD) while focus mode hides the Risk card (the numeral carries `data-prob="CAD"`). h 40, stage-card
 * material, r-full, top-right at the stage inset. Enters over `base` after 120 ms; exits over 170 ms.
 * Clicking the numeral exits focus mode and focuses the Risk card.
 */
export function AnswerPill({ className }: AnswerPillProps) {
  const chrome = useUiStore((s) => s.chrome);
  const index = useSchemaIndex();
  const view = useRiskView();
  const reduced = useIsReducedMotion();
  const cad = view.prediction?.predictions.CAD;
  const count = flaggedCount(view.prediction, (index?.vessels ?? []).map((v) => v.id));

  return (
    <AnimatePresence>
      {chrome === 'focus' && (
        <motion.div
          key="answer-pill"
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.17, ease: EASE.exit }}
          className={cn('absolute right-[var(--stage-inset)] top-[var(--stage-inset)]', className)}
        >
          <StageCard as="div" shape="chip" region="answer-pill" enterDelay={120} className="h-10 gap-3 pl-1.5 pr-1.5">
            {/* The numbers below are hypothetical while inputs are edited: say so here too (the what-if pill
                and the stage frame are hidden in focus mode). */}
            {view.edits > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-1.5 whitespace-nowrap text-label font-medium text-primary">
                <span aria-hidden className={cn('size-1.5 rounded-full', view.comparing ? 'bg-secondary' : 'bg-accent')} />
                {view.comparing ? 'Recorded' : `What-if · ${view.edits} ${view.edits === 1 ? 'change' : 'changes'}`}
              </span>
            )}
            <Tooltip content="Back to the Risk card">
              <button
                type="button"
                onClick={exitToRiskCard}
                aria-label="Coronary artery disease estimate: exit focus mode and show the Risk card"
                className="flex h-8 items-center gap-2 rounded-full px-2.5 outline-none hover:bg-surface-2 focus-visible:shadow-focus"
              >
                <span className="text-body-s font-semibold text-secondary">CAD</span>
                <Probability
                  p={cad?.probability}
                  target="CAD"
                  size="l"
                  stale={view.stale}
                  className="[&_.pct-sign]:font-normal"
                />
              </button>
            </Tooltip>
            <BandChip band={cad?.risk_band ?? null} pending={view.stale || !cad} size="sm" showMeter={false} />
            {count && (
              <span className="whitespace-nowrap text-label font-normal text-secondary">
                {view.stale ? 'Updating' : count.text}
              </span>
            )}
            <span aria-hidden className="h-5 w-px bg-hairline" />
            <button
              type="button"
              onClick={() => useUiStore.getState().setChrome('workstation')}
              aria-keyshortcuts={SHORTCUT.focusMode}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-label text-secondary outline-none hover:bg-surface-2 hover:text-primary focus-visible:shadow-focus"
            >
              Exit <Kbd>{SHORTCUT.focusMode}</Kbd>
            </button>
          </StageCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
