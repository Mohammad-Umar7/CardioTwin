import { ArrowUpRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Skeleton } from '@/design';
import { REPOSITORY_URL } from '@/features/landing/InfoCards';
import { scrollToSection, useActiveSection } from '@/features/performance/useActiveSection';
import { useManifest, useMetrics, useSchema } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import { ROUTES } from '@/routes';
import { TARGET_ORDER } from '@/types/contracts';
import {
  anatomySteps,
  boundAbove,
  cite,
  datasetCard,
  keyFacts,
  leakagePolicy,
  modalityCounts,
  modelRows,
  pipelinePhases,
  powerOfTen,
  REFERENCES,
  rejectedIdeas,
} from './content';
import { AnatomyPipeline } from './diagrams/AnatomyPipeline';
import { PipelineDiagram } from './diagrams/PipelineDiagram';
import { ShapAdditivity } from './diagrams/ShapAdditivity';
import { ValidationDiagram } from './diagrams/ValidationDiagram';

const TOC = [
  ['pipeline', 'Pipeline'],
  ['data', 'Dataset'],
  ['leakage', 'Leakage policy'],
  ['validation', 'Validation protocol'],
  ['models', 'Models and engines'],
  ['explainability', 'Explainability'],
  ['anatomy', 'Anatomy'],
  ['extensibility', 'Extensibility'],
  ['model-card', 'Model card'],
  ['limitations', 'Limitations and ethics'],
  ['references', 'References'],
] as const;

const TOC_IDS = TOC.map(([id]) => id);
const pad = (n: number) => String(n).padStart(2, '0');
const MODEL_CARD_URL = `${REPOSITORY_URL}/blob/main/docs/MODEL_CARD.md`;

/** Numbered citation: "[13, 14]" linking to the reference list. */
function Cite({ ids }: { ids: string[] }) {
  const nums = ids.map(cite).filter((n) => n > 0);
  if (nums.length === 0) return null;
  return (
    <span className="whitespace-nowrap text-label font-normal text-tertiary">
      {' ['}
      {nums.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && ', '}
          <a
            href={`#${ROUTES.methodology}#ref-${n}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToSection(`ref-${n}`);
            }}
            className="rounded-xs hover:text-accent focus-visible:shadow-focus focus-visible:outline-none"
            aria-label={`Reference ${n}`}
          >
            {n}
          </a>
        </Fragment>
      ))}
      {']'}
    </span>
  );
}

interface SectionProps {
  id: string;
  index: number;
  name: string;
  /** H2 = the takeaway of the section, like the chart titles on Performance. */
  title: string;
  lede?: ReactNode;
  aside?: ReactNode;
  /** Full-width content under the text + margin columns (diagrams). */
  wide?: ReactNode;
  children?: ReactNode;
}

/**
 * One section on the 3-column page: 680 px text column, 280 px margin for definitions and small
 * diagrams (§6.4 Methodology), and an optional full-width band for the large diagrams.
 */
function Section({ id, index, name, title, lede, aside, wide, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-[calc(var(--topbar-h)+24px)] flex-col gap-6 border-t border-hairline pt-8"
    >
      <div
        className={cn('grid grid-cols-1 gap-x-10 gap-y-6', aside && 'xl:grid-cols-[minmax(0,680px)_280px]')}
      >
        <div className="flex min-w-0 max-w-[680px] flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="eyebrow text-tertiary">
              <span className="font-mono">{pad(index)}</span> · {name}
            </p>
            <h2 id={`${id}-title`} className="text-title-1 text-primary text-balance">
              {title}
            </h2>
          </div>
          {lede && <p className="text-narrative text-secondary text-pretty">{lede}</p>}
          {children}
        </div>
        {aside && <aside className="flex min-w-0 flex-col gap-4 xl:pt-[52px]">{aside}</aside>}
      </div>
      {wide}
    </section>
  );
}

/** Margin note: a definition or a small fact, set in the margin column. */
function Note({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-l border-line pl-3">
      <p className="text-label font-semibold text-primary">{term}</p>
      <div className="text-label font-normal text-tertiary text-pretty">{children}</div>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-narrative text-secondary text-pretty">{children}</p>;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 rounded-xs text-accent underline-offset-2 hover:text-accent-hover hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5 stroke-[1.5]" />
    </a>
  );
}

function Toc() {
  const active = useActiveSection(TOC_IDS, '-96px 0px -60% 0px');
  const navigate = useNavigate();
  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <div className="sticky top-[calc(var(--topbar-h)+32px)] flex flex-col gap-3">
        <p className="eyebrow pl-3 text-tertiary">On this page</p>
        <ol className="flex flex-col border-l border-hairline">
          {TOC.map(([id, label], i) => {
            const on = active === id;
            return (
              <li key={id} className="relative">
                {on && (
                  <span aria-hidden className="absolute -left-px inset-y-1 w-0.5 rounded-full bg-accent" />
                )}
                <a
                  href={`#${ROUTES.methodology}#${id}`}
                  aria-current={on ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ hash: id }, { replace: true, preventScrollReset: true });
                    scrollToSection(id);
                  }}
                  className={cn(
                    'flex h-7 items-center gap-2 rounded-r-sm pl-3 pr-2 text-body-s transition-colors duration-fast focus-visible:shadow-focus focus-visible:outline-none',
                    on ? 'text-primary' : 'text-tertiary hover:text-secondary',
                  )}
                >
                  <span className="w-4 font-mono text-mono-s text-tertiary">{pad(i + 1)}</span>
                  {label}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/**
 * Methodology (WORKSTATION_V2 §6.4): how CardioTwin is built, validated and explained, as a
 * 3-column reading page (sticky contents · 680 px text · 280 px margin) with three diagrams: the
 * end-to-end pipeline, the validation protocol and the anatomy build. Every number is read from
 * metrics.json / schema.json / manifest.json; every name goes through lib/modelNames.
 */
