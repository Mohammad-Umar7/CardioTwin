import { useState } from 'react';
import { Button, Skeleton, Tooltip } from '@/design';
import { usePortableModel, useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { NEGLIGIBLE_SHAP, platt, sortedContributions } from '@/lib/explain';
import { formatFeatureValue, formatNormalRange, formatProbability, formatShap, formatSigned } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import type { Contribution, FeatureSpec } from '@/types/contracts';

const BAR_MAX_PX = 96;

function ShapRow({
  c,
  spec,
  target,
  scale,
}: {
  c: Contribution;
  spec: FeatureSpec | undefined;
  target: string;
  scale: number;
}) {
  const highlighted = useUiStore((s) => s.highlightedFeature === c.feature);
  const highlight = useUiStore((s) => s.highlightFeature);
  const negligible = Math.abs(c.shap) < NEGLIGIBLE_SHAP;
  const width = Math.max(1, Math.min(BAR_MAX_PX, (Math.abs(c.shap) / scale) * BAR_MAX_PX));
  const up = c.shap > 0;
  const value = spec ? formatFeatureValue(spec, c.value as never) : String(c.value ?? '–');
  const label = spec?.label ?? c.feature;
  const spoken = `${label}, ${value}, ${negligible ? 'negligible effect on' : up ? 'raises' : 'lowers'} ${target} risk, ${
    up ? 'plus' : 'minus'
  } ${Math.abs(c.shap).toFixed(2)} log-odds`;
  const tooltip = (
    <div className="flex flex-col gap-1">
      <div className="font-semibold">
        {label} <span className="mono font-normal text-tertiary">{c.feature}</span>
      </div>
      <div className="text-secondary">
        Value {value}
        {spec?.normal ? ` · ${formatNormalRange(spec.normal, spec.step)}` : ''}
      </div>
      {spec?.description && <div className="text-secondary">{spec.description}</div>}
      <div>
        {up ? 'Raises' : 'Lowers'} {target} log-odds by {Math.abs(c.shap).toFixed(2)}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltip} placement="left">
      <li
        tabIndex={0}
        aria-label={spoken}
        onMouseEnter={() => highlight(c.feature)}
        onMouseLeave={() => highlight(null)}
        onFocus={() => highlight(c.feature)}
        onBlur={() => highlight(null)}
        className={cn(
          'grid h-6 grid-cols-[minmax(0,1fr)_auto_104px_48px] items-center gap-2 rounded-xs px-1 outline-none transition-colors duration-fast',
          highlighted ? 'bg-surface-2' : 'hover:bg-surface-1',
          negligible && 'text-tertiary',
        )}
      >
        <span className={cn('truncate text-body-s', negligible ? 'text-tertiary' : 'text-secondary')}>{label}</span>
        <span className="num whitespace-nowrap text-label font-normal text-tertiary">{value}</span>
        <span aria-hidden className="relative flex h-3 items-center justify-center">
          <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
          <span
            className="absolute h-2 rounded-xs transition-[width,left] duration-base ease-out"
            style={{
              width: width / 2,
              left: up ? '50%' : `calc(50% - ${width / 2}px)`,
              backgroundColor: up ? SHAP_RAISES : SHAP_LOWERS,
              opacity: negligible ? 0.4 : 1,
            }}
          />
        </span>
        <span className="num text-right text-numeral-m text-primary">
          <span aria-hidden className="mr-0.5 text-[0.6875rem] text-tertiary">
            {negligible ? '' : up ? '▶' : '◀'}
          </span>
          {formatShap(c.shap)}
        </span>
      </li>
    </Tooltip>
  );
}

/**
 * ShapWaterfall (DESIGN_SYSTEM §5): per-feature SHAP in log-odds, top 8 + "show all", diverging bars on a
 * scale shared per target, ▶/◀ plus sign, and the footer "typical X % → this patient Y %" computed with
 * the model's Platt calibration. Row hover highlights the input row, never anatomy.
 */
export function ShapWaterfall({ target, limit = 8, compact = false }: { target: string; limit?: number; compact?: boolean }) {
  const index = useSchemaIndex();
  const prediction = usePatientStore((s) => s.prediction);
  const model = usePortableModel();
  const [expanded, setExpanded] = useState(false);
  const explanation = prediction?.explanations[target];
  const p = prediction?.predictions[target];

  if (!prediction || !explanation || !p) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: compact ? 4 : 6 }, (_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    );
  }

  const rows = sortedContributions(explanation);
  const shown = expanded ? rows : rows.slice(0, limit);
  const scale = Math.max(...rows.map((r) => Math.abs(r.shap)), 1e-6);
  const calib = model.data?.models[target]?.calibration;
  const typical = calib ? platt(explanation.base_value, calib.a, calib.b) : null;

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && (
        <div className="num flex items-center justify-between text-[0.6875rem] text-tertiary">
          <span>log-odds · base E[f(x)] → f(x)</span>
          <span>
            {formatSigned(explanation.base_value)} → <span className="text-secondary">{formatSigned(explanation.output_value)}</span>
          </span>
        </div>
      )}
      <ul className="flex flex-col" aria-label={`Feature contributions to ${target}, largest first`}>
        {shown.map((c) => (
          <ShapRow key={c.feature} c={c} spec={index?.byKey.get(c.feature)} target={target} scale={scale} />
        ))}
      </ul>
      {!compact && rows.length > limit && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show top 8' : `+ ${rows.length - limit} more · show all`}
        </Button>
      )}
      {!compact && typical !== null && (
        <p className="num flex items-center gap-1.5 border-t border-hairline pt-2 text-label font-normal text-secondary">
          <Tooltip content="The model's calibrated probability for a typical patient of this cohort (base value), then for this patient after adding every contribution.">
            <span tabIndex={0}>
              typical {formatProbability(typical).text} → this patient{' '}
              <span className="font-semibold text-primary">{formatProbability(p.probability).text}</span>
            </span>
          </Tooltip>
        </p>
      )}
    </div>
  );
}
