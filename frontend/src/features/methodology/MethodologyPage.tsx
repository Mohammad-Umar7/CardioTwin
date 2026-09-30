import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton } from '@/design';
import { useMetrics, useSchema } from '@/hooks/useData';
import { formatCi, formatMetricValue, formatPercent } from '@/lib/format';
import { REPOSITORY_URL } from '@/features/landing/InfoCards';
import { TARGET_ORDER } from '@/types/contracts';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-hairline pt-6">
      <h2 id={`${id}-title`} className="mb-3 text-title-1 text-primary">
        {title}
      </h2>
      <div className="flex max-w-[72ch] flex-col gap-3 text-body text-secondary">{children}</div>
    </section>
  );
}

const TOC = [
  ['data', 'Data'],
  ['leakage', 'Leakage control'],
  ['validation', 'Validation protocol'],
  ['models', 'Models and calibration'],
  ['explainability', 'Explainability'],
  ['anatomy', 'Anatomy mapping'],
  ['model-card', 'Model card'],
  ['limitations', 'Limitations'],
] as const;

/**
 * Methodology (foundation): how the numbers are produced, pulled from metrics.json / schema.json where
 * the ML pipeline documents itself (protocol strings, dataset facts, per-target results) so the page
 * never drifts from the shipped model. Phase 2 extends the prose and the figures.
 */
