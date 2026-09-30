import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, SegmentedControl, Skeleton, Tabs } from '@/design';
import { tabPanelId } from '@/design/tabIds';
import { useMetrics, useSchemaIndex } from '@/hooks/useData';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { deployedModelPhrase } from '@/lib/modelNames';
import { TEST_SET } from '@/lib/testSetCopy';
import { TARGET_ORDER, type KnownTargetId, type MetricsReport } from '@/types/contracts';
import {
  AcrossTargetsModule,
  CumulativeModule,
  LeaveOneOutModule,
  MultimodalHeadline,
  RobustnessModule,
  RobustnessStatsModule,
  SubgroupsModule,
} from './AnalysisModules';
import { CalibrationModule, DecisionCurveModule, PrModule, RocModule } from './CurveModules';
import { ConfusionModule, ThresholdExplorer } from './DecisionModules';
import {
  readBaseline,
  readCalibrationSummary,
  readComponents,
  readModalityAblation,
  readRobustness,
  readSubgroups,
} from './extras';
import { DriversModule, LeaderboardModule } from './ModelModules';
import {
  deployedIndex,
  kpis,
  moreMetrics,
  operatingPoints,
  pageTakeaway,
  reconcileSentence,
  robustnessAcross,
  splitFacts,
  testPrevalence,
  type Split,
} from './model';
import { ProtocolStrip } from './ProtocolStrip';
import { SummaryTiles } from './SummaryTiles';
import { scrollToSection, useActiveSection } from './useActiveSection';

const TARGET_NAMES: Record<KnownTargetId, string> = {
  CAD: 'Coronary artery disease',
  LAD: 'Left anterior descending artery',
  LCX: 'Left circumflex artery',
  RCA: 'Right coronary artery',
};

const isTarget = (v: string | null): v is KnownTargetId =>
  !!v && (TARGET_ORDER as readonly string[]).includes(v);

interface SectionProps {
  id: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}

