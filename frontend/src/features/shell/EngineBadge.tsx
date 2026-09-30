import { Tooltip } from '@/design';
import { cn } from '@/lib/cn';
import { useEngineStore } from '@/state/engineStore';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

type PillState = { dot: string; text: string; tone: 'accent' | 'success' | 'neutral' | 'danger' };

/**
 * EnginePill (DESIGN_SYSTEM §5): which engine produced the numbers on screen, with provenance in the
 * tooltip (model version, predictor, latency, render tier, fps).
 *   Server ✓ · Edge 3 ms · Edge only · server offline · Connecting… · Error
 * Phase 2 adds `Verifying` / `Engines disagree` once the edge engine runs alongside the server.
 */
export function EngineBadge({ className }: { className?: string }) {
  const engineStatus = usePatientStore((s) => s.engineStatus);
  const description = usePatientStore((s) => s.engineDescription);
  const latency = usePatientStore((s) => s.latencyMs);
  const predictionStatus = usePatientStore((s) => s.status);
  const modelVersion = usePatientStore((s) => s.prediction?.model_version ?? null);
  const health = useEngineStore((s) => s.health);
  const tier = useViewerStore((s) => s.tier);
  const fps = useViewerStore((s) => s.fps);

  let pill: PillState;
  if (engineStatus === 'resolving') pill = { dot: 'bg-disabled', text: 'Connecting…', tone: 'neutral' };
  else if (predictionStatus === 'error' && engineStatus !== 'unavailable')
    pill = { dot: 'bg-danger', text: 'Error', tone: 'danger' };
  else if (engineStatus === 'server') pill = { dot: 'bg-success', text: 'Server ✓', tone: 'success' };
  else if (engineStatus === 'edge')
    pill = { dot: 'bg-accent', text: latency !== null ? `Edge ${Math.max(1, Math.round(latency))} ms` : 'Edge', tone: 'accent' };
  else pill = { dot: 'bg-secondary', text: 'Server offline', tone: 'neutral' };

  const details = (
    <div className="flex flex-col gap-1">
      <div className="font-semibold">{description}</div>
      {(modelVersion ?? health?.model_version) && (
        <div className="text-secondary">
          Model <span className="mono">v{modelVersion ?? health?.model_version}</span>
          {health?.predictor === 'fake' && ' · synthetic development predictor, not the trained model'}
        </div>
      )}
      {latency !== null && <div className="text-secondary">Last estimate in {Math.round(latency)} ms</div>}
      {engineStatus === 'unavailable' && (
        <div className="text-secondary">No estimate can be computed until the server is reachable.</div>
      )}
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
        aria-label={`Prediction engine: ${pill.text}`}
        className={cn(
          'inline-flex h-xs items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 text-label',
          pill.tone === 'danger' ? 'text-danger' : 'text-secondary',
          className,
        )}
      >
        <span aria-hidden className={cn('size-1.5 rounded-full', pill.dot)} />
        <span className="whitespace-nowrap">{pill.text}</span>
      </button>
    </Tooltip>
  );
}
