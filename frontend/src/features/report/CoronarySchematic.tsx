import { useId } from 'react';
import { RISK_PENDING, riskHex } from '@/theme/risk';

/**
 * Print-ready anterior coronary schematic (vector, so it stays crisp in the PDF). Radiological
 * convention like the 3D view: the patient's left is on the viewer's right. Each predicted artery is
 * drawn in ONE colour from root to tip — its predicted probability on the Ember ramp — because the model
 * estimates risk per vessel and never localises a lesion. The left main is achromatic ("not predicted").
 *
 * Labels carry the vessel code only: each colour mark's percentage and verdict word live in the linked
 * row of the results table beside the figure (one home per number, WORKSTATION_V2 §2 on §10.2).
 */

export interface SchematicVessel {
  id: string;
  /** Probability, or null while updating / unavailable (drawn in the achromatic pending colour). */
  p: number | null;
  flagged: boolean | null;
}

interface VesselArt {
  /** Main trunk. */
  trunk: string;
  /** Side branches (diagonals, marginals, PDA). */
  branches: string[];
  /** Leader from a point on the vessel to the label, and the label's text anchor. */
  label: { from: [number, number]; to: [number, number]; anchor: 'start' | 'end' };
}

const ART: Record<string, VesselArt> = {
  LAD: {
    trunk: 'M140 108 C 150 130, 158 150, 169 174 S 196 220, 219 236',
    branches: ['M156 140 C 170 146, 184 150, 199 150', 'M170 178 C 182 186, 194 190, 209 190'],
    label: { from: [211, 231], to: [230, 258], anchor: 'start' },
  },
  LCX: {
    trunk: 'M140 108 C 160 102, 184 106, 201 118 S 225 145, 231 168',
    branches: ['M212 128 C 218 146, 218 164, 212 184'],
    label: { from: [206, 121], to: [236, 100], anchor: 'start' },
  },
  RCA: {
    trunk: 'M112 102 C 96 108, 80 124, 74 148 S 76 196, 100 220 C 112 230, 126 236, 142 240',
    branches: ['M76 176 C 91 181, 103 189, 113 203', 'M142 240 C 156 244, 170 246, 184 246'],
    label: { from: [74, 152], to: [52, 152], anchor: 'end' },
  },
};

const LEFT_MAIN = 'M124 100 C 130 103, 135 105, 140 108';

/** Achromatic anatomy on paper (never risk colours). */
const PAPER = {
  heartHi: '#F3EFEC',
  heartLo: '#DDD5CF',
  heartEdge: '#BDB3AB',
  vessel: '#D8D1CB',
  vesselEdge: '#B7ADA5',
  leftMain: '#8A7D76',
  casing: '#0B0E12',
  ink: '#0B0E12',
  ink3: '#58626F',
};

