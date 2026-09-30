/**
 * Route `/report` — the printable clinical report (default export, lazy-loaded by the router).
 *
 * It renders the CURRENT workstation state (patient, inputs incl. what-if edits, latest prediction,
 * engine) as two paper sheets that print to a clean 2-page A4 or US Letter PDF through the browser
 * ("Print / Save as PDF"). The app chrome (top bar, status line, canvas, toasts) is hidden in print by
 * report.css, the clinical-safety disclaimer is printed on every page, and nothing is shown as current
 * while an estimate is updating.
 *
 * Integration: the router registers `<Route path="report" element={<ReportPage />} />` inside the
 * AppShell (lazy import of this default export). The palette command lives in ./ReportCommands.tsx.
 */
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Button, SegmentedControl } from '@/design';
import { useCohort, useMetrics, useSchema } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import { usePatientStore } from '@/state/patientStore';
import { ReportDocument } from './ReportDocument';
import { useFitToPage } from './fitToPage';
import { metricsSummaryResource, normalisePerformance } from './performance';
import { buildReport, type ReportModel } from './reportModel';
import { usePrintSetup, type PaperSize } from './usePrintSetup';
import './report.css';

const PAPER_OPTIONS = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
] as const;

function useReportModel(): { model: ReportModel | null; loading: boolean } {
  const schema = useSchema();
  const cohort = useCohort();
  const s = usePatientStore(
    useShallow((st) => ({
      features: st.features,
      recorded: st.recorded,
      prediction: st.prediction,
      recordedPrediction: st.recordedPrediction,
      status: st.status,
      error: st.error,
      engineStatus: st.engineStatus,
      id: st.selectedPatientId,
      split: st.split,
      mode: st.mode as string,
      revealed: st.revealed,
      seq: st.predictionSeq,
    })),
  );
  // The report is stamped when the estimate it shows was produced (and refreshed on every new one).
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  useEffect(() => setGeneratedAt(new Date()), [s.seq, s.features]);

  const model = useMemo(() => {
    if (!schema.data) return null;
    const patient = s.id ? cohort.data?.patients.find((p) => p.id === s.id) : undefined;
    return buildReport({
      schema: schema.data,
      features: s.features,
      recorded: s.recorded,
      prediction: s.prediction,
      status: s.status,
      error: s.error,
      engineStatus: s.engineStatus,
      patient: { id: s.id, split: s.split, summary: patient?.summary ?? null },
      mode: s.mode,
      truth: s.revealed && patient ? patient.labels : null,
      recordedPrediction: s.recordedPrediction,
      generatedAt,
    });
  }, [schema.data, cohort.data, s, generatedAt]);
  return { model, loading: schema.status === 'loading' };
}

export default function ReportPage() {
  const navigate = useNavigate();
  const { model, loading } = useReportModel();
  const metrics = useMetrics();
  const summary = useResource(metricsSummaryResource);
  const schema = useSchema();
  const perf = useMemo(() => {
    const labels = new Map((schema.data?.targets ?? []).map((t) => [String(t.id), t.label]));
    return normalisePerformance(summary.data ?? metrics.data ?? null, labels);
  }, [summary.data, metrics.data, schema.data]);

  const { paper, setPaper, pageCss } = usePrintSetup(model);
  const ready = model?.state === 'ready';
  const stackRef = useRef<HTMLDivElement>(null);
  useFitToPage(stackRef, paper, [model, perf]);

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/workstation');
  };

  return (
    <div className="ct-report" data-paper={paper}>
      <style>{pageCss}</style>
      <div className="rp-toolbar" role="toolbar" aria-label="Report actions">
        <Button variant="ghost" size="sm" iconLeft={<ArrowLeft />} onClick={back}>
          Back
        </Button>
        <div className="rp-toolbar__title">
          <p className="m-0 text-body-s font-semibold text-primary">
            Printable report{model ? ` · ${model.header.patientLabel}` : ''}
          </p>
          <p className="rp-toolbar__hint m-0">
            {ready
              ? 'Mirrors the workstation right now. Save as PDF from the print dialog.'
              : (model?.stateMessage ?? 'Loading the patient…')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            label="Paper size"
            options={PAPER_OPTIONS}
            value={paper}
            onChange={(v) => setPaper(v as PaperSize)}
            size="xs"
          />
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Printer />}
            onClick={() => window.print()}
            disabled={!ready}
            title={ready ? 'Print or save as PDF (Ctrl P)' : 'Available once the estimate is up to date'}
          >
            Print or save PDF
          </Button>
        </div>
      </div>
      <div className="rp-stack" ref={stackRef}>
        {model ? (
          <ReportDocument model={model} perf={perf} />
        ) : (
          <article className="rp-sheet" aria-busy={loading} aria-label="Report loading">
            <div className="rp-state" role="status">
              <span aria-hidden className="rp-state__dot" />
              <span>{loading ? 'Loading the model schema…' : 'The model schema is not available, so no report can be built.'}</span>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
