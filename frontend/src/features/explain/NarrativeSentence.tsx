import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { buildNarrative, narrativeText, type NarrativePart } from '@/lib/explain';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';

/**
 * A linked phrase: dotted underline; hover or focus highlights the matching input row and SHAP row
 * (`highlightFeature`, never anatomy); click or Enter opens the Inputs drawer at that field.
 */
export function PhraseLink({ part, className }: { part: NarrativePart; className?: string }) {
  const highlight = useUiStore((s) => s.highlightFeature);
  const lit = useUiStore((s) => part.feature !== undefined && s.highlightedFeature === part.feature);
  const open = () => part.feature && useUiStore.getState().openDrawer('inputs', { field: part.feature });
  return (
    <button
      type="button"
      onClick={open}
      onMouseEnter={() => highlight(part.feature ?? null)}
      onMouseLeave={() => highlight(null)}
      onFocus={() => highlight(part.feature ?? null)}
      onBlur={() => highlight(null)}
      aria-label={`${part.text}: edit this input`}
      className={cn(
        'inline rounded-xs text-left underline decoration-dotted decoration-1 underline-offset-[3px] outline-none transition-colors duration-instant',
        'focus-visible:shadow-focus',
        lit ? 'text-primary decoration-accent' : 'decoration-line-strong hover:text-primary hover:decoration-secondary',
        className,
      )}
    >
      {part.text}
    </button>
  );
}

export function NarrativeParts({ parts }: { parts: NarrativePart[] }) {
  return (
    <>
      {parts.map((part, i) => (part.kind === 'phrase' ? <PhraseLink key={i} part={part} /> : <span key={i}>{part.text}</span>))}
    </>
  );
}

/**
 * The template "why" sentence for one target (WORKSTATION_V2 §5.8 item 5, §5.10 grammar):
 * "Driven mostly by typical angina and hypertension; normal wall motion pulls it down." No numbers.
 * Crossfades over `fast` when the text changes (instant under reduced motion).
 */
export function NarrativeSentence({ target, className }: { target: string; className?: string }) {
  const index = useSchemaIndex();
  const explanation = usePatientStore((s) => selectDisplayedPrediction(s)?.explanations[target]);
  const reduced = useIsReducedMotion();
  const parts = useMemo(
    () => (explanation && index ? buildNarrative(explanation, (k) => index.byKey.get(k)) : null),
    [explanation, index],
  );
  if (!parts) return null;
  const text = narrativeText(parts);

  return (
    <div className={cn('relative', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.p
          key={text}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : MOTION.fast / 1000, ease: EASE.out }}
          className="text-body-s text-secondary [line-height:20px]"
        >
          <NarrativeParts parts={parts} />
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
