import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import { UI } from '@/theme/tokens';

/**
 * "How SHAP adds up", schematic (no data): the cohort baseline plus signed contributions lands
 * exactly on this patient's log-odds, which the Platt map turns into the displayed probability.
 * Sized for the 280 px margin column.
 */
export function ShapAdditivity() {
  const rows = [
    { label: 'Cohort baseline', from: 0, to: 0.34, kind: 'base' as const },
    { label: 'Typical angina', from: 0.34, to: 0.62, kind: 'up' as const },
    { label: 'Age', from: 0.62, to: 0.74, kind: 'up' as const },
    { label: 'Normal wall motion', from: 0.74, to: 0.6, kind: 'down' as const },
    { label: 'This patient', from: 0, to: 0.6, kind: 'out' as const },
  ];
  const W = 280;
  const L = 112;
  const plot = W - L - 8;
  const RH = 20;
  const x = (t: number) => L + t * plot;
  const H = rows.length * RH + 34;
  return (
    <figure className="flex flex-col gap-2" aria-labelledby="shap-caption">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Schematic SHAP waterfall: baseline plus contributions equals the patient's log-odds">
        {rows.map((r, i) => {
          const y = i * RH + 4;
          const x0 = x(Math.min(r.from, r.to));
          const w = Math.abs(x(r.to) - x(r.from));
          const fill = r.kind === 'up' ? SHAP_RAISES : r.kind === 'down' ? SHAP_LOWERS : r.kind === 'out' ? UI.textPrimary : 'rgba(255,255,255,0.28)';
          return (
            <g key={r.label}>
              <text x={0} y={y + 11} fontSize={12} fill={r.kind === 'out' ? UI.textPrimary : UI.textSecondary} fontWeight={r.kind === 'out' ? 600 : 400}>
                {r.label}
              </text>
              <rect x={x0} y={y + 2} width={Math.max(2, w)} height={r.kind === 'out' ? 10 : 8} rx={2} fill={fill} opacity={r.kind === 'out' ? 0.9 : 1} />
              {i > 0 && i < rows.length - 1 && (
                <line x1={x(r.from)} x2={x(r.from)} y1={y - 8} y2={y + 2} stroke={UI.textTertiary} strokeDasharray="2 2" />
              )}
            </g>
          );
        })}
        <line x1={x(0.6)} x2={x(0.6)} y1={(rows.length - 2) * RH + 14} y2={(rows.length - 1) * RH + 6} stroke={UI.textTertiary} strokeDasharray="2 2" />
        <line x1={L} x2={L + plot} y1={rows.length * RH + 8} y2={rows.length * RH + 8} stroke={UI.borderStrong} />
        <text x={L} y={rows.length * RH + 24} fontSize={12} fill={UI.textTertiary}>
          log-odds → Platt → probability
        </text>
      </svg>
      <figcaption id="shap-caption" className="text-label font-normal text-tertiary text-pretty">
        Schematic. Contributions start at the cohort baseline and add up exactly to the patient&apos;s log-odds; the Platt map then gives the
        probability on screen.
      </figcaption>
    </figure>
  );
}