export default function MethodologyPage() {
  const metrics = useMetrics();
  const schema = useSchema();
  const location = useLocation();
  const m = metrics.data;
  const protocol = m?.protocol;

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace('#', '');
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [location.hash, m]);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-10 px-6 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:block">
        <ul className="sticky top-20 flex flex-col gap-1 text-body-s">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#/methodology#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }} className="block rounded-sm px-2 py-1 text-secondary hover:bg-surface-1 hover:text-primary">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="flex flex-col gap-8">
        <header className="animate-rise-in">
          <p className="eyebrow text-accent">Methodology</p>
          <h1 className="font-display text-display-2 text-primary">From routine clinical data to vessel-level risk.</h1>
          <p className="mt-2 max-w-[72ch] text-body text-secondary">
            CardioTwin predicts coronary artery disease and the stenosis status of the LAD, LCX and RCA from demographic,
            clinical, ECG, laboratory and echocardiographic features, explains each estimate with SHAP, and paints the result
            onto BodyParts3D anatomy. Every number below is read from the evaluation report shipped with the model.
          </p>
        </header>

        <Section id="data" title="Data">
          <p>
            Extension of the Z-Alizadeh Sani dataset (UCI Machine Learning Repository #411, CC BY 4.0):{' '}
            {m ? `${m.dataset.n} patients` : '303 patients'} referred for coronary angiography at a single centre, with the
            angiographic result (Cath) and per-vessel stenosis labels.
            {schema.data &&
              ` ${schema.data.features.length} inputs are used; constant columns (${(schema.data.dropped_features ?? []).join(', ') || 'none'}) are dropped.`}
          </p>
          {m && (
            <p>
              Prevalence: {TARGET_ORDER.map((t) => `${t} ${formatPercent(m.dataset.prevalence[t])}`).join(' · ')}. The high CAD
              prevalence reflects a referral population, not screening.
            </p>
          )}
        </Section>

        <Section id="leakage" title="Leakage control">
          <p>
            The labels LAD, LCX, RCA and Cath are never model inputs; the rule is enforced by a unit test in the ML package and
            re-checked by the API, which rejects them in requests. A label consistency check confirms that Cath = CAD exactly
            when at least one vessel is stenotic (one documented exception in the raw data).
          </p>
        </Section>

        <Section id="validation" title="Validation protocol">
          {metrics.status === 'loading' ? (
            <Skeleton className="h-24" />
          ) : protocol ? (
            <dl className="grid grid-cols-1 gap-3">
              {(['holdout', 'cv', 'tuning', 'calibration', 'threshold'] as const).map((k) =>
                typeof protocol[k] === 'string' ? (
                  <div key={k}>
                    <dt className="eyebrow text-tertiary">{k === 'cv' ? 'Cross-validation' : k}</dt>
                    <dd className="mt-0.5">{protocol[k] as string}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <p>The evaluation report has not been published yet.</p>
          )}
        </Section>

        <Section id="models" title="Models and calibration">
          <p>
            One model per target: a margin-space ensemble of L2 logistic regression and gradient-boosted trees (XGBoost),
            Platt-calibrated, with the decision threshold chosen on development folds. The ensemble weight, calibration and
            threshold are frozen before the held-out split is scored.
          </p>
          {m && (
            <div className="overflow-x-auto">
              <table className="w-full text-body-s">
                <caption className="sr-only">Held-out test results per target</caption>
                <thead>
                  <tr className="text-left text-[0.6875rem] uppercase tracking-[0.08em] text-tertiary">
                    <th scope="col" className="py-1 font-semibold">Target</th>
                    <th scope="col" className="py-1 text-right font-semibold">ROC-AUC [95 % CI]</th>
                    <th scope="col" className="py-1 text-right font-semibold">F1</th>
                    <th scope="col" className="py-1 text-right font-semibold">Brier</th>
                    <th scope="col" className="py-1 text-right font-semibold">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {TARGET_ORDER.map((t) => {
                    const r = m.targets[t];
                    if (!r) return null;
                    return (
                      <tr key={t} className="border-t border-hairline">
                        <th scope="row" className="py-1.5 text-left font-semibold text-primary">{t}</th>
                        <td className="num py-1.5 text-right text-primary">
                          {formatMetricValue(r.test.roc_auc?.value)} <span className="text-tertiary">{formatCi(r.test.roc_auc?.ci)}</span>
                        </td>
                        <td className="num py-1.5 text-right">{formatMetricValue(r.test.f1?.value)}</td>
                        <td className="num py-1.5 text-right">{formatMetricValue(r.test.brier?.value)}</td>
                        <td className="num py-1.5 text-right">{formatMetricValue(r.threshold)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="explainability" title="Explainability">
          <p>
            Explanations are exact SHAP values in the log-odds (margin) space of the uncalibrated ensemble: path-dependent
            TreeSHAP for the trees plus the closed-form linear SHAP of the logistic model, weighted like the ensemble. One-hot
            columns are summed back to their clinical feature, so every row maps to one input. Contributions are additive:
            the base value plus the sum of contributions equals the model output to within 10⁻⁶.
          </p>
          <p>
            The "typical → this patient" footer converts the base value and the output through the same Platt calibration,
            so the explanation and the displayed probability are the same model.
          </p>
        </Section>

        <Section id="anatomy" title="Anatomy mapping">
          <p>
            The 3D model is assembled from BodyParts3D (© DBCLS, CC BY-SA 2.1 JP). Each coronary node is coloured by its
            target's probability using one perceptual colour ramp, uniformly from root to tip; the model predicts vessel-level
            stenosis and never localises a lesion within a vessel. The left main is not predicted and stays neutral. Myocardial
            territories are an approximate proximity-based supply map, not a perfusion measurement.
          </p>
        </Section>

        <Section id="model-card" title="Model card">
          <ul className="list-disc pl-5">
            <li>Intended use: education and decision-support research; not for diagnosis.</li>
            <li>Training data: single-centre angiography cohort; results may not generalise to other populations.</li>
            <li>Model version: <span className="mono">{m?.version ?? schema.data?.model_version ?? '–'}</span>{m?.generated_at ? ` · generated ${m.generated_at.slice(0, 10)}` : ''}.</li>
            <li>
              Source code and reproducible pipeline:{' '}
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                GitHub
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section id="limitations" title="Limitations">
          <ul className="list-disc pl-5">
            <li>Small (n = {m?.dataset.n ?? 303}) single-centre cohort; wide confidence intervals on the 61-patient test split.</li>
            <li>No external validation; calibration is specific to a referral population with high CAD prevalence.</li>
            <li>Vessel labels are binary (≥ 50 % narrowing); severity and lesion location are not modelled.</li>
            <li>The anatomy is a generic adult model, not the patient's own anatomy.</li>
          </ul>
        </Section>
      </article>
    </div>
  );
}
