import { useSchemaIndex } from '@/hooks/useData';
import { formatProbability } from '@/lib/format';
import { bandStyle } from '@/lib/riskColor';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { RISK_PENDING, riskHex } from '@/theme/risk';
import { ANATOMY } from '@/theme/tokens';

/** Anterior schematic paths (viewBox 400×400, radiological: patient-left on viewer-right). */
const PATHS: Record<string, { d: string; label: [number, number]; anchor: 'start' | 'end' }> = {
  LAD: { d: 'M214 118 C 230 150, 238 200, 240 245 S 250 310, 262 330', label: [300, 190], anchor: 'start' },
  LCX: { d: 'M214 118 C 250 120, 285 140, 300 175 S 312 230, 305 262', label: [318, 262], anchor: 'start' },
  RCA: { d: 'M180 122 C 150 130, 128 160, 124 200 S 140 280, 190 318', label: [96, 200], anchor: 'end' },
};

/**
 * Tier D (DESIGN_SYSTEM §5 WebGLFallback): a 2D SVG anterior coronary schematic shown when WebGL2 is
 * missing or the context was lost twice. Same ramp, same labels, same hover / click / keyboard
 * selection as the 3D view, so no vessel action depends on WebGL.
 */
export function WebGLFallback() {
  const schema = useSchemaIndex();
  const predictions = usePatientStore((s) => s.prediction?.predictions);
  const selected = useViewerStore((s) => s.selectedStructure);
  const hovered = useViewerStore((s) => s.hoveredStructure);
  const vessels = (schema?.vessels.map((t) => t.id) ?? Object.keys(PATHS)).filter((t) => t in PATHS);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-void">
      <svg viewBox="0 0 400 400" className="h-full max-h-[560px] w-full max-w-[560px]" role="group" aria-label="Coronary schematic (2D fallback)">
        <defs>
          <radialGradient id="ct-fallback-bg" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor={ANATOMY.sceneBgCentre} />
            <stop offset="100%" stopColor={ANATOMY.sceneBgEdge} />
          </radialGradient>
        </defs>
        <rect width="400" height="400" fill="url(#ct-fallback-bg)" />
        {/* heart silhouette + great vessels (achromatic clay) */}
        <path d="M200 70 C 190 40, 230 30, 236 64 L 236 110 L 196 112 Z" fill={ANATOMY.greatVessel} opacity="0.9" />
        <path
          d="M170 120 C 120 120, 96 180, 110 240 C 124 300, 200 350, 262 342 C 300 336, 330 290, 322 230 C 314 170, 280 120, 230 112 C 210 110, 190 112, 170 120 Z"
          fill={ANATOMY.clay}
        />
        <path d="M196 112 C 204 114, 210 116, 214 118" stroke={ANATOMY.leftMain} strokeWidth="7" fill="none" strokeLinecap="round" />
        {vessels.map((t) => {
          const pred = predictions?.[t];
          const color = pred ? riskHex(pred.probability) : RISK_PENDING;
          const f = formatProbability(pred?.probability);
          const band = pred ? bandStyle(pred.risk_band).label : 'unavailable';
          const path = PATHS[t]!;
          const active = selected === t || hovered === t;
          const select = () => useViewerStore.getState().select(selected === t ? null : t);
          return (
            <g
              key={t}
              role="button"
              tabIndex={0}
              aria-pressed={selected === t}
              aria-label={`${t} ${f.spoken}, ${band}`}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select();
                }
              }}
              onPointerEnter={() => useViewerStore.getState().hover(t)}
              onPointerLeave={() => useViewerStore.getState().hover(null)}
              className="cursor-pointer outline-none focus-visible:[&>path]:stroke-[#56C2E6]"
              opacity={selected && selected !== t ? 0.55 : 1}
            >
              <path d={path.d} stroke="#07090C" strokeWidth={active ? 13 : 11} fill="none" strokeLinecap="round" />
              <path d={path.d} stroke={color} strokeWidth={active ? 9 : 7} fill="none" strokeLinecap="round" />
              <path d={path.d} stroke="transparent" strokeWidth={24} fill="none" />
              <text
                x={path.label[0]}
                y={path.label[1]}
                textAnchor={path.anchor}
                className="fill-[#EDF1F5] font-numeral text-[13px] font-semibold"
              >
                {t} {f.text}
              </text>
              <text
                x={path.label[0]}
                y={path.label[1] + 15}
                textAnchor={path.anchor}
                className="fill-[#A3ADBA] text-[10px] font-semibold uppercase tracking-[0.08em]"
              >
                {band}
              </text>
            </g>
          );
        })}
        <text x="200" y="385" textAnchor="middle" className="fill-[#8792A1] text-[10px]">
          2D schematic · 3D view unavailable on this device · LM not predicted
        </text>
      </svg>
    </div>
  );
}
