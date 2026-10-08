import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Popover, Tooltip } from '@/design';
import { deriveEnginePill, formatDelta, type EnginePillKind, type EnginePillTone } from '@/inference/enginePill';
import {
  summarizeVerification,
  useEngineVerification,
  useVerificationStore,
  useVerifyingFor,
} from '@/inference/verification';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/routes';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

/**
 * Dot colour per state (WORKSTATION_V2 §5.3): success for Server ✓, accent for the in-browser engine
 * (and while verifying), text/tertiary while connecting or offline, danger for Error, warn for a
 * cross-check disagreement. System status, never risk: the Ember ramp is not used here.
 */
const DOT: Record<EnginePillTone, string> = {
  accent: 'bg-accent shadow-[0_0_8px_rgba(86,194,230,0.8)]',
  success: 'bg-success shadow-[0_0_8px_rgba(63,182,139,0.85)]',
  neutral: 'bg-tertiary',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/** States that need attention keep their words next to the dot; every other state rests as the dot alone. */
const LOUD: ReadonlySet<EnginePillKind> = new Set(['disagree', 'error']);

/**
 * EngineDot (WORKSTATION_V2 §5.3; LUMEN §5 EnginePill states): which engine produced the numbers on screen.
 * At rest it is an 8 px dot in a 24 px hit area; hover or focus shows the provenance (model version,
 * latency, cross-check result, render tier, fps) and a click pins it as a popover with a "Model card ›"
 * link. Every EnginePill state is kept; only the resting representation shrinks:
 *   Connecting… · Server ✓ · Edge 3 ms [✓] · Verifying · Engines disagree · Edge · server offline ·
 *   Server offline · Error
 * "Engines disagree" and "Error" also keep their words. While both engines exist it keeps the cross-check
 * running (`@/inference/verification`): the patient on screen is predicted by both engines and compared at
 * the contract tolerances, then the whole cohort in the background.
 */
export function EngineBadge({ className }: { className?: string }) {
  useEngineVerification();
  const patient = usePatientStore(
    useShallow((s) => ({
      engineStatus: s.engineStatus,
      description: s.engineDescription,
      latency: s.latencyMs,
      predictionStatus: s.status,
      modelVersion: s.prediction?.model_version ?? null,
      predictionEngine: s.prediction?.engine ?? null,
      patientId: s.mode === 'cohort' ? s.selectedPatientId : null,
    })),
  );
  const { health, reason } = useEngineStore(useShallow((s) => ({ health: s.health, reason: s.reason })));
  const verification = useVerificationStore(
    useShallow((s) => ({ enabled: s.enabled, why: s.reason, secondary: s.secondary, records: s.records, total: s.total, lastError: s.lastError })),
  );
  const activeKey = useVerificationStore((s) => s.active?.key ?? null);
  const verifying = useVerifyingFor(patient.patientId);
  const tier = useViewerStore((s) => s.tier);
  const fps = useViewerStore((s) => s.fps);

  const summary = useMemo(() => summarizeVerification(verification.records), [verification.records]);
  const current = patient.patientId ? verification.records[patient.patientId] : undefined;
  const pill = deriveEnginePill({
    engineStatus: patient.engineStatus,
    predictionStatus: patient.predictionStatus,
    predictionEngine: patient.predictionEngine,
    latencyMs: patient.latency,
    serverHealthy: health !== null,
    verifying,
    disagreement: summary.disagreeing.length > 0,
    currentVerified: current?.agree === true,
  });
  const other = verification.secondary === 'edge' ? 'in-browser engine' : 'server';
  const firstDisagreement = current && !current.agree ? current : summary.disagreeing[0];

  const matches =
    current?.agree === true && (pill.kind === 'server' || pill.kind === 'edge')
      ? ` · matches the ${verification.secondary === 'edge' ? 'edge' : 'server'} (|Δp| < 10⁻⁶)`
      : '';
  const details = (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-primary">
        {pill.text}
        {matches}
      </div>
      <div className="text-secondary">{patient.description}</div>
      {(patient.modelVersion ?? health?.model_version) && (
        <div className="text-secondary">
          Model <span className="mono">v{patient.modelVersion ?? health?.model_version}</span>
          {health?.predictor === 'fake' && ' · synthetic development predictor, not the trained model'}
        </div>
      )}
      {patient.latency !== null && (
        <div className="text-secondary">
          Last estimate in {Math.max(1, Math.round(patient.latency))} ms
          {patient.predictionEngine === 'edge' && patient.engineStatus === 'server' && ' · computed in the browser while the server is unreachable'}
        </div>
      )}
      {patient.engineStatus === 'unavailable' && (
        <div className="text-secondary">No estimate can be computed: the server is offline and the in-browser model did not load.</div>
      )}
      {verification.enabled ? (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
          <div className="text-secondary">Cross-check against the {other}</div>
          {patient.patientId && (
            <div className={cn(current && !current.agree ? 'text-warn' : 'text-secondary')}>
              {patient.patientId}:{' '}
              {current
                ? current.agree
                  ? `engines agree (|Δp| ${formatDelta(current.report.maxDeltaProbability)}${
                      current.report.boundaryTies.length > 0 ? ` · ${current.report.boundaryTies.length} boundary tie` : ''
                    })`
                  : `engines disagree · ${current.report.mismatches[0] ?? ''}`
                : activeKey === patient.patientId
                  ? 'checking…'
                  : 'queued'}
            </div>
          )}
          {summary.checked > 0 && (
            <div className="text-secondary">
              <span className="num">
                {summary.agreeing} / {Math.max(verification.total, summary.checked)}
              </span>{' '}
              patients agree · max |Δp| {formatDelta(summary.maxDeltaProbability)} · max |Δshap| {formatDelta(summary.maxDeltaShap)}
            </div>
          )}
          {firstDisagreement && firstDisagreement !== current && (
            <div className="text-warn">
              {firstDisagreement.key}: {firstDisagreement.report.mismatches[0]}
            </div>
          )}
          <div className="text-tertiary">
            Tolerance |Δp| &lt; 10⁻⁶, |Δshap| &lt; 10⁻⁵, identical labels and bands (except a probability within 10⁻⁶ of a cut-off).
          </div>
        </div>
      ) : (
        patient.engineStatus !== 'resolving' && <div className="text-tertiary">{verification.why}</div>
      )}
      {verification.lastError && <div className="text-tertiary">Last cross-check failed: {verification.lastError}</div>}
      {reason && <div className="text-tertiary">{reason}</div>}
      <div className="text-tertiary">
        Render tier {tier}
        {fps !== null ? ` · ${Math.round(fps)} fps` : ''}
      </div>
    </div>
  );

  const loud = LOUD.has(pill.kind);
  return (
    <Popover
      label="Prediction engine"
      placement="bottom"
      width={340}
      trigger={({ ref, ...props }) => (
        <Tooltip content={details} placement="bottom" disabled={props['aria-expanded']}>
          <button
            ref={ref}
            {...props}
            type="button"
            data-tour="engine"
            data-region="engine-dot"
            data-engine-state={pill.kind}
            aria-label={`Prediction engine: ${pill.text}`}
            className={cn(
              'inline-flex h-6 min-w-6 items-center justify-center gap-1.5 rounded-full outline-none transition-colors duration-fast',
              'hover:bg-white/[0.05] focus-visible:shadow-focus aria-expanded:bg-white/[0.08]',
              loud && 'border border-white/10 bg-white/[0.04] px-2 text-label',
              pill.tone === 'danger' ? 'text-danger' : pill.tone === 'warn' ? 'text-warn' : 'text-secondary',
              className,
            )}
          >
            {pill.tone === 'warn' ? (
              <AlertTriangle aria-hidden className="size-3 stroke-[1.75]" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  DOT[pill.tone],
                  pill.kind === 'verifying' && 'motion-safe:animate-pulse',
                )}
              />
            )}
            <span className={cn('whitespace-nowrap', !loud && 'sr-only')}>{pill.text}</span>
          </button>
        </Tooltip>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-3 text-label font-normal">
          {details}
          <Link
            to={`${ROUTES.methodology}#model-card`}
            onClick={close}
            className="self-start rounded-sm font-semibold text-accent outline-none hover:text-accent-hover focus-visible:shadow-focus"
          >
            Model card ›
          </Link>
        </div>
      )}
    </Popover>
  );
}
