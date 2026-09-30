import { Button, Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';
import { useCanReveal, useCathAgreement, useRiskView } from './useRiskView';

/**
 * Reveal, condensed (WORKSTATION_V2 §5.8 item 10): one ghost button, TEST patients only; the old caption
 * becomes its tooltip. After reveal it reads "Cath agrees on 3 of 4" and its tooltip lists every target,
 * misses included. Pressing it again hides the result. The cath result is always compared with the estimate
 * for the RECORDED inputs, never with a what-if.
 */
export function RevealControl({ short = false, className }: { short?: boolean; className?: string }) {
  const canReveal = useCanReveal();
  const revealed = usePatientStore((s) => s.revealed);
  const edits = useRiskView().edits;
  const agreement = useCathAgreement();
  if (!canReveal) return null;
  const toggle = () => usePatientStore.getState().setRevealed(!revealed);

  if (!revealed || !agreement) {
    return (
      <Tooltip content="Held-out test patient: never seen in training. Shows the angiography result beside each estimate, misses included.">
        <Button variant="ghost" aria-pressed={false} onClick={toggle} className={cn('shrink-0 px-2.5', className)} data-tour="reveal">
          {short ? 'Reveal' : 'Reveal cath result'}
        </Button>
      </Tooltip>
    );
  }

  const list = (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-primary">Catheterisation result vs this estimate</span>
      {agreement.rows.map(({ target, cmp }) => (
        <span key={target} className="flex items-center gap-1.5 text-secondary">
          <span className="w-8 font-semibold text-primary">{target}</span>
          <span aria-hidden>{cmp.truth === 1 ? '●' : '○'}</span>
          {cmp.truthText} · {cmp.agreementText}
        </span>
      ))}
      {edits > 0 && <span className="text-tertiary">Compared with the recorded inputs, not your edits.</span>}
      <span className="text-tertiary">Press to hide the result.</span>
    </div>
  );
  return (
    <Tooltip content={list}>
      <Button variant="ghost" aria-pressed onClick={toggle} className={cn('shrink-0 px-2.5 text-primary', className)} data-tour="reveal">
        {short ? `Cath ${agreement.agree}/${agreement.rows.length}` : `Cath agrees on ${agreement.agree} of ${agreement.rows.length}`}
      </Button>
    </Tooltip>
  );
}
