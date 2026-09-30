import type { ReactNode } from 'react';
import { Skeleton, Tooltip } from '@/design';
import { useMetrics, useSchema } from '@/hooks/useData';
import { formatCi, formatMetricValue } from '@/lib/format';
import { LEAKAGE_KEYS } from '@/types/contracts';

function Kpi({ value, label, hint, loading }: { value: ReactNode; label: ReactNode; hint: string; loading?: boolean }) {
  return (
    <Tooltip content={hint}>
      <div tabIndex={0} className="flex min-w-0 flex-col gap-1 px-5 py-4 outline-none">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="num whitespace-nowrap font-display text-[1.625rem] font-semibold leading-8 tracking-[-0.02em] text-primary">
            {value}
          </div>
        )}
        <div className="text-label font-normal text-tertiary">{label}</div>
      </div>
    </Tooltip>
  );
}

/**
 * KPI strip (DESIGN_SYSTEM §4.1). Every value is read from the shipped artifacts: patients and test
 * ROC-AUC from metrics.json, input count and targets from schema.json, leaked labels counted from the
 * schema's feature keys (0 by construction; the leakage rule is also unit-tested in ml/).
 */
export function KpiStrip() {
  const metrics = useMetrics();
  const schema = useSchema();
  const m = metrics.data;
  const s = schema.data;
  const auc = m?.targets.CAD?.test.roc_auc;
  const leaked = s ? s.features.filter((f) => LEAKAGE_KEYS.has(f.key)).length : null;
  const metricsLoading = metrics.status === 'loading';
  const schemaLoading = schema.status === 'loading';

  return (
    <section
      aria-label="Key facts"
      className="grid grid-cols-2 divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel sm:grid-cols-3 lg:grid-cols-5 lg:divide-x"
    >
      <Kpi
        loading={metricsLoading}
        value={m?.dataset.n ?? '—'}
        label="patients · UCI #411"
        hint="Extension of Z-Alizadeh Sani dataset, single centre, CC BY 4.0."
      />
      <Kpi
        loading={schemaLoading}
        value={s?.features.length ?? '—'}
        label="clinical inputs"
        hint="Demographic, history, symptom, examination, ECG, laboratory and echo features. Constant columns are dropped."
      />
      <Kpi
        loading={schemaLoading}
        value={s ? `${s.targets.length} targets` : '—'}
        label={s ? s.targets.map((t) => t.short ?? t.id).join(' · ') : 'CAD · LAD · LCX · RCA'}
        hint="Overall CAD plus stenosis of each major coronary artery, each with its own calibrated model."
      />
      <Kpi
        loading={schemaLoading}
        value={leaked ?? '—'}
        label="leaked labels"
        hint="LAD, LCX, RCA and Cath are never model inputs (target leakage), enforced by a unit test."
      />
      <Kpi
        loading={metricsLoading}
        value={
          auc ? (
            <>
              {formatMetricValue(auc.value)}{' '}
              <span className="text-[0.9375rem] font-medium tracking-normal text-tertiary">{formatCi(auc.ci)}</span>
            </>
          ) : (
            '—'
          )
        }
        label={m ? `CAD test ROC-AUC · n = ${m.dataset.n_test}` : 'CAD test ROC-AUC'}
        hint="Area under the ROC curve on the held-out test split, scored once after every modelling decision was frozen; 95 % bootstrap CI."
      />
    </section>
  );
}
