import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Tooltip } from '@/design';
import { useRiskView } from '@/features/risk/useRiskView';
import { flaggedCount } from '@/features/risk/verdict';
import { usePortableModel, useSchemaIndex } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import { cn } from '@/lib/cn';
import { formatCi, formatMetricValue, formatPercent, formatProbability, formatShap, printedDifference } from '@/lib/format';
import { deployedModelName } from '@/lib/modelNames';
import { usePatientStore } from '@/state/patientStore';
import type { TargetId } from '@/types/contracts';
import { predictionId } from './explainUi';
import { modelFactsResource, type Estimate, type TargetFacts } from './modelFacts';

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <div className="flex h-7 items-end justify-between gap-2 border-b border-hairline pb-1">
        <h3 id={id} className="eyebrow text-secondary">
          {title}
        </h3>
        {aside}
      </div>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** "0.86 [0.74–0.95]" with the CI in text/tertiary (LUMEN §3 metric treatment). */
function Metric({ e, className }: { e: Estimate | null | undefined; className?: string }) {
  if (!e) return <span className="text-tertiary">–</span>;
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      <span className="text-primary">{formatMetricValue(e.value)}</span>
      {e.ci && <span className="ml-1 text-tertiary">{formatCi(e.ci)}</span>}
    </span>
  );
}

function Tile({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface-1 px-3 py-2">
      <span className="eyebrow text-tertiary">{label}</span>
      <span className="text-body-s font-semibold">{children}</span>
      {note && <span className="text-label font-normal text-tertiary">{note}</span>}
    </div>
  );
}

const ordinal = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th';
  return `${r}${s}`;
};

const STEP_LABEL: Record<string, string> = {
  demographics: 'Demographics',
  risk_factors: 'Risk factors',
  symptoms: 'Symptoms',
  exam: 'Examination',
  ecg: 'ECG',
  labs: 'Laboratory',
  echo: 'Echo',
};