/** Section rhythm (§6.4 rule 9): overline name, one plain lede, then a 12-column grid of modules. */
function Section({ id, title, lede, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-[calc(var(--topbar-h)+72px)] flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="eyebrow text-secondary">
          {title}
        </h2>
        {lede && <p className="max-w-[88ch] text-body-s text-tertiary text-pretty">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

const SECTIONS = [
  ['summary', 'Summary'],
  ['multimodal', 'Multimodal value'],
  ['discrimination', 'Discrimination'],
  ['calibration', 'Calibration'],
  ['decisions', 'Decisions'],
  ['robustness', 'Robustness'],
  ['subgroups', 'Subgroups'],
  ['models', 'Models'],
  ['protocol', 'Protocol'],
] as const;

function SectionNav({ ids }: { ids: readonly (readonly [string, string])[] }) {
  const active = useActiveSection(useMemo(() => ids.map(([id]) => id), [ids]));
  return (
    <nav aria-label="Sections on this page" className="ml-auto hidden items-center gap-0.5 min-[1360px]:flex">
      {ids.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? 'true' : undefined}
          onClick={() => scrollToSection(id)}
          className={cn(
            'relative h-8 rounded-sm px-2 text-label transition-colors duration-fast',
            active === id ? 'text-primary' : 'text-tertiary hover:text-secondary',
          )}
        >
          {label}
          {active === id && (
            <span aria-hidden className="absolute inset-x-2 -bottom-[11px] h-0.5 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </nav>
  );
}

function PageSkeleton({ height }: { height: number }) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-11 w-3/4" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[136px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="rounded-lg" style={{ height: height + 96 }} label="Loading evaluation report" />
        <Skeleton className="rounded-lg" style={{ height: height + 96 }} />
      </div>
    </div>
  );
}

/**
 * Model performance (WORKSTATION_V2 §6.4): a report that answers "how good is it, how do we know,
 * and where does it fail?" Summary first (takeaway title, test-vs-CV sentence, four KPI tiles), then
 * the multimodal evidence, discrimination, calibration, the linked threshold explorer, robustness
 * across re-splits, subgroups, the model comparison and the protocol. Every number comes from
 * metrics.json; sections for analyses not yet published are simply absent.
 */
export default function PerformancePage() {
  const metrics = useMetrics();
  const schema = useSchemaIndex();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1440px)');
  const H = wide ? 240 : 200;

  const target: KnownTargetId = isTarget(params.get('t')) ? (params.get('t') as KnownTargetId) : 'CAD';
  const split: Split = params.get('split') === 'cv' ? 'cv' : 'test';
  const setView = (next: { t?: KnownTargetId; split?: Split }) => {
    const p = new URLSearchParams(params);
    const t = next.t ?? target;
    const s = next.split ?? split;
    if (t === 'CAD') p.delete('t');
    else p.set('t', t);
    if (s === 'test') p.delete('split');
    else p.set('split', s);
    setParams(p, { replace: true });
  };

  const [exploreState, setExploreState] = useState<{ target: string; index: number } | null>(null);
  const explore = exploreState?.target === target ? exploreState.index : null;
  const onExplore = (i: number | null) => setExploreState(i === null ? null : { target, index: i });

  const report: MetricsReport | undefined = metrics.data;
  const m = report?.targets[target];
  const facts = useMemo(() => splitFacts(report), [report]);
  const points = useMemo(() => (m ? operatingPoints(m) : []), [m]);
  const deployed = deployedIndex(points);

  const extras = useMemo(
    () => ({
      components: readComponents(m),
      calibration: readCalibrationSummary(m),
      baseline: readBaseline(m),
      robustness: readRobustness(report, target),
      modality: readModalityAblation(report, target),
      subgroups: readSubgroups(report, target),
    }),
    [m, report, target],
  );

  const across = useMemo(() => robustnessAcross(report, TARGET_ORDER, readRobustness), [report]);

  const modelVersion =
    (report as { model_version?: string } | undefined)?.model_version ?? report?.version ?? '';
  const provenance = `CardioTwin model ${modelVersion} · ${target} · held-out test (n = ${facts.nTest})`;
  const provenanceCv = `CardioTwin model ${modelVersion} · ${target} · development cross-validation (n = ${facts.nDev})`;
  const prevalence = testPrevalence(report, target, m);
  const logisticId = extras.components?.logisticId ?? null;

  const visibleSections = SECTIONS.filter(([id]) => {
    if (id === 'robustness') return !!extras.robustness;
    if (id === 'subgroups') return !!extras.subgroups;
    if (id === 'multimodal')
      return !!(extras.modality || extras.baseline || extras.robustness?.deltaVsBaseline);
    return true;
  });

  return (
    <div className="flex w-full flex-col">
      <div className="sticky top-[var(--topbar-h)] z-hud border-b border-hairline bg-app">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-4 overflow-x-auto px-6 [scrollbar-width:none]">
          <Tabs
            idBase="perf-target"
            label="Target"
            size="md"
            value={target}
            onChange={(t) => setView({ t })}
            items={TARGET_ORDER.map((t) => ({ value: t, label: t }))}
            className="h-full items-stretch border-b-0 [&>button]:h-full"
          />
          <SegmentedControl
            label="Evaluation split"
            className="shrink-0"
            value={split}
            onChange={(v) => setView({ split: v as Split })}
            options={[
              {
                value: 'test',
                label: 'Held-out test',
                title: TEST_SET.split,
              },
              {
                value: 'cv',
                label: 'Cross-validation',
                title: 'Repeated nested cross-validation on the development set',
              },
            ]}
          />
          {m && <SectionNav ids={visibleSections} />}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-6 pb-16 pt-8">
        {metrics.status === 'loading' && <PageSkeleton height={H} />}
        {(metrics.status === 'missing' || metrics.status === 'error') && (
          <EmptyState title="Evaluation report not published yet">
            The ML pipeline writes the evaluation report next to the model. Run the training pipeline or start
            the API to see the numbers here.
          </EmptyState>
        )}

        {report && m && (
          <div
            id={tabPanelId('perf-target', target)}
            role="tabpanel"
            aria-labelledby={`perf-target-tab-${target}`}
            className="flex flex-col gap-8"
          >
            <section
              id="summary"
              data-region="performance-summary"
              aria-labelledby="summary-title"
              className="flex scroll-mt-[calc(var(--topbar-h)+72px)] flex-col gap-5"
            >
              <header className="flex flex-col gap-2">
                <p className="eyebrow text-accent">Model performance · {TARGET_NAMES[target]}</p>
                <h1
                  id="summary-title"
                  className="max-w-[30ch] font-display text-display-2 text-primary text-balance"
                >
                  {pageTakeaway(target, m, split)}
                </h1>
                <p className="max-w-[92ch] text-body text-secondary text-pretty">
                  {reconcileSentence(m, split, facts, extras.robustness)}
                </p>
                <p className="text-label font-normal text-tertiary">
                  Deployed: {deployedModelPhrase(logisticId)}, Platt-calibrated, with a decision threshold of{' '}
                  <span className="num text-secondary">{formatMetricValue(m.threshold)}</span> chosen on
                  development folds.
                </p>
              </header>
              <SummaryTiles
                tiles={kpis(m, split, target, facts, prevalence)}
                split={split}
                more={moreMetrics(m)}
              />
            </section>

            {visibleSections.some(([id]) => id === 'multimodal') && (
              <Section
                id="multimodal"
                title="Multimodal value"
                lede="CardioTwin fuses seven clinical modalities: demographics, history, symptoms, examination, resting ECG, laboratory tests and echocardiography. These analyses test whether the fusion pays off, against a bedside-only baseline and modality by modality."
              >
                <MultimodalHeadline
                  target={target}
                  modality={extras.modality}
                  baseline={extras.baseline}
                  testAuc={m.test.roc_auc?.value ?? null}
                  robustness={extras.robustness}
                  nFolds={facts.nFolds}
                />
                {extras.modality && (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="lg:col-span-7">
                      <CumulativeModule
                        target={target}
                        a={extras.modality}
                        height={H + 24}
                        provenance={provenanceCv}
                      />
                    </div>
                    <div className="lg:col-span-5">
                      <LeaveOneOutModule
                        target={target}
                        a={extras.modality}
                        height={H + 24}
                        provenance={provenanceCv}
                      />
                    </div>
                  </div>
                )}
              </Section>
            )}

            <Section
              id="discrimination"
              title="Discrimination"
              lede="Can it tell who has the disease from who does not? Curves are drawn on the held-out test set."
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <RocModule
                  target={target}
                  m={m}
                  points={points}
                  deployed={deployed}
                  explore={explore}
                  onExplore={onExplore}
                  height={H}
                  provenance={provenance}
                  nTest={facts.nTest}
                />
                <PrModule
                  target={target}
                  m={m}
                  points={points}
                  deployed={deployed}
                  explore={explore}
                  onExplore={onExplore}
                  height={H}
                  provenance={provenance}
                  nTest={facts.nTest}
                  prevalence={prevalence}
                />
              </div>
            </Section>

            <Section
              id="calibration"
              title="Calibration and clinical usefulness"
              lede="Can the percentages be taken at face value, and would acting on them help?"
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CalibrationModule
                  target={target}
                  m={m}
                  height={H}
                  provenance={provenance}
                  nTest={facts.nTest}
                  summary={extras.calibration}
                />
                <DecisionCurveModule
                  target={target}
                  m={m}
                  points={points}
                  deployed={deployed}
                  explore={explore}
                  onExplore={onExplore}
                  height={H}
                  provenance={provenance}
                  nTest={facts.nTest}
                />
              </div>
            </Section>

            <Section
              id="decisions"
              title="Decisions"
              lede="What happens at the threshold, and what would change if it moved. Exploring never changes the deployed model."
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <ConfusionModule
                    target={target}
                    m={m}
                    points={points}
                    deployed={deployed}
                    explore={explore}
                    height={H}
                    nTest={facts.nTest}
                    provenance={provenance}
                  />
                </div>
                <div className="lg:col-span-7">
                  <ThresholdExplorer
                    target={target}
                    points={points}
                    deployed={deployed}
                    explore={explore}
                    onExplore={onExplore}
                    height={H}
                    nTest={facts.nTest}
                    provenance={provenance}
                  />
                </div>
              </div>
            </Section>

            {extras.robustness && (
              <Section
                id="robustness"
                title="Robustness"
                lede={`One ${facts.nTest}-patient test set is a single draw. Re-running the complete recipe on many random splits shows how much a held-out estimate can move, and where the published split falls.`}
              >
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-7">
                    <RobustnessModule
                      target={target}
                      r={extras.robustness}
                      height={H}
                      provenance={provenance}
                    />
                  </div>
                  <div className="lg:col-span-5">
                    <RobustnessStatsModule target={target} r={extras.robustness} height={H} />
                  </div>
                  {across.length > 1 && (
                    <div className="lg:col-span-12">
                      <AcrossTargetsModule
                        rows={across}
                        nSplits={extras.robustness.nSplits}
                        height={H - 24}
                        provenance={`CardioTwin model ${modelVersion} · all targets · ${extras.robustness.nSplits} Monte-Carlo re-splits`}
                      />
                    </div>
                  )}
                </div>
              </Section>
            )}

            {extras.subgroups && (
              <Section
                id="subgroups"
                title="Subgroups"
                lede={`Does it work equally well for women and men, across ages, and with or without diabetes? Follows the split selector above: on the ${facts.nTest}-patient test split most subgroups are small, so the cross-validation view is the steadier read.`}
              >
                <SubgroupsModule
                  target={target}
                  s={extras.subgroups}
                  source={split === 'test' ? 'test' : 'oof'}
                  height={H + 40}
                  provenance={split === 'test' ? provenance : provenanceCv}
                />
              </Section>
            )}

            <Section
              id="models"
              title="Model comparison"
              lede="Every candidate was cross-validated on identical folds; the deployed ensemble is highlighted."
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <LeaderboardModule
                    target={target}
                    m={m}
                    logisticId={logisticId}
                    byKey={schema?.byKey}
                    height={H + 24}
                    nFolds={facts.nFolds}
                    provenance={provenanceCv}
                  />
                </div>
                <div className="lg:col-span-5">
                  <DriversModule
                    target={target}
                    m={m}
                    logisticId={logisticId}
                    byKey={schema?.byKey}
                    height={H + 24}
                    nFolds={facts.nFolds}
                    provenance={provenanceCv}
                  />
                </div>
              </div>
            </Section>

            <Section id="protocol" title="Validation protocol">
              <ProtocolStrip report={report} facts={facts} />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
