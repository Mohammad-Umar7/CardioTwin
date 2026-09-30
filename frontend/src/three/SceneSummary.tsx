import { useSchemaIndex } from '@/hooks/useData';
import { formatProbability } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import type { PredictResponse, RiskBandId } from '@/types/contracts';
import { nearestPeelStage, sceneSummaryText } from './labels/sceneSummaryText';

/**
 * Text equivalent of the 3D view for screen readers (DESIGN_SYSTEM §10.4), referenced by the canvas'
 * aria-describedby, in the V2 vocabulary (WORKSTATION_V2 §3.2): "LAD 65 percent, high probability,
 * flagged; LCX …; left main not predicted. Selected: LAD. Heart opened." Not a live region — the risk card
 * announces verdict flips on commit only.
 */
export function SceneSummary({ id }: { id: string }) {
  const schema = useSchemaIndex();
  const prediction: PredictResponse | null = usePatientStore(selectDisplayedPrediction);
  const status = usePatientStore((s) => s.status);
  const explode = useViewerStore((s) => s.explode);
  const selected = useViewerStore((s) => s.selectedStructure);
  const vessels = schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'];
  const text = sceneSummaryText({
    vessels,
    prediction,
    status,
    selected,
    peel: nearestPeelStage(explode),
    spoken: (p) => formatProbability(p).spoken,
    band: (id) => bandStyle(id as RiskBandId).label.toLowerCase(),
  });
  return (
    <p id={id} className="sr-only">
      {text}
    </p>
  );
}
