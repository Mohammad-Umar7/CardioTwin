import { useMemo } from 'react';
import { Skeleton, Toggle, Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { NEGLIGIBLE_SHAP } from '@/lib/explain';
import { formatFeatureValue, formatNormalRange, rangeStatus, type RangeStatus } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import type { FeatureSpec } from '@/types/contracts';
import { setExplainPrefs, useExplainPrefs } from './explainPrefs';
import { formatContribution, unitLabel, useExplainData } from './useExplainData';


/**
 * Reference mini-bar: the input's range as a 4 px track, the normal band in white at 8 % with 1 px edges, and
 * the value as a neutral dot (never red: out-of-range is said in words and ▲/▼, LUMEN §2.2 rule 7).
 */
function RangeBar({ spec, value }: { spec: FeatureSpec; value: number }) {
  const low = spec.normal?.low ?? null;
  const high = spec.normal?.high ?? null;
  const min = Math.min(spec.min ?? value, value, low ?? Infinity);
  const max = Math.max(spec.max ?? value, value, high ?? -Infinity);
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100))}%`;
  return (
    <span aria-hidden className="relative block h-3">
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2" />
      {(low !== null || high !== null) && (
        <span
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-xs bg-white/[0.08] shadow-[inset_1px_0_0_rgb(var(--c-border-strong)),inset_-1px_0_0_rgb(var(--c-border-strong))]"
          style={{ left: pos(low ?? min), right: `calc(100% - ${pos(high ?? max)})`, minWidth: 2 }}
        />
      )}
      <span
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-panel transition-[left] duration-data ease-data"
        style={{ left: pos(value) }}
      />
    </span>
  );
}

const STATUS_TEXT: Record<RangeStatus, string> = { above: 'above', below: 'below', within: '' };

/**
 * Physiology (WORKSTATION_V2 §5.10): every measured value with its unit, a reference-range bar, its status
 * in words and its contribution to the selected target; "Abnormal only" on by default. Then the findings that
 * are present, as chips with their direction. Rows and chips link to the input (hover highlights it, click
 * opens it in the Inputs drawer).
 */
export function PhysiologyTable({ target }: { target: string }) {
  const d = useExplainData(target);
  const prefs = useExplainPrefs();
  const features = usePatientStore((s) => s.features);
  const lit = useUiStore((s) => s.highlightedFeature);
  const highlight = useUiStore((s) => s.highlightFeature);
  const open = (key: string) => useUiStore.getState().openDrawer('inputs', { field: key });

  const shapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of d.explanation?.contributions ?? []) m.set(c.feature, c.shap);
    return m;
  }, [d.explanation]);

  if (!d.index) return <Skeleton className="h-40" />;

  const numeric = d.index.features
    .filter((s) => s.type === 'numeric' && typeof features[s.key] === 'number')
    .map((spec) => ({ spec, value: features[spec.key] as number, status: rangeStatus(features[spec.key] as number, spec.normal) }));
  const abnormal = numeric.filter((r) => r.status === 'above' || r.status === 'below');
  const rows = (prefs.abnormalOnly ? abnormal : numeric).sort(
    (a, b) => Math.abs(shapOf.get(b.spec.key) ?? 0) - Math.abs(shapOf.get(a.spec.key) ?? 0),
  );
  const present = d.index.features
    .filter((s) => s.type === 'binary' && (features[s.key] === 1 || features[s.key] === '1'))
    .sort((a, b) => Math.abs(shapOf.get(b.key) ?? 0) - Math.abs(shapOf.get(a.key) ?? 0));

  return (
    <div className={cn('flex flex-col gap-6', d.stale && 'opacity-50')}>
      <section aria-labelledby="physio-values" className="flex flex-col">
        <div className="flex h-7 items-end justify-between border-b border-hairline pb-1">
          <h3 id="physio-values" className="eyebrow text-secondary">
            Measured values <span className="ml-1 text-tertiary">{rows.length}</span>
          </h3>
          <Toggle pressed={prefs.abnormalOnly} onPressedChange={(abnormalOnly) => setExplainPrefs({ abnormalOnly })} className="-mb-0.5">
            Abnormal only
          </Toggle>
        </div>
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">
            Measured inputs with their reference ranges and their contribution to {target} ({unitLabel(d.unit)})
          </caption>
          <colgroup>
            <col />
            <col className="w-[92px]" />
            <col className="w-[72px]" />
            <col className="w-[60px]" />
            <col className="w-[40px]" />
          </colgroup>
          <thead>
            <tr className="h-7">
              <th scope="col" className="eyebrow pl-1 text-left text-tertiary">
                Measure
              </th>
              <th scope="col" className="eyebrow pr-2 text-right text-tertiary">
                Value
              </th>
              <th scope="col" className="eyebrow text-left text-tertiary">
                Normal
              </th>
              <th scope="col">
                <span className="sr-only">Status</span>
              </th>
              <th scope="col" className="pr-1 text-right text-label font-normal text-tertiary">
                {unitLabel(d.unit)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ spec, value, status }) => {
              const shap = shapOf.get(spec.key);
              const f = typeof shap === 'number' ? formatContribution(shap, d.unit, d.scale) : null;
              const range = formatNormalRange(spec.normal, spec.step);
              return (
                <tr
                  key={spec.key}
                  onClick={() => open(spec.key)}
                  onMouseEnter={() => highlight(spec.key)}
                  onMouseLeave={() => highlight(null)}
                  className={cn(
                    'h-8 cursor-pointer transition-colors duration-instant [&>*:first-child]:rounded-l-sm [&>*:last-child]:rounded-r-sm',
                    lit === spec.key ? 'bg-surface-2' : 'hover:bg-surface-1',
                  )}
                >
                  <th scope="row" className="truncate pl-1 text-left font-normal">
                    <Tooltip content={[spec.description, range].filter(Boolean).join(' · ') || spec.label}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(spec.key);
                        }}
                        onFocus={() => highlight(spec.key)}
                        onBlur={() => highlight(null)}
                        aria-label={`${spec.label}, ${formatFeatureValue(spec, value)}${status && status !== 'within' ? `, ${status} normal` : ''}${range ? `, ${range}` : ''}${f ? `, ${f.spoken} for ${target}` : ''}. Edit this input.`}
                        className="max-w-full truncate rounded-xs text-left text-body-s text-secondary outline-none focus-visible:shadow-focus"
                      >
                        {spec.label}
                      </button>
                    </Tooltip>
                  </th>
                  <td className="num whitespace-nowrap pr-2 text-right text-body-s font-medium text-primary">{formatFeatureValue(spec, value)}</td>
                  <td>{spec.normal && (spec.normal.low !== null || spec.normal.high !== null) ? <RangeBar spec={spec} value={value} /> : null}</td>
                  <td className="whitespace-nowrap pl-2 text-label font-normal text-secondary">
                    {status === 'above' && '▲ '}
                    {status === 'below' && '▼ '}
                    {status ? STATUS_TEXT[status] : ''}
                  </td>
                  <td className={cn('num pr-1 text-right text-numeral-m', shap !== undefined && Math.abs(shap) < NEGLIGIBLE_SHAP ? 'text-tertiary' : 'text-primary')}>
                    {f?.text ?? '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-1 pt-3 text-body-s text-tertiary">Every measured value is within its reference range.</p>
        )}
      </section>

      <section aria-labelledby="physio-findings">
        <div className="flex h-7 items-end border-b border-hairline pb-1">
          <h3 id="physio-findings" className="eyebrow text-secondary">
            Findings present <span className="ml-1 text-tertiary">{present.length}</span>
          </h3>
        </div>
        {present.length === 0 ? (
          <p className="px-1 pt-3 text-body-s text-tertiary">No findings recorded as present.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Findings present">
            {present.map((s) => {
              const shap = shapOf.get(s.key) ?? 0;
              const up = shap > 0;
              const f = formatContribution(shap, d.unit, d.scale);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => open(s.key)}
                    onMouseEnter={() => highlight(s.key)}
                    onMouseLeave={() => highlight(null)}
                    aria-label={`${s.label}: present, ${Math.abs(shap) < NEGLIGIBLE_SHAP ? 'negligible effect' : `${up ? 'raises' : 'lowers'} ${target}, ${f.spoken}`}. Edit this input.`}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 text-label text-primary outline-none transition-colors duration-instant',
                      'hover:bg-surface-2 focus-visible:shadow-focus',
                      lit === s.key && 'border-line-strong bg-surface-2',
                    )}
                  >
                    {Math.abs(shap) >= NEGLIGIBLE_SHAP && (
                      <span aria-hidden className="text-[10px] leading-none" style={{ color: up ? SHAP_RAISES : SHAP_LOWERS }}>
                        {up ? '▶' : '◀'}
                      </span>
                    )}
                    {s.label}
                    <span className="num font-normal text-tertiary">{Math.abs(shap) >= NEGLIGIBLE_SHAP ? f.text : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-label font-normal text-tertiary">
        Reference ranges are general adult ranges for orientation. ▲ / ▼ mark values above or below them; nothing here is
        coloured by risk.
      </p>
    </div>
  );
}
