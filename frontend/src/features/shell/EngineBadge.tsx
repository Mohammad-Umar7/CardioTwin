import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip } from '@/design';
import { deriveEnginePill, formatDelta, type EnginePillTone } from '@/inference/enginePill';
import {
  summarizeVerification,
  useEngineVerification,
  useVerificationStore,
  useVerifyingFor,
} from '@/inference/verification';
import { cn } from '@/lib/cn';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

const DOT: Record<EnginePillTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  neutral: 'bg-secondary',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/**
 * EnginePill (DESIGN_SYSTEM §5): which engine produced the numbers on screen, with provenance in the
 * tooltip (model version, latency, cross-check result, render tier, fps).
 *   Connecting… · Server ✓ · Edge 3 ms [✓] · Verifying · Engines disagree · Edge · server offline ·
 *   Server offline · Error
 * While both engines exist it keeps the cross-check running (`@/inference/verification`): the patient on
 * screen is predicted by both engines and compared at the contract tolerances, then the whole cohort
 * in the background.
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

  const details = (
    <div className="flex flex-col gap-1">
      <div className="font-semibold">{patient.description}</div>
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
                  ? `engines agree (|Δp| ${formatDelta(current.report.maxDeltaProbability)})`
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
          <div className="text-tertiary">Tolerance |Δp| &lt; 10⁻⁶, |Δshap| &lt; 10⁻⁵, identical labels and bands.</div>
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

  return (
    <Tooltip content={details} placement="bottom">
      <button
        type="button"
        data-tour="engine"
        data-engine-state={pill.kind}
        aria-label={`Prediction engine: ${pill.text}`}
        className={cn(
          'inline-flex h-xs items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 text-label',
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
              'size-1.5 rounded-full',
              pill.kind === 'connecting' ? 'bg-disabled' : DOT[pill.tone],
              pill.kind === 'verifying' && 'motion-safe:animate-pulse',
            )}
          />
        )}
        <span className="whitespace-nowrap">{pill.text}</span>
      </button>
    </Tooltip>
  );
}
