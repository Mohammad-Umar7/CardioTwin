import { Activity, Check, ClipboardList, Crosshair, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Tooltip } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { EN_DASH, THIN_SPACE, formatCi, formatMetricValue } from '@/lib/format';
import { featureName } from '@/lib/modelNames';
import { TEST_SET } from '@/lib/testSetCopy';
import { ROUTES } from '@/routes';
import { bedsideSentence, formatCv, performanceFor, reconcileTestAndCv, useLandingMetrics, type LandingMetrics } from './landingMetrics';

/** LUMEN 2 tile glyph: a small lit well holding a lucide icon. */
function Glyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-md bg-[linear-gradient(145deg,rgba(86,194,230,0.16),rgba(129,140,248,0.06))] text-accent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_0_20px_-8px_rgba(86,194,230,0.7)] max-[1439.98px]:hidden"
    >
      <Icon className="size-4 stroke-[1.75]" />
    </span>
  );
}

function Tile({
  children,
  hint,
  className,
  label,
  icon,
}: {
  children: ReactNode;
  hint: ReactNode;
  className?: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip content={hint}>
      <div
        tabIndex={0}
        aria-label={label}
        className={cn(
          'spotlight flex min-w-0 items-center gap-3 px-4 py-3 outline-none transition-colors duration-fast hover:bg-white/[0.02] min-[1440px]:px-6',
          className,
        )}
      >
        <Glyph icon={icon} />
        <div className="flex min-w-0 flex-col justify-center gap-0.5">{children}</div>
      </div>
    </Tooltip>
  );
}

function Value({ value, unit, loading }: { value: ReactNode; unit: string; loading?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      {loading ? (
        <Skeleton className="h-6 w-10" />
      ) : (
        <span className="text-gradient font-numeral text-[1.5rem] font-semibold leading-7 tracking-[-0.03em]">{value}</span>
      )}
      <span className="truncate text-body-s text-secondary">{unit}</span>
    </div>
  );
}

const Caption = ({ children }: { children: ReactNode }) => (
  <div className="truncate text-label font-normal text-tertiary">{children}</div>
);

