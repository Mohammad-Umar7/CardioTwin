import { AnimatePresence, motion } from 'framer-motion';
import { useSchemaIndex } from '@/hooks/useData';
import { buildNarrative, narrativeText } from '@/lib/explain';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';

/**
 * NarrativeSentence (DESIGN_SYSTEM §5): "LAD 72 %, high. Typical chest pain and age push it up; a normal
 * FBS pulls it down." Template-built from the SHAP contributions (no LLM). Phrases have a dotted underline;
 * hovering one highlights its input row and SHAP row. Crossfades (160 ms) when the text changes.
 */
export function NarrativeSentence({ target }: { target: string }) {
  const index = useSchemaIndex();
  const prediction = usePatientStore((s) => s.prediction);
  const highlight = useUiStore((s) => s.highlightFeature);
  const p = prediction?.predictions[target];
  if (!p || !index) return null;
  const parts = buildNarrative(target, p.probability, p.risk_band, prediction.explanations[target], (k) => index.byKey.get(k));
  const text = narrativeText(parts);

  return (
    <div className="relative min-h-[42px]">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.p
          key={text}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: MOTION.fast / 1000, ease: EASE.out }}
          className="text-narrative text-primary"
        >
          {parts.map((part, i) =>
            part.kind === 'phrase' ? (
              <span
                key={i}
                tabIndex={0}
                onMouseEnter={() => highlight(part.feature ?? null)}
                onMouseLeave={() => highlight(null)}
                onFocus={() => highlight(part.feature ?? null)}
                onBlur={() => highlight(null)}
                className="cursor-help underline decoration-tertiary decoration-dotted underline-offset-[3px] outline-none hover:decoration-primary focus-visible:rounded-xs focus-visible:shadow-focus"
              >
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
