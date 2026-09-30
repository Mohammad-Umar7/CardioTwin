import { useMemo, useState } from 'react';
import { SegmentedControl, Skeleton, Toggle } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatFeatureValue, formatNormalRange, formatShap, rangeStatus } from '@/lib/format';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import type { FeatureSpec } from '@/types/contracts';

/** Reference mini-bar: track = feature range, normal band at white 8 %, value dot (neutral). */
function RangeBar({ spec, value }: { spec: FeatureSpec; value: number }) {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100))}%`;
  const low = spec.normal?.low ?? null;
  const high = spec.normal?.high ?? null;
  return (
    <span aria-hidden className="relative block h-2 w-full rounded-full bg-surface-2">
      {(low !== null || high !== null) && (
        <span
          className="absolute inset-y-0 rounded-full bg-white/[0.08]"
          style={{ left: pos(low ?? min), right: `calc(100% - ${pos(high ?? max)})` }}
        />
      )}
      <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: pos(value) }} />
    </span>
  );
}

/**
 * PhysiologyTable (DESIGN_SYSTEM §5): every input with its value, reference range mini-bar and SHAP for
 * the selected target. Sort by |SHAP| or by group; "abnormal only" filter; row hover links to the form.
 */
export function PhysiologyTable({ target }: { target: string }) {
  const index = useSchemaIndex();
  const features = usePatientStore((s) => s.features);
  const prediction = usePatientStore((s) => s.prediction);
  const highlighted = useUiStore((s) => s.highlightedFeature);
  const highlight = useUiStore((s) => s.highlightFeature);
  const [sort, setSort] = useState<'shap' | 'group'>('shap');
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  const shapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of prediction?.explanations[target]?.contributions ?? []) m.set(c.feature, c.shap);
    return m;
  }, [prediction, target]);

  if (!index) return <Skeleton className="h-40" />;

  let rows = index.features.map((spec) => ({
    spec,
    value: features[spec.key],
    shap: shapOf.get(spec.key),
    status: spec.type === 'numeric' ? rangeStatus(features[spec.key] as number, spec.normal) : null,
  }));
  if (abnormalOnly) rows = rows.filter((r) => r.status === 'above' || r.status === 'below');
  if (sort === 'shap') rows.sort((a, b) => Math.abs(b.shap ?? 0) - Math.abs(a.shap ?? 0));
  const scale = Math.max(...rows.map((r) => Math.abs(r.shap ?? 0)), 1e-6);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          label="Sort physiology table"
          size="xs"
          value={sort}
          onChange={(v) => setSort(v as 'shap' | 'group')}
          options={[
            { value: 'shap', label: '|SHAP|' },
            { value: 'group', label: 'Group' },
          ]}
        />
        <Toggle pressed={abnormalOnly} onPressedChange={setAbnormalOnly}>
          Abnormal only
        </Toggle>
      </div>
      <table className="w-full table-fixed border-collapse text-body-s">
        <caption className="sr-only">Clinical inputs with reference ranges and their contribution to {target}</caption>
        <thead>
          <tr className="text-left text-[0.6875rem] uppercase tracking-[0.08em] text-tertiary">
            <th scope="col" className="w-[40%] pb-1 font-semibold">
              Feature
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">
              Value
            </th>
            <th scope="col" className="w-[22%] pb-1 pl-2 font-semibold">
              Ref
            </th>
            <th scope="col" className="w-[18%] pb-1 text-right font-semibold">
              SHAP
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ spec, value, shap, status }) => (
            <tr
              key={spec.key}
              onMouseEnter={() => highlight(spec.key)}
              onMouseLeave={() => highlight(null)}
              className={cn('h-7 border-t border-hairline', highlighted === spec.key && 'bg-surface-2')}
            >
              <th scope="row" className="truncate pr-2 text-left font-normal text-secondary" title={spec.description ?? undefined}>
                {spec.label}
              </th>
              <td className="num whitespace-nowrap text-right text-primary">
                {formatFeatureValue(spec, value as never)}
                {status === 'above' && <span className="ml-1 text-[0.6875rem] text-secondary">▲</span>}
                {status === 'below' && <span className="ml-1 text-[0.6875rem] text-secondary">▼</span>}
              </td>
              <td className="pl-2" title={formatNormalRange(spec.normal, spec.step) || undefined}>
                {spec.type === 'numeric' && typeof value === 'number' ? <RangeBar spec={spec} value={value} /> : null}
              </td>
              <td className="num text-right">
                {typeof shap === 'number' ? (
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 rounded-xs"
                      style={{
                        width: Math.max(2, (Math.abs(shap) / scale) * 28),
                        backgroundColor: shap >= 0 ? SHAP_RAISES : SHAP_LOWERS,
                      }}
                    />
                    <span className={cn('text-numeral-m', Math.abs(shap) < 0.02 ? 'text-tertiary' : 'text-primary')}>
                      {formatShap(shap)}
                    </span>
                  </span>
                ) : (
                  <span className="text-tertiary">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-label font-normal text-tertiary">All recorded values are within their reference ranges.</p>}
    </div>
  );
}