/** Cumulative modality steps as bars on a 0.5–1.0 AUC scale (chance = 0.5). */
function ModalitySteps({ facts }: { facts: TargetFacts }) {
  const steps = facts.modality?.steps ?? [];
  if (steps.length === 0) return null;
  const x = (auc: number) => `${Math.min(100, Math.max(0, ((auc - 0.5) / 0.5) * 100))}%`;
  const instrumental = facts.modality?.instrumental;
  return (
    <>
      <ul className="flex flex-col" aria-label="Development cross-validated ROC-AUC as each kind of data is added">
        {steps.map((s, i) => {
          const sig = s.delta && typeof s.delta.pHolm === 'number' && s.delta.pHolm < 0.05;
          // The printed gain is the difference of the two printed ROC-AUCs, never a contradiction of them.
          const prev = steps[i - 1];
          const gain = prev ? printedDifference(prev.auc.value, s.auc.value) : null;
          return (
            <li key={s.group} className="grid h-7 grid-cols-[112px_minmax(0,1fr)_36px_48px] items-center gap-2">
              <span className="truncate text-body-s text-secondary">
                {i === 0 ? '' : '+ '}
                {STEP_LABEL[s.group] ?? s.label}
              </span>
              <span aria-hidden className="relative h-2 rounded-full bg-surface-2">
                <span className="absolute inset-y-0 left-0 rounded-full bg-line-strong" style={{ width: x(s.auc.value) }} />
                {s.delta && s.delta.value > 0 && (
                  <span
                    className={cn('absolute inset-y-0 rounded-r-full', sig ? 'bg-secondary' : 'bg-disabled')}
                    style={{ left: x(s.auc.value - s.delta.value), width: `calc(${x(s.auc.value)} - ${x(s.auc.value - s.delta.value)})` }}
                  />
                )}
              </span>
              <span className="num text-right text-numeral-m text-primary">{formatMetricValue(s.auc.value)}</span>
              <Tooltip
                content={
                  s.delta
                    ? `Change from the previous step: ${formatShap(gain ?? s.delta.value)} ${formatCi(s.delta.ci)}${
                        typeof s.delta.pHolm === 'number' ? ` · Holm-adjusted p = ${s.delta.pHolm < 0.001 ? '<0.001' : s.delta.pHolm.toFixed(3)}` : ''
                      }`
                    : 'Demographics alone'
                }
              >
                <span tabIndex={0} className={cn('num rounded-xs text-right text-label font-normal outline-none focus-visible:shadow-focus', sig ? 'text-primary' : 'text-tertiary')}>
                  {s.delta && gain !== null ? formatShap(gain) : 'base'}
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <p className="text-label font-normal text-tertiary">
        Development cross-validation (50 folds), each kind of data added in the order a clinic collects it. Darker
        increments are statistically significant after Holm correction.
        {instrumental && (
          <>
            {' '}
            ECG, laboratory and echo together add{' '}
            <span className="num text-secondary">
              {formatShap(instrumental.value)} {formatCi(instrumental.ci)}
            </span>{' '}
            to bedside data alone.
          </>
        )}
      </p>
    </>
  );
}

/**
 * Explain › Model (WORKSTATION_V2 §5.10): how this estimate is made — the model's human name, the decision
 * threshold and how it was tuned, test ROC-AUC with CI and n, calibration, robustness over re-splits, what each
 * data modality adds, the expected-vessels reconciliation (§3.2) and this estimate's provenance.
 */
export function ModelTab({ target }: { target: TargetId }) {
  const facts = useResource(modelFactsResource);
  const model = usePortableModel();
  const index = useSchemaIndex();
  const view = useRiskView();
  const features = usePatientStore((s) => s.features);
  const engine = usePatientStore((s) => s.engineKind);
  const engineStatus = usePatientStore((s) => s.engineStatus);
  const latency = usePatientStore((s) => s.latencyMs);
  const f = facts.data?.targets[target];
  const p = view.prediction?.predictions[target];
  const threshold = p?.threshold ?? f?.threshold ?? null;
  const components = (model.data?.models[target]?.components ?? []) as { type?: string; name?: string }[];
  const logistic = components.find((c) => c.type === 'logistic')?.name ?? null;
  const vessels = index?.vessels ?? [];
  const count = flaggedCount(view.prediction, vessels.map((v) => v.id));
  const expected = view.prediction?.summary.expected_diseased_vessels;
  const nTest = facts.data?.dataset.nTest;
  const shown = p ? formatProbability(p.probability) : null;

  if (facts.status === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section id="model-name" title="The model">
        <p className="text-body-s font-semibold text-primary">{deployedModelName(logistic)}</p>
        <p className="text-body-s text-secondary">
          One model per target, trained on routine clinical data only. Probabilities are Platt-calibrated; every
          estimate is explained exactly (linear SHAP for the logistic part, TreeSHAP for the trees).
        </p>
      </Section>

      <Section id="model-threshold" title="Decision threshold">
        <p className="text-body-s text-primary">
          {target} is flagged at <span className="num font-semibold">{formatPercent(threshold)}</span> or more
          {f?.thresholdRule ? `, ${f.thresholdRule}.` : '.'}
        </p>
        {f && (f.test.sensitivity || f.test.specificity) && (
          <p className="text-body-s text-secondary">
            At this threshold on the held-out patients: sensitivity <Metric e={f.test.sensitivity} />, specificity{' '}
            <Metric e={f.test.specificity} />.
          </p>
        )}
      </Section>

      {f ? (
        <Section
          id="model-unseen"
          title="On unseen patients"
          aside={
            <Link
              to="/performance"
              className="inline-flex items-center gap-0.5 rounded-xs text-label font-normal text-secondary outline-none hover:text-primary focus-visible:shadow-focus"
            >
              Model performance <ArrowUpRight aria-hidden className="size-3.5 stroke-[1.5]" />
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Test ROC-AUC" note={`n = ${nTest ?? '–'} held out · single centre`}>
              <Metric e={f.test.auc} />
            </Tile>
            <Tile label="Cross-validation" note="development set, 50 folds">
              {f.cvAuc ? (
                <span className="num text-primary">
                  {formatMetricValue(f.cvAuc.mean)} <span className="text-tertiary">± {formatMetricValue(f.cvAuc.std)}</span>
                </span>
              ) : (
                '–'
              )}
            </Tile>
          </div>
          {f.robustness && (
            <p className="text-body-s text-secondary">
              Across {f.robustness.nSplits} random re-splits of the cohort, held-out ROC-AUC has a median of{' '}
              <span className="num text-primary">{formatMetricValue(f.robustness.median)}</span> (middle 90&thinsp;%:{' '}
              <span className="num">
                {formatMetricValue(f.robustness.p05)}–{formatMetricValue(f.robustness.p95)}
              </span>
              ).
              {f.robustness.percentile !== null &&
                ` The locked test split sits at the ${ordinal(f.robustness.percentile)} percentile${
                  f.robustness.percentile < 25 ? ', so the headline test figure is on the conservative side.' : '.'
                }`}
            </p>
          )}
        </Section>
      ) : (
        <p className="text-body-s text-tertiary">Evaluation results are not available in this build.</p>
      )}

      {f?.modality && f.modality.steps.length > 0 && (
        <Section id="model-modality" title="What each kind of data adds" aside={<span className="text-label font-normal text-tertiary">ROC-AUC</span>}>
          <ModalitySteps facts={f} />
        </Section>
      )}

      {shown?.capped && p && (
        // The cards cap the display at ≤5 % / ≥95 %; this is the one place the exact value is written out.
        <Section id="model-exact" title="This estimate, exactly">
          <p className="text-body-s text-secondary">
            {target} <span className="num font-semibold text-primary">p&nbsp;=&nbsp;{p.probability.toFixed(3)}</span>. The cards
            show it as <span className="num text-primary">{shown.text}</span>: on unseen patients the calibration slope
            is below 1{f?.calibration.slope != null ? <> (<span className="num text-primary">{formatMetricValue(f.calibration.slope)}</span>)</> : ''}, so
            estimates this extreme overstate how certain the outcome is.
          </p>
        </Section>
      )}

      {f && (f.calibration.slope !== null || f.calibration.inTheLarge !== null) && (
        <Section id="model-calibration" title="Calibration">
          <p className="text-body-s text-secondary">
            On the held-out patients, the average estimate differs from the observed rate by{' '}
            <span className="num text-primary">{(Math.abs(f.calibration.inTheLarge ?? 0) * 100).toFixed(1)} percentage points</span>
            {f.calibration.slope !== null && (
              <>
                {' '}
                and the calibration slope is <span className="num text-primary">{formatMetricValue(f.calibration.slope)}</span>{' '}
                (1 is ideal; {f.calibration.slope < 1 ? 'below 1, estimates are somewhat more extreme than the observed rates' : 'above 1, estimates are somewhat more cautious than the observed rates'}
                )
              </>
            )}
            .{' '}
            {typeof facts.data?.dataset.prevalence.CAD === 'number' &&
              `The cohort is ${formatPercent(facts.data.dataset.prevalence.CAD)} CAD, so probabilities do not transfer to screening populations.`}
          </p>
        </Section>
      )}

      {typeof expected === 'number' && count && (
        <Section id="model-vessels" title="Flagged vessels vs expected vessels">
          <p className="text-body-s text-secondary">
            The three vessel probabilities add up to about{' '}
            <span className="num text-primary">{expected.toFixed(1)}</span> vessels.{' '}
            {count.k === 0 ? 'None is' : count.k === 1 ? 'One is' : `${count.k} are`} flagged, because each vessel is judged
            against its own threshold (
            {vessels
              .map((v) => `${v.id} ${formatPercent(view.prediction?.predictions[v.id]?.threshold)}`)
              .join(', ')}
            ), each tuned to balance sensitivity and specificity on out-of-fold predictions. A sum of probabilities and a
            count of decisions answer different questions.
          </p>
        </Section>
      )}

      <Section id="model-provenance" title="This estimate">
        <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-s">
          <dt className="text-tertiary">Computed by</dt>
          <dd className="text-primary">
            {engine === 'server' ? 'Prediction server' : engine === 'edge' ? 'In-browser model (edge)' : engineStatus === 'resolving' ? 'Resolving…' : '–'}
            {latency !== null && <span className="num ml-1.5 text-tertiary">{Math.max(1, Math.round(latency))} ms</span>}
          </dd>
          <dt className="text-tertiary">Model version</dt>
          <dd className="mono text-mono-s text-primary">{view.prediction?.model_version ?? facts.data?.modelVersion ?? '–'}</dd>
          <dt className="text-tertiary">Prediction id</dt>
          <dd className="mono text-mono-s text-primary">{Object.keys(features).length > 0 ? predictionId(features) : '–'}</dd>
          <dt className="text-tertiary">Data</dt>
          <dd className="text-secondary">
            {facts.data?.dataset.name ?? 'Z-Alizadeh Sani extension'} · n = {facts.data?.dataset.n ?? 303}, single centre
          </dd>
        </dl>
      </Section>
    </div>
  );
}
