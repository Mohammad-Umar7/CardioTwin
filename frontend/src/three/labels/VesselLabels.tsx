import { useCallback } from 'react';
import { RiskMeter, RiskPip } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { labelEls, lineEls } from './labelRegistry';

const DEFAULT_VESSELS = ['LAD', 'LCX', 'RCA'];

function Label({ target }: { target: string }) {
  const prediction = usePatientStore((s) => s.prediction?.predictions[target]);
  const status = usePatientStore((s) => s.status);
  const selected = useViewerStore((s) => s.selectedStructure === target);
  const hovered = useViewerStore((s) => s.hoveredStructure === target);
  const dimmed = useViewerStore((s) => s.selectedStructure !== null && s.selectedStructure !== target);
  const p = prediction?.probability;
  const band = prediction ? bandStyle(prediction.risk_band) : null;
  const f = formatProbability(p);

  const register = useCallback(
    (el: HTMLButtonElement | null) => {
      if (el) labelEls.set(target, el);
      else labelEls.delete(target);
    },
    [target],
  );

  return (
    <button
      ref={register}
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={() => useViewerStore.getState().select(selected ? null : target)}
      onPointerEnter={() => useViewerStore.getState().hover(target)}
      onPointerLeave={() => useViewerStore.getState().hover(null)}
      style={{ opacity: 0 }}
      className={cn(
        'group pointer-events-auto absolute left-0 top-0 flex h-7 items-center gap-1.5 rounded-sm border bg-surface-3/[0.88] px-2 shadow-hud transition-[opacity,border-color] duration-fast will-change-transform',
        selected ? 'border-accent' : hovered ? 'border-line-strong' : 'border-line',
        dimmed && 'saturate-50',
      )}
    >
      <RiskPip p={status === 'error' && !prediction ? null : p} />
      <span className="eyebrow text-primary">{target}</span>
      <span className="font-numeral text-numeral-label text-primary">
        {f.qualifier}
        {f.value}
        {f.value !== '–' && <span className="pct-sign">%</span>}
      </span>
      {band && (
        <span className="flex items-center gap-1 group-data-[compact=true]:hidden">
          <RiskMeter level={band.level} />
          <span className="eyebrow text-secondary">{band.label}</span>
        </span>
      )}
      <span className="hidden text-label font-normal text-tertiary group-data-[posterior=true]:inline">(posterior)</span>
    </button>
  );
}

function Leader({ target }: { target: string }) {
  const register = useCallback(
    (el: SVGLineElement | null) => {
      if (el) lineEls.set(target, el);
      else lineEls.delete(target);
    },
    [target],
  );
  return <line ref={register} stroke="#EDF1F5" strokeWidth={1} style={{ opacity: 0 }} x1={0} y1={0} x2={0} y2={0} />;
}

/**
 * DOM half of the vessel labels (DESIGN_SYSTEM §7.6): pip, code, "72 %", band meter + word on
 * surface/3 at 88 %. Positions are written by <LabelProjector/> inside the canvas. Labels are decorative
 * duplicates for sighted users (aria-hidden); the accessible equivalent is the scene summary and the
 * vessel rows in the risk panel.
 */
export function VesselLabelsOverlay() {
  const schema = useSchemaIndex();
  const targets = schema?.vessels.map((t) => t.id) ?? DEFAULT_VESSELS;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-labels overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        {targets.map((t) => (
          <Leader key={t} target={t} />
        ))}
      </svg>
      {targets.map((t) => (
        <Label key={t} target={t} />
      ))}
    </div>
  );
}
