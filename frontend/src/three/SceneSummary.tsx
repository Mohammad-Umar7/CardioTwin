import { useSchemaIndex } from '@/hooks/useData';
import { formatProbability } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';

/**
 * Text equivalent of the 3D view for screen readers (DESIGN_SYSTEM §10.4), referenced by the canvas'
 * aria-describedby: "LAD 72 percent, high; LCX 38 percent, moderate; RCA 61 percent, high; left main
 * not predicted." Not a live region — announcements are made by the risk panel on commit only.
 */
export function SceneSummary({ id }: { id: string }) {
  const schema = useSchemaIndex();
  const prediction = usePatientStore((s) => s.prediction);
  const status = usePatientStore((s) => s.status);
  const explode = useViewerStore((s) => s.explode);
  const vessels = schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'];

  let text: string;
  if (!prediction) {
    text = status === 'error' ? 'Vessel estimates are unavailable.' : 'Vessel estimates are loading.';
  } else {
    const parts = vessels.map((t) => {
      const p = prediction.predictions[t];
      if (!p) return `${t} unavailable`;
      return `${t} ${formatProbability(p.probability).spoken}, ${bandStyle(p.risk_band).label.toLowerCase()}`;
    });
    text = `${parts.join('; ')}; left main not predicted.`;
  }
  const peel = explode >= 0.95 ? ' Heart opened.' : explode >= 0.55 ? ' Lungs aside.' : explode >= 0.4 ? ' Ribs open.' : '';

  return (
    <p id={id} className="sr-only">
      {text}
      {peel}
    </p>
  );
}
