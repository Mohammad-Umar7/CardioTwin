/**
 * The printable report itself: two paper sheets laid out to fit one A4 or US Letter page each. Purely
 * presentational — every number and word comes from `buildReport` (reportModel.ts) and
 * `normalisePerformance` (performance.ts).
 */
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { EN_DASH, formatCi, formatMetricValue, formatPercent, THIN_SPACE } from '@/lib/format';
import { CoronarySchematic, type SchematicVessel } from './CoronarySchematic';
import { BandTag, DivergingBar, PaperProbability, PaperTrack, Pip, RampLegend, Verdict } from './marks';
import { MODEL_PLAIN_NAME, type MetricCell, type PerformanceSummary } from './performance';
import type { DriverPanel, InputGroup, InputRow, ReportModel, TargetResult } from './reportModel';

const PAGES = 2;
const pct = (n: number) => `${n}${THIN_SPACE}%`;

// ------------------------------------------------------------------------------------ building blocks

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden fill="none">
      <path d="M16 3.5 28.5 16 16 28.5 3.5 16Z" stroke="#0B0E12" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M10 16.5h3.4l1.5-3.6 2.6 6.6 1.6-3h3" stroke="#3E9FC2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="rp-section__head">
      <h2 id={id} className="rp-section__title">
        {title}
      </h2>
      {aside && <span className="rp-section__aside">{aside}</span>}
    </div>
  );
}

/** One line on every page: the disclaimer, the report id and the page number. */
function SheetFoot({ model, page }: { model: ReportModel; page: number }) {
  return (
    <footer className="rp-foot">
      <span>
        <strong>Not a diagnosis.</strong> Decision support &amp; education only; not a substitute for diagnostic imaging.
      </span>
      <span className="rp-num" style={{ whiteSpace: 'nowrap' }}>
        <span className="rp-mono">{model.header.reportId}</span> · Page {page} of {PAGES}
      </span>
    </footer>
  );
}

// -------------------------------------------------------------------------------------------- page 1

function ReportHead({ model }: { model: ReportModel }) {
  return (
    <header className="rp-head">
      <div className="rp-brand">
        <BrandMark />
        <div>
          <div className="rp-brand__name">CardioTwin</div>
          <h1 className="rp-brand__doc">Coronary risk report · explainable model estimate</h1>
        </div>
      </div>
      <div className="rp-head__tags">
        <div className="rp-head__tagrow">
          {model.editedCount > 0 && <span className="rp-tag">What-if scenario</span>}
          <span className="rp-tag rp-tag--solid">Model estimate</span>
        </div>
        <span className="rp-watermark">NOT FOR DIAGNOSTIC USE</span>
      </div>
    </header>
  );
}

function MetaStrip({ model }: { model: ReportModel }) {
  const h = model.header;
  return (
    <dl className="rp-meta">
      <div>
        <dt>Patient</dt>
        <dd>
          <span className="rp-mono rp-strong">{h.patientLabel}</span>
          {h.splitTag && <span className="rp-tag rp-tag--xs">{h.splitTag}</span>}
          {h.demographics && <span className="rp-ink-2"> · {h.demographics}</span>}
        </dd>
        <dd className="rp-sub">{h.splitText}</dd>
      </div>
      <div>
        <dt>Generated</dt>
        <dd>
          <time dateTime={h.generatedIso}>{h.generatedText}</time>
        </dd>
        <dd className="rp-sub">Local time</dd>
      </div>
      <div>
        <dt>Engine · model</dt>
        <dd>
          {h.engineLabel} · <span className="rp-mono">v{h.modelVersion ?? '—'}</span>
        </dd>
        <dd className="rp-sub">Schema v{h.schemaVersion}</dd>
      </div>
      <div>
        <dt>Report ID</dt>
        <dd>
          <span className="rp-mono">{h.reportId}</span>
        </dd>
        <dd className="rp-sub">Hash of inputs + model</dd>
      </div>
    </dl>
  );
}

function SafetyNotice({ prevalence }: { prevalence: number | undefined }) {
  return (
    <aside className="rp-safety" aria-label="Clinical safety disclaimer">
      <Info className="rp-safety__icon" strokeWidth={1.75} aria-hidden />
      <div>
        <p className="rp-safety__lead">
          Decision support &amp; education only — <strong>not a diagnosis</strong>; not a substitute for angiography, CTCA
          or formal diagnostic imaging, or for clinical judgement.
        </p>
        <p className="rp-safety__more">
          Statistical estimates per vessel; no lesion is localised · single-centre cohort (
          {prevalence !== undefined ? formatPercent(prevalence) : pct(71)} with CAD), not externally validated · research
          prototype, not a medical device.
        </p>
      </div>
    </aside>
  );
}

