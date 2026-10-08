import { motion } from 'framer-motion';
import { DirectionMark, Skeleton, Tooltip } from '@/design';
import { cardLabel } from '@/features/patient/lib/values';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { ASSOCIATION_MARK, ASSOCIATION_NOTE, isAssociationOnly } from '@/lib/associations';
import { cn } from '@/lib/cn';
import { NEGLIGIBLE_SHAP, sortedContributions } from '@/lib/explain';
import { formatFeatureValue, formatNormalRange } from '@/lib/format';
import { useUiStore } from '@/state/uiStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import { EASE, MOTION } from '@/theme/tokens';
import type { Contribution, FeatureSpec, TargetId } from '@/types/contracts';
import type { PointsScale } from './attribution';
import type { ContributionUnit } from './explainPrefs';
import { ROW_GRID, useChangedFeatures } from './explainUi';
import { formatContribution, useExplainData, type ExplainData } from './useExplainData';

/** Half-width of the diverging bar, as a share of the bar column (the column is 80 or 104 px wide). */
const HALF_PCT = 50;


export interface ContributionRowProps {
  c: Contribution;
  spec: FeatureSpec | undefined;
  target: TargetId;
  /** Largest |SHAP| of the target: the shared bar scale. */
  max: number;
  unit: ContributionUnit;
  scale: PointsScale | null;
  /** The input changed since the previous estimate: 1.2 s accent rule. */
  changed?: boolean;
  /** Indent (rows under a modality header). */
  inset?: boolean;
  /** The printed-value formatter of the tab (largest-remainder rounded, so the rows add up to their totals). */
  fmt?: ExplainData['fmt'];
}

/**
 * One SHAP row (WORKSTATION_V2 §5.10 Why): direction tip ▶/◀ in the SHAP raise / lower colour · label ·
 * value + unit · diverging bar on a zero line (scale shared per target) · signed contribution. Hover links
 * the input (`highlightFeature`, never anatomy); click opens the Inputs drawer at that field. Negligible
 * rows (|shap| < 0.02) sit at 40 %.
 */
export function ContributionRow({ c, spec, target, max, unit, scale, changed, inset, fmt }: ContributionRowProps) {
  const lit = useUiStore((s) => s.highlightedFeature === c.feature);
  const highlight = useUiStore((s) => s.highlightFeature);
  const reduced = useIsReducedMotion();
  const negligible = Math.abs(c.shap) < NEGLIGIBLE_SHAP;
  const up = c.shap > 0;
  const share = Math.max(0.02, Math.min(1, Math.abs(c.shap) / max));
  const value = spec ? formatFeatureValue(spec, c.value as never) : String(c.value ?? '–');
  const label = spec?.label ?? c.feature;
  // The short card label ("Wall-motion abn.") in the row; the full one in the tooltip and aria-label.
  const shortLabel = spec ? cardLabel(spec) : c.feature;
  const f = fmt ? fmt(c.feature, c.shap, unit) : formatContribution(c.shap, unit, scale);
  const logodds = (fmt ? fmt(c.feature, c.shap, 'logodds') : formatContribution(c.shap, 'logodds', null)).text;
  const pts = fmt && scale ? fmt(c.feature, c.shap, 'points') : formatContribution(c.shap, 'points', scale);
  const range = spec?.normal ? formatNormalRange(spec.normal, spec.step) : '';
  const association = isAssociationOnly(c.feature);

  const tip = (
    <div className="flex max-w-[260px] flex-col gap-1">
      <span className="font-semibold text-primary">
        {label} · {value}
      </span>
      {range && <span className="text-secondary">{range}</span>}
      {spec?.description && <span className="text-secondary">{spec.description}</span>}
      {association && <span className="text-secondary">{ASSOCIATION_NOTE}</span>}
      <span className="text-primary">
        {negligible ? 'Negligible effect' : up ? 'Raises' : 'Lowers'} {target}: {logodds} log-odds
        {scale ? ` (${pts.text === '<1' ? '<1' : pts.text} pts)` : ''}
      </span>
      <span className="text-tertiary">Click to edit this input</span>
    </div>
  );

  return (
    <motion.li layout={reduced ? false : 'position'} transition={{ duration: MOTION.base / 1000, ease: EASE.out }}>
      <Tooltip content={tip} placement="left">
        <button
          type="button"
          onClick={() => useUiStore.getState().openDrawer('inputs', { field: c.feature })}
          onMouseEnter={() => highlight(c.feature)}
          onMouseLeave={() => highlight(null)}
          onFocus={() => highlight(c.feature)}
          onBlur={() => highlight(null)}
          aria-label={`${label}, ${value}, ${negligible ? 'negligible effect on' : up ? 'raises' : 'lowers'} ${target} risk, ${f.spoken}.${association ? ' Association only, not a known cause.' : ''} Edit this input.`}
          className={cn(
            'relative grid min-h-7 w-full items-center gap-x-2 rounded-sm py-0.5 pr-1 text-left outline-none transition-colors duration-instant',
            ROW_GRID,
            inset ? 'pl-3' : 'pl-1',
            'focus-visible:shadow-focus',
            lit ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]',
            negligible && 'opacity-40',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent transition-opacity',
              changed ? 'opacity-100 duration-fast' : 'opacity-0 duration-[600ms]',
            )}
          />
          <DirectionMark direction={negligible ? null : up ? 'raises' : 'lowers'} />
          <span className="text-body-s leading-4 text-secondary [overflow-wrap:break-word]">
            {shortLabel}
            {association && <span className="ml-0.5 text-tertiary">{ASSOCIATION_MARK}</span>}
          </span>
          <span className="num whitespace-nowrap text-right text-label font-normal text-tertiary">{value}</span>
          <span aria-hidden className="relative h-3">
            <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
            <span
              // LUMEN 2: bars grow out of the zero line when they appear and carry a soft glow of their colour.
              className="shap-bar absolute top-1/2 h-2 -translate-y-1/2 rounded-xs transition-[width,left] duration-base ease-out"
              style={{
                width: `${share * HALF_PCT}%`,
                left: up ? '50%' : `${50 - share * HALF_PCT}%`,
                backgroundColor: up ? SHAP_RAISES : SHAP_LOWERS,
                boxShadow: `0 0 8px ${up ? SHAP_RAISES : SHAP_LOWERS}66`,
                transformOrigin: up ? 'left center' : 'right center',
              }}
            />
          </span>
          <span className="num text-right text-numeral-m text-primary">{f.text}</span>
        </button>
      </Tooltip>
    </motion.li>
  );
}

/**
 * Compact contribution list for a target (legacy callers and teasers): the top `limit` rows by |SHAP| in
 * the viewer's unit. The Explain drawer's Why tab builds its grouped lists from `ContributionRow` directly.
 */
export function ShapWaterfall({ target, limit = 8 }: { target: string; limit?: number; compact?: boolean }) {
  const { index, explanation, scale, unit, fmt } = useExplainData(target);
  const changed = useChangedFeatures(explanation?.contributions);
  if (!explanation) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: Math.min(limit, 6) }, (_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    );
  }
  const rows = sortedContributions(explanation);
  const max = Math.max(1e-6, ...rows.map((r) => Math.abs(r.shap)));
  return (
    <ul className="flex flex-col" aria-label={`Contributions to ${target}, largest first`}>
      {rows.slice(0, limit).map((c) => (
        <ContributionRow
          key={c.feature}
          c={c}
          spec={index?.byKey.get(c.feature)}
          target={target}
          max={max}
          unit={unit}
          scale={scale}
          changed={changed.has(c.feature)}
          fmt={fmt}
        />
      ))}
    </ul>
  );
}