export default function MethodologyPage() {
  const metrics = useMetrics();
  const schema = useSchema();
  const manifest = useManifest();
  const location = useLocation();
  const navigate = useNavigate();
  const report = metrics.data;
  const s = schema.data;

  const facts = useMemo(() => keyFacts(report, s), [report, s]);
  const phases = useMemo(() => pipelinePhases(facts), [facts]);
  const card = useMemo(() => datasetCard(report, s), [report, s]);
  const modalities = useMemo(() => modalityCounts(s), [s]);
  const policy = useMemo(() => leakagePolicy(report), [report]);
  const rows = useMemo(() => modelRows(report), [report]);
  const rejected = useMemo(() => rejectedIdeas(report), [report]);
  const anatomy = useMemo(() => anatomySteps(manifest.data), [manifest.data]);

  // Deep links (#/methodology#leakage) land on their section once the content has rendered.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !report) return;
    const id = location.hash.replace('#', '');
    if (!id) return;
    // A macrotask (not rAF, which never fires in a background tab) after the sections have mounted.
    const t = window.setTimeout(() => {
      landed.current = true;
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, 0);
    return () => window.clearTimeout(t);
  }, [location.hash, report]);

  const jump = (id: string) => {
    navigate({ hash: id }, { replace: true, preventScrollReset: true });
    scrollToSection(id);
  };

  const cad = report?.targets.CAD;
  const maxModality = Math.max(1, ...modalities.map((m) => m.count));
  const checks = (
    report as unknown as { explainability_checks?: Record<string, Record<string, number>> } | undefined
  )?.explainability_checks;
  const libraryGap = checks
    ? Math.max(
        0,
        ...Object.values(checks).flatMap((c) => [
          c.xgboost_pred_contribs_max_abs_diff ?? 0,
          c.shap_library_max_abs_diff ?? 0,
        ]),
      )
    : null;
  const loading = metrics.status === 'loading';

  return (
    <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-10 px-6 pb-24 pt-10 lg:grid-cols-[200px_minmax(0,1fr)]">
      <Toc />
      <article className="flex min-w-0 flex-col gap-12">
        <header className="flex flex-col gap-5">
          <div className="flex max-w-[800px] flex-col gap-3">
            <p className="eyebrow text-accent">Methodology</p>
            <h1 className="font-display text-display-2 text-primary text-balance">
              How CardioTwin is built, validated and explained.
            </h1>
            <p className="max-w-[68ch] text-body text-secondary text-pretty">
              From routine clinical data to vessel-level risk on a real 3D heart. Every number on this page is
              read from the evaluation report shipped with{' '}
              {facts.modelVersion ? `model ${facts.modelVersion}` : 'the model'}, so the page cannot drift
              from the model you are using.
            </p>
          </div>
          {loading ? (
            <Skeleton className="h-[88px] rounded-lg" label="Loading the evaluation report" />
          ) : (
            <dl className="grid grid-cols-2 gap-px overflow-clip rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-5">
              {[
                ['Patients', facts.n, 'single centre'],
                ['Clinical inputs', facts.nInputs, 'routine work-up'],
                ['Modalities', facts.nModalities, 'bedside to echo'],
                ['Targets', facts.nTargets, TARGET_ORDER.join(' · ')],
                ['Locked test', facts.nTest, 'scored once'],
              ].map(([label, value, sub]) => (
                <div key={label as string} className="flex flex-col gap-1 bg-panel px-4 py-3">
                  <dt className="eyebrow text-tertiary">{label}</dt>
                  <dd className="num font-display text-[1.75rem] font-semibold leading-8 tracking-[-0.03em] text-primary">
                    {value ?? '–'}
                  </dd>
                  <dd className="text-label font-normal text-tertiary">{sub}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        <Section
          id="pipeline"
          index={1}
          name="Pipeline"
          title={`${phases.reduce((n, p) => n + p.steps.length, 0)} steps from the clinical record to the heart on screen`}
          lede="The same artifacts drive the API, the browser and the 3D view. Development happens on the development set only; the locked test split waits, untouched, until everything is frozen."
          wide={<PipelineDiagram phases={phases} nTest={facts.nTest} onJump={jump} />}
        />

        <Section
          id="data"
          index={2}
          name="Dataset"
          title={
            facts.n !== null
              ? `${facts.n} patients referred for angiography, ${facts.nInputs ?? 'routine'} inputs, ${facts.nModalities ?? 'several'} modalities`
              : 'Patients referred for angiography, with a full routine work-up'
          }
          lede={
            <>
              The Extension of the Z-Alizadeh Sani dataset
              <Cite ids={['dataset', 'alizadehsani2013']} />: consecutive adults referred for coronary
              angiography at one tertiary centre, each with a complete routine work-up and the angiographic
              result for every major artery. This is a multimodal record: history, symptoms and examination
              sit next to the resting ECG, laboratory tests and echocardiography.
            </>
          }
          aside={
            <>
              <div className="flex flex-col gap-2">
                <p className="text-label font-semibold text-primary">Inputs by modality</p>
                <ul className="flex flex-col gap-1.5" aria-label="Inputs per modality">
                  {modalities.map((m, i) => (
                    <li key={m.id} className="flex flex-col gap-1">
                      {i > 0 && modalities[i - 1]!.bedside && !m.bedside && (
                        <span className="mt-1 border-t border-dashed border-line pt-1 text-label font-normal text-tertiary">
                          Instrumental
                        </span>
                      )}
                      <span className="grid grid-cols-[minmax(0,1fr)_24px] items-center gap-2 text-label font-normal">
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-secondary" title={m.examples.join(', ')}>
                            {m.name}
                          </span>
                          <span aria-hidden className="h-1 rounded-full bg-[rgba(255,255,255,0.08)]">
                            <span
                              className="block h-full rounded-full bg-[rgba(255,255,255,0.5)]"
                              style={{ width: `${(m.count / maxModality) * 100}%` }}
                            />
                          </span>
                        </span>
                        <span className="num text-right text-primary">{m.count}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <Note term="Stenosis">
                At least 50 % narrowing of the vessel diameter at invasive angiography: the label every target
                is trained on.
              </Note>
            </>
          }
        >
          {loading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <dl className="grid grid-cols-[112px_minmax(0,1fr)] overflow-clip rounded-lg border border-line bg-panel text-body-s">
              {card.map((r, i) => (
                <Fragment key={r.label}>
                  <dt className={cn('px-4 py-2.5 text-tertiary', i > 0 && 'border-t border-hairline')}>
                    {r.label}
                  </dt>
                  <dd
                    className={cn(
                      'min-w-0 py-2.5 pr-4 text-secondary',
                      i > 0 && 'border-t border-hairline',
                      r.mono && 'font-mono text-mono-s leading-[18px]',
                    )}
                  >
                    {r.href ? <ExternalLink href={r.href}>{r.value}</ExternalLink> : r.value}
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
          {report && (
            <Prose>
              Prevalence is high, as expected in a referral population:{' '}
              {TARGET_ORDER.map((t) => `${t} ${formatPercent(report.dataset.prevalence[t])}`).join(', ')}. The
              probabilities are calibrated to this population and would overstate risk in a screening setting.
            </Prose>
          )}
        </Section>

        <Section
          id="leakage"
          index={3}
          name="Leakage policy"
          title="Nothing about the outcome or the test patients reaches the model"
          lede={
            <>
              Leakage is any path by which the outcome, or the patients used for testing, influence the model
              during development. It inflates the reported performance without making the model any better
              <Cite ids={['kaufman']} />. Six rules close every path we know of:
            </>
          }
          aside={
            <>
              <Note term="Enforced in code, not by convention">
                A unit test on the feature list, request validation in the API, preprocessing inside
                scikit-learn pipelines, and a test-set history written into the evaluation report.
              </Note>
              <Note term="Cross-fitting">
                A choice made on out-of-fold predictions (weight, calibration, threshold) is re-made for each
                outer fold without that fold, so the fold that scores it never helped make it.
              </Note>
            </>
          }
        >
          <ol className="flex flex-col gap-3">
            {policy.map((p, i) => (
              <li key={p.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                <span className="pt-px font-mono text-mono-s text-tertiary">{pad(i + 1)}</span>
                <p className="text-narrative text-secondary text-pretty">
                  <span className="font-semibold text-primary">{p.title}.</span> {p.body}
                </p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="validation"
          index={4}
          name="Validation protocol"
          title="Nested, repeated and cross-fitted, with a test split scored once"
          lede="Two questions are kept apart. How well does the recipe work? Repeated nested cross-validation on the development set answers that. How well does the deployed model work on patients it never saw? The locked test split answers that, once."
          aside={
            <>
              <Note term="Why nested">
                Choosing a model inside the same cross-validation that scores it makes the score optimistic
                <Cite ids={['varma']} />; the inner loop keeps selection away from the outer fold.
              </Note>
              <Note term="Intervals">
                Test metrics: stratified bootstrap with the threshold held fixed. Modality comparisons:
                corrected resampled intervals
                <Cite ids={['nadeau']} /> with Holm adjustment
                <Cite ids={['holm']} />.
              </Note>
              <Note term="Reporting">
                Follows the TRIPOD+AI checklist
                <Cite ids={['tripod']} /> and a model card
                <Cite ids={['modelcards']} />.
              </Note>
            </>
          }
        >
          <ValidationDiagram facts={facts} />
          <Prose>
            Reported for every target: discrimination (ROC-AUC, PR-AUC), decisions at the deployed threshold
            (sensitivity, specificity, predictive values, F1, MCC), probabilistic accuracy (Brier score,
            log-loss), calibration (reliability, slope, calibration-in-the-large)
            <Cite ids={['calibration']} /> and clinical usefulness (decision curves)
            <Cite ids={['dca']} />.{' '}
            <Link
              to={ROUTES.performance}
              className="rounded-xs font-medium text-accent hover:text-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
            >
              See every number on Model performance ›
            </Link>
          </Prose>
        </Section>

        <Section
          id="models"
          index={5}
          name="Models and engines"
          title="One recipe per target, calibrated, identical in Python and in the browser"
          lede={
            <>
              Each target gets the same recipe: a regularised logistic regression and gradient-boosted trees
              <Cite ids={['xgboost']} />, blended in log-odds space, Platt-calibrated
              <Cite ids={['platt']} /> and cut at the threshold that maximises Youden&apos;s J
              <Cite ids={['youden']} /> on out-of-fold predictions. The logistic variant is chosen per target
              by nested cross-validation.
            </>
          }
          aside={
            <>
              <Note term="Blend">
                <span className="font-mono text-mono-s text-secondary">m = w·m₁ + (1 − w)·m₂</span>
                <br />
                logistic and tree log-odds, weight chosen by out-of-fold log-loss.
              </Note>
              <Note term="Calibration">
                <span className="font-mono text-mono-s text-secondary">
                  p = 1 / (1 + e<sup className="text-[0.75em]">−(a·m + b)</sup>)
                </span>
                <br />
                maps the blended log-odds to a probability; a and b fitted on out-of-fold predictions.
              </Note>
              <Note term="Threshold">
                Maximises sensitivity + specificity − 1 on out-of-fold probabilities, one per target.
              </Note>
            </>
          }
        >
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full border-collapse text-body-s">
                <caption className="sr-only">
                  Deployed model per target with held-out and cross-validated ROC-AUC
                </caption>
                <thead>
                  <tr className="text-label text-tertiary">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Target
                    </th>
                    <th scope="col" className="px-2 py-2 text-left font-medium">
                      Deployed ensemble
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Threshold
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Test ROC-AUC
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      CV ROC-AUC
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.target} className="border-t border-hairline">
                      <th scope="row" className="px-4 py-2 text-left font-semibold text-primary">
                        {r.target}
                      </th>
                      <td className="whitespace-nowrap px-2 py-2 text-secondary" title={r.modelFull}>
                        {r.model}
                      </td>
                      <td className="num px-2 py-2 text-right text-secondary">{r.threshold}</td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right text-primary">
                        {r.testAuc} <span className="text-tertiary">{r.testCi}</span>
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2 text-right text-secondary">{r.cvAuc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rejected.items.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line px-4 py-3">
              <p className="text-label font-semibold text-primary">
                Tried and rejected
                {rejected.bar !== null
                  ? ` (adoption bar: +${rejected.bar.toFixed(4)} mean ROC-AUC on paired folds)`
                  : ''}
              </p>
              <ul className="flex flex-col gap-1">
                {rejected.items.map((r) => (
                  <li
                    key={r.name}
                    className="grid grid-cols-[minmax(0,1fr)_64px] gap-3 text-label font-normal text-secondary"
                  >
                    <span className="text-pretty">{r.name}</span>
                    <span className="num text-right text-tertiary">{r.delta}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3 id="engines" className="scroll-mt-[calc(var(--topbar-h)+24px)] pt-2 text-title-2 text-primary">
            Two engines, one model
          </h3>
          <Prose>
            The trained model is exported as one portable file: the input encoders, the logistic coefficients,
            every tree with its node covers, the Platt parameters and the thresholds. The Python API and the
            in-browser engine evaluate that same file and agree to within {powerOfTen(-6)} in probability and{' '}
            {powerOfTen(-5)} in every SHAP value on the parity fixtures. When the API is unreachable the
            browser answers on its own; when both are up, they cross-check each patient in the background.
          </Prose>
        </Section>

        <Section
          id="explainability"
          index={6}
          name="Explainability"
          title="Exact SHAP: every estimate splits into the inputs behind it"
          lede={
            <>
              Explanations are exact SHAP values
              <Cite ids={['shap', 'treeshap']} />: closed-form linear SHAP for the logistic part and
              path-dependent TreeSHAP for the trees, combined with the ensemble weight. One-hot columns are
              summed back to their clinical input, so every row is one thing a clinician recorded.
            </>
          }
          aside={<ShapAdditivity />}
        >
          <Prose>
            The contributions add up from the cohort baseline to the patient&apos;s log-odds
            {facts.additivity !== null ? ` to within ${boundAbove(facts.additivity)}` : ''}
            {libraryGap !== null && libraryGap > 0
              ? `, and the tree part matches both XGBoost's own contributions and the reference SHAP library to within ${boundAbove(libraryGap)} (single-precision rounding)`
              : ''}
            . A rescaled copy of each contribution adds up to the displayed probability, so sentences can
            speak in percentage points.
          </Prose>
          <Prose>
            SHAP describes the model, not the patient&apos;s physiology: a large contribution means the model
            relies on that input for this estimate, not that the input causes disease.
          </Prose>
        </Section>

        <Section
          id="anatomy"
          index={7}
          name="Anatomy"
          title="Real anatomy, coloured at vessel level only"
          lede={
            <>
              The thorax, heart and coronary tree come from BodyParts3D
              <Cite ids={['bodyparts3d']} />, the open 3D anatomy database of the Database Center for Life
              Science, rebuilt by a scripted Blender pipeline into a model light enough for any laptop.
            </>
          }
          wide={<AnatomyPipeline steps={anatomy} />}
          aside={
            <>
              <Note term="Vessel-level risk">
                Each artery is coloured by its own model&apos;s probability, uniformly from root to tip. The
                model never localises a lesion.
              </Note>
              <Note term="Credits">
                BodyParts3D, © The Database Center for Life Science, licensed under CC BY-SA 2.1 Japan.
              </Note>
            </>
          }
        >
          <Prose>
            The left main is not predicted and stays neutral. Myocardial territories are soft nearest-artery
            weights, an approximation of supply in the spirit of the standard segment model
            <Cite ids={['aha17']} />, not a perfusion measurement. Coronary segment names follow SCCT 2014
            <Cite ids={['scct']} /> and are anatomical labels for inspection, never lesion locations.
          </Prose>
        </Section>

        <Section
          id="extensibility"
          index={8}
          name="Extensibility"
          title="Built to take new inputs, targets, engines and sites"
          lede="Every layer talks through versioned contracts: the feature schema, the portable model, the evaluation report and the anatomy manifest. New fields are additive, so extensions do not break what is already there."
          aside={
            <Note term="Contracts">
              Feature schema · portable model · evaluation report · anatomy manifest · centrelines. Each is
              versioned; consumers ignore fields they do not know.
            </Note>
          }
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              [
                'A new input or modality',
                'The interface is generated from the feature schema. Add the column and retrain: the inputs drawer, the search, the explanations and the modality analysis pick it up without interface code.',
              ],
              [
                'A new target',
                'A target is a schema entry plus the anatomy nodes it colours. A left-main or segment-level model plugs in by training it and naming its nodes.',
              ],
              [
                'A new engine',
                'Any runtime that evaluates the portable model and reproduces the parity fixtures within tolerance can serve predictions. The browser engine was added exactly this way.',
              ],
              [
                'A new site',
                'Recalibrate the Platt parameters and choose a threshold from local decision curves before any use. The rest of the model can stay as it is.',
              ],
            ].map(([t, b]) => (
              <li key={t} className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel p-4">
                <p className="text-body-s font-semibold text-primary">{t}</p>
                <p className="text-label font-normal text-tertiary text-pretty">{b}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="model-card"
          index={9}
          name="Model card"
          title="For education and research, not for diagnosis"
          aside={
            <Note term="Version">
              <span className="font-mono text-mono-s">{facts.modelVersion ?? '–'}</span>
              {report?.generated_at ? ` · evaluated ${report.generated_at.slice(0, 10)}` : ''}
            </Note>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
              <p className="eyebrow text-tertiary">Intended for</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-body-s text-secondary marker:text-tertiary">
                <li>Teaching how routine clinical data relate to angiographic coronary disease</li>
                <li>Research demonstrations of explainable, vessel-level risk</li>
                <li>Adults already being considered for angiography, the population the data come from</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
              <p className="eyebrow text-tertiary">Not for</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-body-s text-secondary marker:text-tertiary">
                <li>Diagnosing, triaging or ruling out disease in a patient</li>
                <li>Screening people without symptoms</li>
                <li>Locating a lesion within a vessel</li>
                <li>Acute coronary syndromes, prior revascularisation or children</li>
              </ul>
            </div>
          </div>
          <p className="text-body-s text-secondary">
            <ExternalLink href={MODEL_CARD_URL}>Read the full model card</ExternalLink>
          </p>
        </Section>

        <Section
          id="limitations"
          index={10}
          name="Limitations and ethics"
          title="What this model cannot tell you"
        >
          <ul className="flex flex-col gap-3">
            {[
              [
                'Small, single-centre data.',
                `${facts.n ?? 'Few'} patients from one centre, ${facts.nTest ?? 'few'} of them in the test split${
                  cad?.test.roc_auc?.ci
                    ? `: the CAD test ROC-AUC interval alone spans ${cad.test.roc_auc.ci.map((v) => v.toFixed(2)).join('–')}`
                    : ''
                }. There is no external validation yet.`,
              ],
              [
                'A referral population.',
                'Patients were selected for angiography by clinicians, so the model learns who among referred patients has stenosis. Its probabilities do not transfer to screening or to other health systems without recalibration.',
              ],
              [
                'An anatomical label.',
                'Stenosis of 50 % or more on visual angiography is operator-dependent and says nothing about ischaemia or outcomes.',
              ],
              [
                'Uneven performance.',
                'Discrimination is lower for the circumflex and right coronary arteries, and lower in older and diabetic patients. No subgroup-specific thresholds were derived.',
              ],
              [
                'Sex is an input.',
                'Predictions differ by sex by design, as in clinical pre-test probability scores; this is reported, not hidden.',
              ],
              [
                'Automation bias.',
                'A confident number on a 3D heart invites over-trust. The disclaimer never leaves the screen, uncertainty is shown next to every estimate, and explanations are presented as associations, not causes.',
              ],
            ].map(([t, b]) => (
              <li key={t} className="text-narrative text-secondary text-pretty">
                <span className="font-semibold text-primary">{t}</span> {b}
              </li>
            ))}
          </ul>
          <p className="rounded-lg border border-line bg-panel px-4 py-3 text-body-s text-secondary">
            Decision support and education only:{' '}
            <span className="font-semibold text-primary">not a diagnosis</span>, and not a substitute for
            angiography, CT coronary angiography, functional testing or clinical judgement.
          </p>
        </Section>

        <Section id="references" index={11} name="References" title="Sources">
          <ol className="flex flex-col gap-2">
            {REFERENCES.map((r, i) => (
              <li
                key={r.id}
                id={`ref-${i + 1}`}
                className="grid scroll-mt-[calc(var(--topbar-h)+96px)] grid-cols-[28px_minmax(0,1fr)] gap-2 text-body-s"
              >
                <span className="num text-tertiary">{i + 1}.</span>
                <span className="text-secondary text-pretty">
                  {r.text}{' '}
                  {r.href && (
                    <ExternalLink href={r.href}>
                      {r.href
                        .replace(/^https?:\/\//, '')
                        .replace(/%3C/g, '<')
                        .replace(/%3E/g, '>')}
                    </ExternalLink>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </article>
    </div>
  );
}