function StateNotice({ model }: { model: ReportModel }) {
  return (
    <div className="rp-state" role="status">
      <span aria-hidden className="rp-state__dot" />
      <span>
        <strong className="rp-strong">{model.state === 'updating' ? 'Updating.' : 'Estimate unavailable.'}</strong>{' '}
        {model.stateMessage}
      </span>
    </div>
  );
}

/** What-if "was" line: the estimate for the recorded inputs and the change in points (V2 §3.3). */
function WasLine({ recorded, compact }: { recorded: NonNullable<TargetResult['recorded']>; compact?: boolean }) {
  const d = recorded.delta;
  return (
    <span className="rp-was rp-num">
      {!compact && <>was {recorded.pctText} · </>}
      {d.direction === 'none' ? 'no change' : `${d.glyph} ${d.text}`}
      <span className="sr-only"> from the recorded inputs</span>
    </span>
  );
}

function CadBlock({ cad, sentence }: { cad: TargetResult; sentence: string }) {
  return (
    <div className="rp-cad">
      <div className="rp-cad__label">
        <span className="rp-overline rp-ink-1">{cad.label}</span>
        <span className="rp-cad__def">
          Probability of ≥{THIN_SPACE}50{THIN_SPACE}% narrowing in at least one major coronary artery
        </span>
      </div>
      <PaperProbability p={cad.p} text={cad.pctText} target={cad.id} className="rp-cad__value" />
      <div className="rp-cad__side">
        <div className="rp-cad__tags">
          <BandTag band={cad.band} />
          {cad.recorded && <WasLine recorded={cad.recorded} />}
        </div>
        <PaperTrack p={cad.p} threshold={cad.threshold} scale thresholdText={cad.thresholdText} />
      </div>
      <div className="rp-cad__verdict">
        <Verdict flagged={cad.flagged} text={cad.verdictLine} />
      </div>
      {sentence && <p className="rp-cad__why">{sentence}</p>}
    </div>
  );
}

