/**
 * Risk marks on paper. Same rules as design/risk/RiskMarks (colour only on marks, never on text; every
 * colour mark sits next to its numeral and a word), restyled for a white page: each Ember mark carries
 * an ink ring so the light end of the ramp keeps ≥ 3:1 contrast against white.
 */
import { formatProbability, THIN_SPACE } from '@/lib/format';
import { RISK_BAND_STYLES, RISK_PENDING, SHAP_LOWERS, SHAP_RAISES, riskGradientCss, riskHex, type RiskBandId } from '@/theme/risk';

/** "72 %" with the % sign at 0.6 em; exact p in the title. `text` overrides the digits (1-decimal case). */
export function PaperProbability({
  p,
  text,
  className,
  target,
}: {
  p: number;
  text?: string;
  className?: string;
  /** Adds `data-prob` (WORKSTATION_V2 §9.2 probability contract). */
  target?: string;
}) {
  const f = formatProbability(p);
  const digits = (text ?? f.text).replace(`${THIN_SPACE}%`, '');
  return (
    <span className={`rp-numeral ${className ?? ''}`} title={f.exact} data-prob={target}>
      <span className="sr-only">{f.spoken}</span>
      <span aria-hidden>
        {digits}
        <span className="rp-pct">%</span>
      </span>
    </span>
  );
}

export function Pip({ p, className }: { p: number | null; className?: string }) {
  return (
    <span aria-hidden className={`rp-pip ${className ?? ''}`} style={{ backgroundColor: p === null ? RISK_PENDING : riskHex(p) }} />
  );
}

/** Band word with a 3 px rule in the band colour (V2: no meter). */
export function BandTag({ band }: { band: RiskBandId }) {
  const s = RISK_BAND_STYLES[band];
  return (
    <span className="rp-band" style={{ ['--band' as string]: s.chip }}>
      {s.label}
    </span>
  );
}

/** ● Flagged / ○ Not flagged (ink glyphs; the verdict never uses risk colour). */
export function Verdict({ flagged, text }: { flagged: boolean; text?: string }) {
  return (
    <span className={`rp-verdict ${flagged ? '' : 'rp-verdict--no'}`}>
      <span aria-hidden className={`rp-verdict__glyph ${flagged ? 'rp-verdict__glyph--on' : ''}`} />
      {text ?? (flagged ? 'Flagged' : 'Not flagged')}
    </span>
  );
}

/** Track 0–100 % with band ticks, the decision-threshold tick and the value marker. */
export function PaperTrack({
  p,
  threshold,
  scale = false,
  thresholdText,
}: {
  p: number;
  threshold: number;
  scale?: boolean;
  thresholdText?: string;
}) {
  const x = Math.min(1, Math.max(0, p)) * 100;
  const t = Math.min(1, Math.max(0, threshold)) * 100;
  return (
    <div aria-hidden>
      <div className="rp-track">
        <div className="rp-track__line" />
        {[25, 50, 75].map((tick) => (
          <div key={tick} className="rp-track__tick" style={{ left: `${tick}%` }} />
        ))}
        <div className="rp-track__thr" style={{ left: `${t}%` }} />
        <div className="rp-track__dot" style={{ left: `${x}%`, backgroundColor: riskHex(p) }} />
      </div>
      {!scale && thresholdText && (
        <div className="rp-track__scale">
          <span className="rp-thr-label rp-thr-label--quiet" style={{ left: `${Math.min(80, Math.max(20, t))}%` }}>
            {thresholdText}
          </span>
        </div>
      )}
      {scale && (
        <div className="rp-track__scale">
          <span style={{ left: 0 }}>0</span>
          {[25, 50, 75]
            .filter((tick) => Math.abs(tick - t) > 9)
            .map((tick) => (
              <span key={tick} style={{ left: `${tick}%` }}>
                {tick}
              </span>
            ))}
          {Math.abs(100 - t) > 12 && (
            <span className="rp-end" style={{ left: '100%' }}>
              100{THIN_SPACE}%
            </span>
          )}
          {thresholdText && (
            <span className="rp-thr-label" style={{ left: `${Math.min(88, Math.max(12, t))}%` }}>
              threshold {thresholdText}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Diverging bar for one SHAP contribution; `value / max` sets the half-width fraction. */
export function DivergingBar({ value, max }: { value: number; max: number }) {
  const frac = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const width = `${Math.max(frac * 50, frac > 0 ? 1.5 : 0)}%`;
  const raises = value >= 0;
  return (
    <div className="rp-dbar" aria-hidden>
      <div
        className="rp-dbar__fill"
        style={{
          width,
          left: raises ? '50%' : undefined,
          right: raises ? undefined : '50%',
          backgroundColor: raises ? SHAP_RAISES : SHAP_LOWERS,
        }}
      />
    </div>
  );
}

/** Ember scale 0–100 % with band ticks (legend for the schematic). */
export function RampLegend({ width = 160 }: { width?: number }) {
  return (
    <div
      role="img"
      aria-label="Colour scale: predicted probability from 0 to 100 percent, bands at 25, 50 and 75 percent"
      style={{ width }}
    >
      <div
        style={{
          position: 'relative',
          height: 8,
          borderRadius: 2,
          backgroundImage: riskGradientCss(),
          boxShadow: 'inset 0 0 0 1px rgba(11,14,18,.35)',
        }}
      >
        {[25, 50, 75].map((t) => (
          <span key={t} style={{ position: 'absolute', top: 0, bottom: 0, left: `${t}%`, width: 1, background: 'rgba(255,255,255,.85)' }} />
        ))}
      </div>
      <div className="rp-num rp-ink-3" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, lineHeight: '14px', marginTop: 2 }}>
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100{THIN_SPACE}%</span>
      </div>
    </div>
  );
}
