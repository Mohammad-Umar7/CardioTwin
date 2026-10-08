import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { EN_DASH, THIN_SPACE, formatMetricValue } from '@/lib/format';
import { ROUTES } from '@/routes';
import { formatCv, performanceFor, useLandingMetrics } from './landingMetrics';
import { REPOSITORY_URL } from './links';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-body-s font-medium text-tertiary">{term}</dt>
      <dd className="text-body leading-[1.6] text-secondary [&_strong]:font-medium [&_strong]:text-primary">{children}</dd>
    </div>
  );
}

/** "a, b and c" */
const joinList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * What the estimates rest on, below the hero: the cohort, the inputs, the outputs, the held-out validation (with
 * its CI and n, next to the cross-validation value) and the limits, then the way to the full evidence. Every
 * number is read from the published artifacts (metrics_summary.json, schema.json), never written here.
 */
export function EvidenceSection() {
  const metrics = useLandingMetrics();
  const schema = useSchemaIndex();
  const lm = metrics.data ?? null;
  const cad = performanceFor(lm, 'CAD');
  const loading = metrics.status === 'loading';
  const groups = schema?.groups.map((g) => lowerFirst(g.label)) ?? [];
  const overall = schema?.targets.filter((t) => !schema.vessels.includes(t)) ?? [];
  const vessels = schema?.vessels.map((t) => t.short ?? t.id) ?? ['LAD', 'LCX', 'RCA'];
  const n = (v: ReactNode) => (loading ? <Skeleton className="inline-block h-4 w-8 align-middle" /> : v);

  return (
    <section aria-labelledby="evidence-title" className="relative border-t border-white/[0.05] bg-void">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20 lg:px-10 lg:py-24">
        <div className="flex flex-col">
          <p className="eyebrow text-tertiary">Evidence</p>
          <h2 id="evidence-title" className="mt-3 font-display text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.025em] text-primary">
            What the estimates rest on
          </h2>
          <p className="mt-4 max-w-[26rem] text-body leading-[1.6] text-secondary">
            One public cohort, a locked held-out test set and an explanation for every estimate. The full tables,
            calibration and limits are one click away.
          </p>
          <ul className="mt-6 flex flex-col gap-2.5 text-body font-medium">
            <li>
              <Link to={ROUTES.performance} className="group/link inline-flex items-center gap-1.5 rounded-sm text-accent hover:text-accent-hover">
                Model performance
                <ArrowRight aria-hidden className="size-3.5 stroke-[2] transition-transform duration-fast group-hover/link:translate-x-0.5" />
              </Link>
            </li>
            <li>
              <Link
                to={`${ROUTES.methodology}#model-card`}
                className="group/link inline-flex items-center gap-1.5 rounded-sm text-accent hover:text-accent-hover"
              >
                Method and model card
                <ArrowRight aria-hidden className="size-3.5 stroke-[2] transition-transform duration-fast group-hover/link:translate-x-0.5" />
              </Link>
            </li>
            <li>
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="group/link inline-flex items-center gap-1.5 rounded-sm text-secondary hover:text-primary"
              >
                Source code on GitHub
                <ArrowUpRight aria-hidden className="size-3.5 stroke-[2]" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </div>

        <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
          <Row term="Cohort">
            <strong>{n(lm?.n ?? EN_DASH)} patients</strong> referred for coronary angiography at a single centre (the
            Extension of Z-Alizadeh Sani dataset, UCI #411).
          </Row>
          <Row term="Inputs">
            <strong>{schema ? schema.features.length : EN_DASH} routine clinical variables</strong>
            {groups.length > 0 ? `: ${joinList(groups)}.` : '.'}
          </Row>
          <Row term="Outputs">
            An estimated probability of {overall.length > 0 ? lowerFirst(overall[0]!.label) : 'coronary artery disease'} and of
            stenosis in the {joinList(vessels)}, each with an exact SHAP explanation of what drives it.
          </Row>
          <Row term="Validation">
            {cad?.testAuc ? (
              <>
                <strong>
                  ROC-AUC {formatMetricValue(cad.testAuc.value)} for coronary artery disease
                </strong>{' '}
                {cad.testAuc.ci && (
                  <>
                    (95{THIN_SPACE}% CI {formatMetricValue(cad.testAuc.ci[0])}
                    {EN_DASH}
                    {formatMetricValue(cad.testAuc.ci[1])}){' '}
                  </>
                )}
                on {lm?.nTest ?? EN_DASH} held-out test patients
                {cad.cvAuc ? <>, and {formatCv(cad.cvAuc)} in cross-validation on the development set.</> : '.'}
              </>
            ) : loading ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              'Held-out test and cross-validation results are on the Model performance page.'
            )}
          </Row>
          <Row term="Limits">
            One referred, high-prevalence cohort, not yet externally validated. Estimates are per vessel; the 3D heart
            is a reference model, not a reconstruction of the patient’s arteries.
          </Row>
        </dl>
      </div>
    </section>
  );
}