function VesselTable({ model }: { model: ReportModel }) {
  return (
    <table className="rp-table rp-vessels">
      <caption className="sr-only">Vessel-level estimates: {model.flaggedText}</caption>
      <thead>
        <tr>
          <th scope="col">Vessel</th>
          <th scope="col" className="rp-r">
            {model.vessels.some((v) => v.recorded) ? 'Probability · Δ' : 'Probability'}
          </th>
          <th scope="col">Scale · threshold</th>
          <th scope="col">{model.flaggedText}</th>
          {model.truthShown && <th scope="col">Cath result</th>}
        </tr>
      </thead>
      <tbody>
        {model.vessels.map((v) => (
          <tr key={v.id}>
            <th scope="row">
              <span className="rp-vessel">
                <Pip p={v.p} />
                <span>
                  <span className="rp-vessel__code">{v.short}</span>
                  {!model.truthShown && <span className="rp-vessel__name">{v.label.replace(/ artery$/, '')}</span>}
                </span>
              </span>
            </th>
            <td className="rp-r">
              <span className="rp-vessel__prob">
                <PaperProbability p={v.p} text={v.pctText} target={v.id} className="rp-vessel__p" />
                {v.recorded && <WasLine recorded={v.recorded} compact />}
                <BandTag band={v.band} />
              </span>
            </td>
            <td>
              <PaperTrack p={v.p} threshold={v.threshold} thresholdText={v.thresholdText} />
            </td>
            <td>
              <Verdict flagged={v.flagged} />
            </td>
            {model.truthShown && (
              <td className="rp-ink-2">
                {v.truth ? (
                  <span className="rp-truth">
                    <span>{v.truth.stenotic ? '● Stenotic' : '○ Not stenotic'}</span>
                    <span className="rp-ink-3">{v.truth.agrees ? '✓ agrees' : '✕ disagrees'}</span>
                  </span>
                ) : (
                  '—'
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DriverCard({ panel }: { panel: DriverPanel }) {
  const points = panel.unit === 'points';
  return (
    <div className="rp-driver">
      <div className="rp-driver__head">
        <span className="rp-driver__title">
          {panel.short} <span>· {panel.label.replace(/ artery$/, '')}</span>
        </span>
        <span className="rp-driver__base rp-num">
          {points ? 'baseline' : 'baseline (log-odds)'} {panel.baselineText}
        </span>
      </div>
      {panel.rows.length === 0 && <p className="rp-note">No single input moves this estimate noticeably.</p>}
      {panel.rows.map((r) => (
        <div key={r.feature} className="rp-driver__row">
          <span className="rp-driver__dir" aria-hidden>
            {r.direction === 'raises' ? '▶' : '◀'}
          </span>
          <span className="rp-driver__label">
            {r.label}
            <span className="sr-only">
              , {r.valueText}, {r.direction === 'raises' ? 'raises' : 'lowers'} {panel.short} risk
            </span>
          </span>
          <span className="rp-driver__value rp-num" aria-hidden>
            {r.valueText}
          </span>
          <DivergingBar value={r.pp} max={panel.maxAbs} />
          <span className="rp-driver__pts rp-num">{r.ppText}</span>
        </div>
      ))}
      {panel.others.count > 0 && (
        <div className="rp-driver__others rp-num">
          <span>
            {panel.others.count} other input{panel.others.count === 1 ? '' : 's'}, combined
          </span>
          <span>{panel.others.text}</span>
        </div>
      )}
    </div>
  );
}

function PageOne({ model, perf }: { model: ReportModel; perf: PerformanceSummary | null }) {
  const ready = model.state === 'ready' && model.cad !== null;
  const schematic: SchematicVessel[] = ready
    ? model.vessels.map((v) => ({ id: v.id, p: v.p, flagged: v.flagged }))
    : ['LAD', 'LCX', 'RCA'].map((id) => ({ id, p: null, flagged: null }));
  const unit = model.drivers[0]?.unit ?? 'points';
  return (
    <article className="rp-sheet" aria-label={`Report page 1 of ${PAGES}`} data-label={`Page 1 of ${PAGES}`}>
      <ReportHead model={model} />
      <MetaStrip model={model} />
      <SafetyNotice prevalence={perf?.prevalence.CAD} />

      <section className="rp-section" aria-labelledby="rp-result">
        <SectionHead
          id="rp-result"
          title="Result"
          aside={
            model.editedCount > 0
              ? `What-if: ${model.editedCount} input${model.editedCount === 1 ? '' : 's'} changed from the record (✎ on page 2)`
              : 'From the recorded inputs'
          }
        />
        {!ready && <StateNotice model={model} />}
        <div className="rp-summary">
          <figure className="rp-figure">
            <CoronarySchematic vessels={schematic} />
            <RampLegend width={196} />
            <figcaption>
              Anterior view, patient’s left on the right. One colour per artery: its predicted probability, not a lesion
              location. Left main (LM) not predicted.
            </figcaption>
          </figure>
          {ready && model.cad ? (
            <div className="rp-results">
              <CadBlock cad={model.cad} sentence={model.cadSentence} />
              <VesselTable model={model} />
            </div>
          ) : (
            <div aria-hidden className="rp-skeleton">
              {[88, 60, 100, 100, 100].map((w, i) => (
                <div key={i} style={{ height: i === 0 ? 44 : 22, width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
        {ready && (
          <p className="rp-note">
            {model.truthWithheld && 'The catheterisation result is not compared while inputs differ from the record. '}
            Band = size of the probability (cut-offs 25, 50, 75{THIN_SPACE}%). Verdict = probability against that target’s own
            decision threshold (Youden’s J on development data), so a vessel can be Moderate and still Flagged.
          </p>
        )}
      </section>

      {ready && model.drivers.length > 0 && (
        <section className="rp-section" aria-labelledby="rp-drivers">
          <SectionHead
            id="rp-drivers"
            title="What drives each estimate"
            aside={`Top ${model.drivers[0]?.rows.length ?? 5} inputs per target · ${unit === 'points' ? 'percentage points' : 'log-odds'}`}
          />
          <div className="rp-drivers">
            {model.drivers.map((d) => (
              <DriverCard key={d.target} panel={d} />
            ))}
          </div>
          <p className="rp-note">
            {unit === 'points'
              ? 'Exact SHAP contributions, converted from log-odds through the calibration so that the cohort baseline plus every contribution equals the estimate. ▶ raises, ◀ lowers. Associations in this cohort, not causes.'
              : 'Exact SHAP contributions in log-odds (this engine sent no calibrated values); they add up from the baseline to the model margin. ▶ raises, ◀ lowers. Associations in this cohort, not causes.'}
          </p>
        </section>
      )}

      <SheetFoot model={model} page={1} />
    </article>
  );
}

// -------------------------------------------------------------------------------------------- page 2

function InputLine({ row }: { row: InputRow }) {
  return (
    <div className={`rp-in ${row.flagText ? 'rp-in--abnormal' : ''}`}>
      <span className="rp-in__label">
        {row.edited && <span aria-hidden>✎ </span>}
        {row.label}
        {row.imputed && <span className="rp-imputed">imputed</span>}
        {row.edited && <span className="rp-in__was">recorded {row.wasText}</span>}
      </span>
      <span className="rp-in__value rp-num">{row.valueText}</span>
      <span className="rp-in__flag">
        {row.flagText && (
          <>
            {row.status === 'above' ? '▲ above' : '▼ below'}
            <span className="sr-only"> the normal range</span>
          </>
        )}
      </span>
      <span className="rp-in__ref rp-num">{row.refText}</span>
    </div>
  );
}

function InputGroupBlock({ group }: { group: InputGroup }) {
  const counts = [
    group.abnormalCount > 0 ? `${group.abnormalCount} outside range` : null,
    group.findingCount > 0 ? `${group.findingCount} present` : null,
  ].filter(Boolean);
  return (
    <div className="rp-group">
      <div className="rp-group__head">
        <span className="rp-group__title">{group.label}</span>
        <span className="rp-group__count">{counts.join(' · ')}</span>
      </div>
      {group.rows.map((r) => (
        <InputLine key={r.key} row={r} />
      ))}
      {group.present.length > 0 && (
        <div className="rp-findings rp-findings--present">
          <span className="rp-findings__key">Present</span>
          <span className="rp-findings__list">{group.present.map((r) => r.label).join(', ')}</span>
        </div>
      )}
      {group.absent.length > 0 && (
        <div className="rp-findings rp-findings--absent">
          <span className="rp-findings__key">Absent</span>
          <span className="rp-findings__list">{group.absent.map((r) => r.label).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

const metric = (m: MetricCell | null) =>
  m ? (
    <>
      {formatMetricValue(m.value)}
      {m.ci && <span className="rp-ci"> {formatCi(m.ci)}</span>}
    </>
  ) : (
    <span className="rp-ink-3">—</span>
  );

function PerformanceTable({ perf }: { perf: PerformanceSummary }) {
  const robust = perf.rows.filter((r) => r.robustAuc);
  return (
    <>
      <table className="rp-table rp-perf">
        <caption className="sr-only">Model performance on the locked test set</caption>
        <thead>
          <tr>
            <th scope="col">Target</th>
            <th scope="col" className="rp-r">
              ROC-AUC [95{THIN_SPACE}% CI]
            </th>
            <th scope="col" className="rp-r">
              Sensitivity
            </th>
            <th scope="col" className="rp-r">
              Specificity
            </th>
            <th scope="col" className="rp-r">
              Threshold
            </th>
            <th scope="col" className="rp-r">
              Dev CV AUC
            </th>
          </tr>
        </thead>
        <tbody className="rp-num">
          {perf.rows.map((r) => (
            <tr key={r.target}>
              <th scope="row">
                <span className="rp-strong">{r.target}</span>
              </th>
              <td className="rp-r">{metric(r.auc)}</td>
              <td className="rp-r">{metric(r.sensitivity)}</td>
              <td className="rp-r">{metric(r.specificity)}</td>
              <td className="rp-r">{r.threshold !== null ? formatPercent(r.threshold) : '—'}</td>
              <td className="rp-r">
                {r.cvAuc ? (
                  <>
                    {formatMetricValue(r.cvAuc.mean)}
                    {r.cvAuc.sd !== null && <span className="rp-ci"> ± {formatMetricValue(r.cvAuc.sd)}</span>}
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rp-note">
        {MODEL_PLAIN_NAME}. Test metrics were computed once on a locked set of {perf.nTest} patients after every modelling
        decision was frozen; sensitivity and specificity at the deployed threshold. Dev CV: repeated 5-fold cross-validation
        on {perf.nDev} patients (mean ± sd).
        {robust.length > 0 &&
          ` Median held-out ROC-AUC over ${robust[0]!.robustAuc!.nSplits ?? 'repeated'} random re-splits: ${robust
            .map((r) => `${r.target} ${formatMetricValue(r.robustAuc!.p50)}`)
            .join(', ')}.`}
      </p>
    </>
  );
}

function About({ model, perf }: { model: ReportModel; perf: PerformanceSummary | null }) {
  const h = model.header;
  const prevalence = perf?.prevalence.CAD;
  return (
    <div className="rp-about">
      <div>
        <h3>Intended use</h3>
        <p>
          Educational and decision-support research prototype. Not a diagnosis; does not replace invasive angiography,
          CT coronary angiography (CTCA), other formal imaging or clinical judgement.
        </p>
      </div>
      <div>
        <h3>What is estimated</h3>
        <p>
          The probability of ≥{THIN_SPACE}50{THIN_SPACE}% narrowing in any major artery (CAD) and in the LAD, LCX and RCA,
          from routine clinical data. Risk is per vessel; no lesion is localised.
        </p>
      </div>
      <div>
        <h3>Data</h3>
        <p>
          {perf?.datasetName ?? 'Extension of Z-Alizadeh Sani'} (UCI #411): {perf?.n ?? 303} patients referred for
          angiography, one centre, {prevalence !== undefined ? formatPercent(prevalence) : pct(71)} with CAD. Probabilities do
          not transfer to screening populations.
        </p>
      </div>
      <div>
        <h3>Calibration and validation</h3>
        <p>
          Platt-calibrated. Thresholds were tuned on development folds and frozen before the held-out test set was scored
          once. Not externally validated; performance elsewhere is unknown.
        </p>
      </div>
      <div>
        <h3>Colours</h3>
        <p>
          Only data is coloured: blue{EN_DASH}violet{EN_DASH}coral{EN_DASH}apricot rises with probability; each artery is one
          colour. Bands: Low &lt;{THIN_SPACE}25, Moderate 25{EN_DASH}50, High 50{EN_DASH}75, Very high ≥{THIN_SPACE}75{THIN_SPACE}%.
        </p>
      </div>
      <div>
        <h3>Provenance</h3>
        <p>
          {h.engineText} Model v{h.modelVersion ?? '—'}, schema v{h.schemaVersion}, generated {h.generatedText}. Dataset CC BY
          4.0; code MIT.
        </p>
      </div>
    </div>
  );
}

function PageTwo({ model, perf }: { model: ReportModel; perf: PerformanceSummary | null }) {
  const h = model.header;
  const t = model.totals;
  const totals = [
    `${t.total} inputs`,
    `${t.abnormal} outside the reference range`,
    `${t.findings} findings present`,
    t.imputed > 0 ? `${t.imputed} imputed` : null,
    t.edited > 0 ? `${t.edited} changed` : null,
  ].filter(Boolean);
  return (
    <article className="rp-sheet" aria-label={`Report page 2 of ${PAGES}`} data-label={`Page 2 of ${PAGES}`}>
      <div className="rp-runhead">
        <span>
          <span className="rp-strong">CardioTwin</span> <span className="rp-ink-3">· Coronary risk report ·</span>{' '}
          <span className="rp-mono rp-strong">{h.patientLabel}</span>
          {h.demographics && <span className="rp-ink-2"> · {h.demographics}</span>}
          <span className="rp-ink-3"> · {h.generatedText}</span>
        </span>
        <span className="rp-watermark">NOT FOR DIAGNOSTIC USE</span>
      </div>

      <section className="rp-section" aria-labelledby="rp-inputs">
        <SectionHead id="rp-inputs" title="Inputs the model saw" aside={totals.join(' · ')} />
        <div className="rp-inputs">
          {model.inputs.map((g) => (
            <InputGroupBlock key={g.id} group={g} />
          ))}
        </div>
        <p className="rp-note">
          Grey ranges are the adult reference ranges held in the model schema; ▲/▼ mark values above or below them.
          “Imputed” values were missing and filled with the cohort median or mode.
          {model.editedCount > 0 ? ' ✎ marks a what-if change, with the recorded value beneath.' : ''}
        </p>
      </section>

      <section className="rp-section" aria-labelledby="rp-perf">
        <SectionHead
          id="rp-perf"
          title="Model performance"
          aside={perf ? `Locked test set · n${THIN_SPACE}=${THIN_SPACE}${perf.nTest}` : undefined}
        />
        {perf ? <PerformanceTable perf={perf} /> : <p className="rp-note">Performance metrics are not available in this deployment.</p>}
      </section>

      <section className="rp-section" aria-labelledby="rp-about">
        <SectionHead id="rp-about" title="About these estimates" />
        <About model={model} perf={perf} />
      </section>

      <SheetFoot model={model} page={2} />
    </article>
  );
}

export function ReportDocument({ model, perf }: { model: ReportModel; perf: PerformanceSummary | null }) {
  return (
    <>
      <PageOne model={model} perf={perf} />
      <PageTwo model={model} perf={perf} />
    </>
  );
}