export function CoronarySchematic({ vessels, className }: { vessels: SchematicVessel[]; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const byId = new Map(vessels.map((v) => [v.id, v]));
  const described = vessels
    .filter((v) => v.id in ART)
    .map((v) => `${v.id} ${v.flagged === null ? 'updating' : v.flagged ? 'flagged' : 'not flagged'}`)
    .join(', ');

  return (
    <svg
      viewBox="0 0 280 290"
      className={className}
      role="img"
      aria-label={`Anterior coronary schematic coloured by predicted probability: ${described}. Left main not predicted.`}
    >
      <defs>
        <radialGradient id={`${gid}-heart`} cx="38%" cy="36%" r="72%">
          <stop offset="0%" stopColor={PAPER.heartHi} />
          <stop offset="100%" stopColor={PAPER.heartLo} />
        </radialGradient>
      </defs>

      {/* great vessels (behind the heart): arch with its three branches, SVC, pulmonary trunk in front */}
      <g fill="none" strokeLinecap="round">
        {['M130 32 L 125 12', 'M145 26 L 145 8', 'M159 28 L 164 11'].map((d) => (
          <g key={d}>
            <path d={d} stroke={PAPER.vesselEdge} strokeWidth="8" />
            <path d={d} stroke={PAPER.vessel} strokeWidth="6.5" />
          </g>
        ))}
        <path d="M120 100 C 115 76, 112 54, 120 40 C 130 22, 162 20, 174 34 L 182 58" stroke={PAPER.vesselEdge} strokeWidth="21" />
        <path d="M120 100 C 115 76, 112 54, 120 40 C 130 22, 162 20, 174 34 L 182 58" stroke={PAPER.vessel} strokeWidth="19" />
        <path d="M88 48 L 88 94" stroke={PAPER.vesselEdge} strokeWidth="15" />
        <path d="M88 48 L 88 94" stroke={PAPER.vessel} strokeWidth="13.5" />
        <path d="M151 104 C 151 86, 157 72, 169 64 C 183 57, 197 59, 208 66" stroke={PAPER.vesselEdge} strokeWidth="18" />
        <path d="M151 104 C 151 86, 157 72, 169 64 C 183 57, 197 59, 208 66" stroke={PAPER.vessel} strokeWidth="16.5" />
      </g>

      {/* heart silhouette: right atrium, right ventricle, apex (left ventricle), left border */}
      <path
        d="M96 90 C 70 96, 58 124, 60 156 C 62 190, 84 222, 124 236 C 160 248, 204 252, 222 240 C 240 228, 240 200, 230 172 C 220 142, 206 116, 188 104 C 172 94, 150 92, 132 94 C 118 92, 106 88, 96 90 Z"
        fill={`url(#${gid}-heart)`}
        stroke={PAPER.heartEdge}
        strokeWidth="1"
      />
      {/* left atrial appendage hint */}
      <path d="M190 104 C 204 100, 214 106, 216 116 C 208 116, 200 114, 194 112" fill={PAPER.heartLo} stroke={PAPER.heartEdge} strokeWidth="1" />

      {/* left main: not predicted (achromatic) */}
      <path d={LEFT_MAIN} fill="none" stroke={PAPER.casing} strokeWidth="8.5" strokeLinecap="round" />
      <path d={LEFT_MAIN} fill="none" stroke={PAPER.leftMain} strokeWidth="6" strokeLinecap="round" />

      {(['RCA', 'LCX', 'LAD'] as const).map((id) => {
        const art = ART[id]!;
        const v = byId.get(id);
        const color = v && v.p !== null ? riskHex(v.p) : RISK_PENDING;
        return (
          <g key={id} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {art.branches.map((d) => (
              <path key={`c${d}`} d={d} stroke={PAPER.casing} strokeWidth="5.5" />
            ))}
            <path d={art.trunk} stroke={PAPER.casing} strokeWidth="8.5" />
            {art.branches.map((d) => (
              <path key={`f${d}`} d={d} stroke={color} strokeWidth="3.5" />
            ))}
            <path d={art.trunk} stroke={color} strokeWidth="6" />
          </g>
        );
      })}

      {/* labels: vessel code only — the probability and verdict live in the linked table row */}
      {(['RCA', 'LCX', 'LAD'] as const).map((id) => {
        const { from, to, anchor } = ART[id]!.label;
        const tx = anchor === 'start' ? to[0] + 3 : to[0] - 3;
        return (
          <g key={`label-${id}`}>
            <path d={`M${from[0]} ${from[1]} L ${to[0]} ${to[1]}`} stroke={PAPER.ink3} strokeWidth="1" fill="none" />
            <circle cx={from[0]} cy={from[1]} r="2.2" fill={PAPER.ink} stroke="#fff" strokeWidth="0.8" />
            <text x={tx} y={to[1] + 5.5} textAnchor={anchor} fill={PAPER.ink} fontSize="16" fontWeight="700" fontFamily="var(--font-ui)">
              {id}
            </text>
          </g>
        );
      })}
      <text x="117" y="89" textAnchor="end" fill={PAPER.ink3} fontSize="14.5" fontFamily="var(--font-ui)">
        LM
      </text>
    </svg>
  );
}
