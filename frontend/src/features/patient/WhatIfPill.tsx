import { AnimatePresence, motion } from 'framer-motion';
import { Columns2, RotateCcw } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { StageCard, Tooltip } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SHORTCUT } from '@/state/commandIds';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';
import { resetAllEdits } from './profileActions';

/**
 * WhatIfPill — WORKSTATION_V2 §5.7, §8.4: `● What-if · 2 changes · [Hold to compare] · [Reset]` in the
 * stage's context slot, only while edits exist (`data-region="whatif-pill"`). The stage frame itself is
 * drawn by StageLayout (`frame`, wired to the edit count by WorkstationPage).
 *
 *   • "2 changes" opens the Inputs drawer on its "Changed" section.
 *   • Hold to compare: press and hold (pointer, or Space while focused) to show the RECORDED prediction
 *     everywhere that reads `selectDisplayedPrediction`; release returns to the what-if. `aria-pressed`
 *     mirrors the state. Shown only once the automatic baseline exists (nothing dead on screen).
 *   • Reset asks nothing and offers Undo in a toast; the pill leaves once the numbers have tweened back.
 */
export interface WhatIfPillProps {
  className?: string;
}

/** Typing into a field never triggers the hold (the palette's input, a number field, a textarea). */
const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'));

const isCompareKey = (e: globalThis.KeyboardEvent) =>
  e.key.toUpperCase() === SHORTCUT.compare && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

function useHoldToCompare(enabled: boolean) {
  const comparing = usePatientStore((s) => s.comparing);
  const setComparing = usePatientStore((s) => s.setComparing);
  // Never leave the app stuck on the recorded state (unmount, window blur).
  useEffect(() => {
    const release = () => usePatientStore.getState().setComparing(false);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      release();
    };
  }, []);
  // Hold R anywhere on the workstation (keyboard-only demo): press shows the recorded estimate, release
  // returns to the what-if. The guided demo suspends single-key shortcuts before they reach this listener.
  useEffect(() => {
    if (!enabled) return;
    const down = (e: globalThis.KeyboardEvent) => {
      if (!isCompareKey(e) || isTypingTarget(e.target) || e.defaultPrevented) return;
      e.preventDefault();
      if (!e.repeat) usePatientStore.getState().setComparing(true);
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key.toUpperCase() !== SHORTCUT.compare) return;
      usePatientStore.getState().setComparing(false);
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }, [enabled]);
  return {
    comparing,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        // Primary button only (a right-click must not stick the compare state on).
        if (e.button > 0) return;
        setComparing(true);
        // Keep receiving the release even if the pointer slides off the button.
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* not an active pointer (synthetic events): the pointerup handler still ends the hold */
        }
      },
      onPointerUp: () => setComparing(false),
      onPointerCancel: () => setComparing(false),
      onLostPointerCapture: () => setComparing(false),
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (!e.repeat) setComparing(true);
        }
      },
      onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          setComparing(false);
        }
      },
      onBlur: () => setComparing(false),
      onClick: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

function Pill({ edits, className }: { edits: number; className?: string }) {
  const canCompare = usePatientStore((s) => s.recordedPrediction !== null);
  const { comparing, handlers } = useHoldToCompare(canCompare);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const sep = <span aria-hidden className="h-4 w-px bg-hairline" />;

  return (
    <StageCard as="div" shape="chip" region="whatif-pill" noEnter aria-label="What-if" role="group" className={cn('gap-1.5 pl-3 pr-1', className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full transition-colors duration-fast', comparing ? 'bg-secondary' : 'bg-accent')} />
      <span className="text-body-s font-semibold text-primary">{comparing ? 'Recorded' : 'What-if'}</span>
      <button
        type="button"
        onClick={() => openDrawer('inputs', { section: 'changed' })}
        className="num rounded-sm px-1 text-label font-normal text-secondary transition-colors duration-instant hover:text-primary"
      >
        <span className="sr-only">Show the </span>
        {edits} {edits === 1 ? 'change' : 'changes'}
      </button>
      {canCompare && (
        <>
          {sep}
          <Tooltip content={`Hold to show the recorded estimate · hold ${SHORTCUT.compare} (or Space here)`}>
            <button
              type="button"
              aria-pressed={comparing}
              aria-keyshortcuts={SHORTCUT.compare}
              {...handlers}
              className={cn(
                'inline-flex h-6 select-none items-center gap-1.5 rounded-full px-2 text-label transition-colors duration-instant',
                comparing ? 'bg-surface-2 text-accent' : 'text-secondary hover:bg-surface-2 hover:text-primary',
              )}
            >
              <Columns2 aria-hidden className="size-3.5 stroke-[1.5]" />
              Hold to compare
            </button>
          </Tooltip>
        </>
      )}
      {sep}
      <button
        type="button"
        onClick={resetAllEdits}
        className="inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-label text-secondary transition-colors duration-instant hover:bg-surface-2 hover:text-primary"
      >
        <RotateCcw aria-hidden className="size-3.5 stroke-[1.5]" />
        Reset
      </button>
      <span className="sr-only" aria-live="polite">
        {comparing ? 'Showing the recorded estimate' : ''}
      </span>
    </StageCard>
  );
}

/** After a reset the numbers tween back over `data` (420 ms); the pill leaves once they have landed (§8.4). */
const EXIT_AFTER_RESET_MS = MOTION.data;

function useLingeringCount(edits: number, reduced: boolean): number {
  const [shown, setShown] = useState(edits);
  useEffect(() => {
    if (edits > 0 || reduced) {
      setShown(edits);
      return;
    }
    const t = window.setTimeout(() => setShown(0), EXIT_AFTER_RESET_MS);
    return () => window.clearTimeout(t);
  }, [edits, reduced]);
  return edits > 0 ? edits : shown;
}

export function WhatIfPill({ className }: WhatIfPillProps) {
  const liveEdits = usePatientStore(selectEditCount);
  const reduced = useIsReducedMotion();
  const edits = useLingeringCount(liveEdits, reduced);
  return (
    <AnimatePresence>
      {edits > 0 && (
        <motion.div
          key="whatif"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: 0.11, ease: EASE.exit } }}
          transition={{ duration: MOTION.fast / 1000, ease: EASE.out }}
        >
          <Pill edits={edits} className={className} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