function AucTable({ lm }: { lm: LandingMetrics }) {
  const resplits = lm.targets.some((t) => t.robustness);
  return (
    <div className="flex flex-col gap-2">
      <table className="num w-full whitespace-nowrap text-label font-normal">
        <thead className="text-tertiary">
          <tr>
            <th className="pb-1 pr-3 text-left font-medium">Target</th>
            <th className="pb-1 pr-3 text-right font-medium">Test ROC-AUC [95&thinsp;% CI]</th>
            <th className="pb-1 text-right font-medium">CV mean ± sd</th>
            {resplits && <th className="pb-1 pl-3 text-right font-medium">Re-split median</th>}
          </tr>
        </thead>
        <tbody className="text-secondary">
          {lm.targets.map((t) => (
            <tr key={t.id}>
              <td className="pr-3 text-primary">{t.id}</td>
              <td className="pr-3 text-right">
                {formatMetricValue(t.testAuc?.value)} <span className="text-tertiary">{formatCi(t.testAuc?.ci)}</span>
              </td>
              <td className="text-right">{formatCv(t.cvAuc)}</td>
              {resplits && <td className="pl-3 text-right">{formatMetricValue(t.robustness?.median)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {lm.protocol.test && <p className="text-tertiary">Test: {lm.protocol.test}.</p>}
      {lm.protocol.cv && <p className="text-tertiary">CV: {lm.protocol.cv}.</p>}
    </div>
  );
}

const PROTOCOL = [
  { anchor: 'leakage', text: 'Targets never used as inputs', hint: 'LAD, LCX, RCA and the cath result are never model inputs; a unit test enforces it.' },
  { anchor: 'validation', text: TEST_SET.check, hint: TEST_SET.hint },
  { anchor: 'engines', text: 'Server/edge parity', hint: 'The in-browser engine reproduces the server to |Δp| < 1e-6 on every fixture case.' },
] as const;

/** ✓ Targets never used as inputs · ✓ Locked test, re-score disclosed · ✓ Server/edge parity (V2 §6.1). */
export function ProtocolLine({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-label', className)} aria-label="Validation protocol">
      {PROTOCOL.map((item) => (
        <li key={item.anchor}>
          <Tooltip content={item.hint}>
            <Link
              to={`${ROUTES.methodology}#${item.anchor}`}
              className="inline-flex items-center gap-1 rounded-sm font-medium text-secondary transition-colors duration-instant hover:text-primary"
            >
              <Check aria-hidden className="size-3.5 stroke-[2] text-success" />
              {item.text}
            </Link>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/**
 * KPI strip (V2 §6.1): patients · inputs · targets · CAD test ROC-AUC with CI and n, plus the honest CV
 * value and the protocol line. Every value is read from the artifacts (metrics_summary.json first, then
 * metrics.json; schema.json) and never counts up. "0 leaked labels" is gone: the protocol line states it.
 */
export function KpiStrip({ className }: { className?: string }) {
  const metrics = useLandingMetrics();
  const schema = useSchemaIndex();
  const lm = metrics.data ?? null;
  const cad = performanceFor(lm, 'CAD');
  const mLoading = metrics.status === 'loading';
  const sLoading = !schema;
  const reconcile = reconcileTestAndCv(cad, lm?.nTest ?? null);
  const bedside = bedsideSentence(cad, (k) => featureName(k, schema?.byKey));

  return (
    <section
      aria-label="Key facts"
      className={cn(
        // LUMEN 2: one glass ribbon over the stage, hairline-divided.
        'stage-card grid grid-cols-2 min-[1100px]:grid-cols-[minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,2.5fr)]',
        '[&>*]:border-white/[0.06] max-[1099.98px]:[&>*:nth-child(even)]:border-l max-[1099.98px]:[&>*:nth-child(n+3)]:border-t min-[1100px]:[&>*+*]:border-l',
        className,
      )}
    >
      <Tile
        icon={Users}
        label={lm ? `${lm.n} patients, single centre` : 'Patients'}
        hint="Extension of the Z-Alizadeh Sani dataset (UCI #411), one centre, CC BY 4.0. Development and held-out test patients."
      >
        <Value loading={mLoading} value={lm?.n ?? EN_DASH} unit="patients" />
        <Caption>single centre · UCI #411</Caption>
      </Tile>
      <Tile
        icon={ClipboardList}
        label={schema ? `${schema.features.length} clinical inputs` : 'Clinical inputs'}
        hint="History, symptoms, examination, ECG, laboratory and echocardiography. Constant columns are dropped."
      >
        <Value loading={sLoading} value={schema?.features.length ?? EN_DASH} unit="clinical inputs" />
        <Caption>routine clinical data</Caption>
      </Tile>
      <Tile
        icon={Crosshair}
        label={schema ? `${schema.targets.length} targets` : 'Targets'}
        hint="Overall coronary artery disease plus stenosis of each major artery, each with its own calibrated model and threshold."
      >
        <Value loading={sLoading} value={schema?.targets.length ?? EN_DASH} unit="targets" />
        <Caption>{schema ? schema.targets.map((t) => t.short ?? t.id).join(' · ') : 'CAD · LAD · LCX · RCA'}</Caption>
      </Tile>
      <div className="spotlight col-span-2 flex min-w-0 items-center gap-3 px-4 py-3 min-[1100px]:col-span-1 min-[1440px]:px-6">
        <Glyph icon={Activity} />
        <div className="flex min-w-0 flex-col justify-center gap-1">
        <Tooltip
          className="max-w-[420px]"
          content={
            lm ? (
              <div className="flex flex-col gap-2">
                {reconcile && <p>{reconcile}</p>}
                {bedside && <p>{bedside}</p>}
                <AucTable lm={lm} />
              </div>
            ) : (
              'Area under the ROC curve on the held-out test split.'
            )
          }
        >
          <div
            tabIndex={0}
            className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm outline-none"
            aria-label={
              cad?.testAuc
                ? `CAD test ROC-AUC ${formatMetricValue(cad.testAuc.value)}, 95 percent CI ${formatCi(cad.testAuc.ci)}, n ${lm?.nTest}; cross-validation ${formatCv(cad.cvAuc)}`
                : 'CAD test ROC-AUC'
            }
          >
            {mLoading ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              <span className="whitespace-nowrap">
                <span className="text-gradient-accent font-numeral text-[1.5rem] font-semibold leading-7 tracking-[-0.03em]">
                  {formatMetricValue(cad?.testAuc?.value)}
                </span>{' '}
                <span className="num text-label font-normal text-tertiary">{formatCi(cad?.testAuc?.ci)}</span>
              </span>
            )}
            <span className="whitespace-nowrap text-body-s text-secondary">
              CAD test ROC-AUC · n{THIN_SPACE}={THIN_SPACE}
              {lm?.nTest ?? EN_DASH}
            </span>
            {cad?.cvAuc && (
              <span className="whitespace-nowrap text-body-s text-tertiary">
                · cross-validation <span className="num text-secondary">{formatCv(cad.cvAuc)}</span>
              </span>
            )}
          </div>
        </Tooltip>
        <ProtocolLine />
        </div>
      </div>
    </section>
  );
}
