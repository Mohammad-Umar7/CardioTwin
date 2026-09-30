import { Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import type { TargetId } from '@/types/contracts';
import type { ModalityRow, PointsScale } from './attribution';
import type { ContributionUnit } from './explainPrefs';
import { formatContribution } from './useExplainData';

/** Column captions: short enough for seven columns in a 400 px drawer. */
const SHORT: Record<string, string> = {
  demographics: 'Demo',
  risk_factors: 'History',
  symptoms: 'Symptoms',
  exam: 'Exam',
  ecg: 'ECG',
  labs: 'Labs',
  echo: 'Echo',
};

/** Half-height of a column's bar area (px). */
const HALF = 18;

export interface ModalityStripProps {
  rows: ModalityRow[];
  target: TargetId;
  unit: ContributionUnit;
  scale: PointsScale | null;
  /** Feature labels for the tooltips. */
  labelOf(feature: string): string;
  /** A column was chosen: show the evidence grouped by modality, at that modality. */
  onPick?(group: string): void;
  active?: string | null;
}

/**
 * Evidence by data modality — the multimodal fingerprint of one estimate (Why tab). Seven columns in
 * acquisition order (demographics → echo); each is the signed sum of its inputs' exact SHAP values, drawn up
 * (raises, SHAP raise colour) or down (lowers) from one zero line on a scale shared by the seven, with the
 * value under it: "ECG +0.42". The tooltip names the inputs behind it.
 */
export function ModalityStrip({ rows, target, unit, scale, labelOf, onPick, active }: ModalityStripProps) {
  const max = Math.max(1e-6, ...rows.map((r) => Math.abs(r.sum)));
  const lead = [...rows].sort((a, b) => b.abs - a.abs)[0];
  return (
    <section aria-labelledby="modality-title" className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between gap-2">
        <h3 id="modality-title" className="eyebrow text-secondary">
          By data modality
        </h3>
        {lead && lead.abs > 0 && (
          <span className="truncate text-label font-normal text-tertiary">
            {Math.round(lead.share * 100)}&thinsp;% of the evidence from {lead.label.toLowerCase().replace(/^resting ecg$/, 'the ECG')}
          </span>
        )}
      </div>
      <ul className="-mx-1 flex justify-between" aria-label={`Contribution of each data modality to ${target}`}>
        {rows.map((r) => {
          const up = r.sum >= 0;
          const h = r.abs === 0 ? 0 : Math.max(2, (Math.abs(r.sum) / max) * HALF);
          const f = formatContribution(r.sum, unit, scale);
          const top = r.contributions.filter((c) => Math.abs(c.shap) >= 0.005).slice(0, 4);
          const tip = (
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-primary">
                {r.label}: {r.abs === 0 ? 'no effect' : `${up ? 'raises' : 'lowers'} ${target} by ${formatContribution(Math.abs(r.sum), unit, scale).text.replace('+', '')} ${unit === 'points' ? 'pts' : 'log-odds'}`}
              </span>
              {top.map((c) => (
                <span key={c.feature} className="flex justify-between gap-3 text-secondary">
                  <span>{labelOf(c.feature)}</span>
                  <span className="num text-primary">{formatContribution(c.shap, unit, scale).text}</span>
                </span>
              ))}
              {r.contributions.length === 0 && <span className="text-tertiary">No inputs of this kind</span>}
              <span className="text-tertiary">Share of all evidence: {Math.round(r.share * 100)}&thinsp;%</span>
            </div>
          );
          return (
            <li key={r.group}>
              <Tooltip content={tip} placement="bottom">
                <button
                  type="button"
                  onClick={() => onPick?.(r.group)}
                  aria-pressed={active === r.group}
                  aria-label={`${r.label}: ${r.abs === 0 ? 'no effect' : `${up ? 'raises' : 'lowers'} ${target}, ${f.spoken}`}. Show its inputs.`}
                  className={cn(
                    'flex min-w-10 flex-col items-center gap-1 rounded-sm px-1 py-1 outline-none transition-colors duration-instant',
                    'hover:bg-surface-1 focus-visible:shadow-focus',
                    active === r.group && 'bg-surface-2',
                  )}
                >
                  <span className={cn('text-label font-normal', r.share >= 0.2 ? 'text-primary' : 'text-tertiary')}>
                    {SHORT[r.group] ?? r.short}
                  </span>
                  <span aria-hidden className="relative block w-full" style={{ height: HALF * 2 }}>
                    <span className="absolute inset-x-1 top-1/2 h-px bg-line-strong" />
                    <span
                      className="absolute left-1/2 w-3 -translate-x-1/2 rounded-xs transition-[height,top] duration-base ease-out"
                      style={{
                        height: h,
                        top: up ? HALF - h : HALF,
                        backgroundColor: up ? SHAP_RAISES : SHAP_LOWERS,
                        opacity: r.abs === 0 ? 0 : 1,
                      }}
                    />
                  </span>
                  <span className={cn('num text-numeral-m', r.abs < 0.02 ? 'text-tertiary' : 'text-primary')}>
                    {r.abs === 0 ? '–' : f.text}
                  </span>
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
