import { ArrowRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { UI } from '@/theme/tokens';
import type { KeyFacts } from '../content';

/** Deterministic "random" fold order so the glyph looks shuffled but never changes between renders. */
const heldOutFold = (repeat: number, folds: number) => (repeat * 3 + (repeat % 3)) % folds;

function OuterLoopGlyph({ folds, repeats }: { folds: number; repeats: number }) {
  const cw = 12;
  const ch = 5;
  const gap = 2;
  const w = folds * cw + (folds - 1) * gap;
  const h = repeats * ch + (repeats - 1) * gap;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      {Array.from({ length: repeats }, (_, r) =>
        Array.from({ length: folds }, (_, f) => {
          const held = f === heldOutFold(r, folds);
          return (
            <rect
              key={`${r}-${f}`}
              x={f * (cw + gap)}
              y={r * (ch + gap)}
              width={cw}
              height={ch}
              rx={1}
              fill={held ? UI.textPrimary : 'rgba(255,255,255,0.14)'}
            />
          );
        }),
      )}
    </svg>
  );
}

function InnerLoopGlyph({ folds }: { folds: number }) {
  const cw = 12;
  const gap = 2;
  const w = folds * cw + (folds - 1) * gap;
  return (
    <svg width={w} height={33} viewBox={`0 0 ${w} 33`} aria-hidden className="shrink-0">
      {Array.from({ length: folds }, (_, r) =>
        Array.from({ length: folds }, (_, f) => (
          <rect
            key={`${r}-${f}`}
            x={f * (cw + gap)}
            y={r * 7}
            width={cw}
            height={5}
            rx={1}
            fill={f === r ? UI.textSecondary : 'rgba(255,255,255,0.1)'}
          />
        )),
      )}
    </svg>
  );
}

/** Schematic re-splits: each bar is one random 80/20 split, the solid segment its test part. */
function ResplitGlyph({ count = 14, share = 0.2 }: { count?: number; share?: number }) {
  const w = 120;
  const bh = 3;
  const gap = 2;
  const h = count * bh + (count - 1) * gap;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      {Array.from({ length: count }, (_, i) => {
        const start = ((i * 37) % 100) / 100;
        const x0 = start * (1 - share) * w;
        return (
          <g key={i}>
            <rect x={0} y={i * (bh + gap)} width={w} height={bh} rx={1} fill="rgba(255,255,255,0.12)" />
            <rect x={x0} y={i * (bh + gap)} width={share * w} height={bh} rx={1} fill={UI.textSecondary} />
          </g>
        );
      })}
    </svg>
  );
}

function Step({ glyph, title, children }: { glyph?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex h-[68px] items-end">{glyph}</div>
      <p className="text-body-s font-semibold text-primary">{title}</p>
      <p className="text-label font-normal text-tertiary text-pretty">{children}</p>
    </div>
  );
}

const Arrow = () => (
  <ArrowRight aria-hidden className="mt-[60px] size-4 shrink-0 stroke-[1.5] text-tertiary" />
);

/**
 * The validation protocol at a glance: the locked split drawn to scale, the nested repeated
 * cross-validation that happens inside the development part, the one-time test scoring, and the
 * Monte-Carlo re-splits that measure how much a single test split can move.
 */
export function ValidationDiagram({ facts }: { facts: KeyFacts }) {
  const nDev = facts.nDev ?? 4;
  const nTest = facts.nTest ?? 1;
  const folds = facts.cvSplits ?? 5;
  const repeats = facts.cvRepeats ?? 10;
  const cols = { gridTemplateColumns: `minmax(0, ${nDev}fr) minmax(128px, ${nTest}fr)` };
  const testShare = nTest / (nDev + nTest);
  return (
    <figure
      data-reveal className="card-surface flex flex-col gap-4 p-4"
      aria-labelledby="validation-caption"
    >
      <div className="grid gap-x-2 gap-y-1" style={cols}>
        <span className="text-label font-normal text-secondary">
          Development · <span className="num text-primary">{facts.nDev ?? '–'}</span> patients
        </span>
        <span className="text-label font-normal text-secondary">
          Test · <span className="num text-primary">{facts.nTest ?? '–'}</span>
        </span>
        <div className="h-3 rounded-sm bg-[rgba(255,255,255,0.14)]" aria-hidden />
        <div
          className="hatch flex h-3 items-center justify-end rounded-sm border border-line-strong pr-1"
          aria-hidden
        />
        <div className="flex items-start gap-3 pt-3">
          <Step glyph={<OuterLoopGlyph folds={folds} repeats={repeats} />} title="Outer loop">
            {folds} folds × {repeats} repeats. Every model is scored on the fold it never saw, on identical
            folds for a paired comparison.
          </Step>
          <Arrow />
          <Step glyph={<InnerLoopGlyph folds={folds} />} title="Inner loop">
            Hyper-parameters searched by log-loss inside each training part only.
          </Step>
          <Arrow />
          <Step title="Out-of-fold choices">
            Ensemble weight, Platt calibration and threshold, fitted on predictions for patients each model
            never saw.
          </Step>
        </div>
        <div className="relative flex flex-col gap-2 pt-3">
          <span
            aria-hidden
            className="absolute -top-1 left-1/2 h-4 border-l border-dashed border-line-strong"
          />
          <div className="flex h-[68px] items-end justify-center">
            <span className="inline-flex size-8 items-center justify-center rounded-full border border-dashed border-line-strong">
              <Lock className="size-4 stroke-[1.5] text-secondary" aria-hidden />
            </span>
          </div>
          <p className="text-body-s font-semibold text-primary">Scored when frozen</p>
          <p className="text-label font-normal text-tertiary text-pretty">
            With the frozen model; one disclosed re-score.
            {facts.nBootstrap
              ? ` ${facts.nBootstrap.toLocaleString('en-US')} bootstrap resamples give the 95 % intervals.`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-hairline pt-4">
        <ResplitGlyph share={testShare} />
        <p className="text-label font-normal text-tertiary text-pretty">
          <span className="font-semibold text-primary">Then, for robustness:</span> the whole recipe is re-run
          on {facts.nResplits ? `${facts.nResplits} ` : ''}random {Math.round((1 - testShare) * 100)}/
          {Math.round(testShare * 100)} splits of all patients and scored once on each, to see how far a
          single test split can move and where the published one falls.
        </p>
      </div>
      <figcaption id="validation-caption" className="sr-only">
        Validation protocol: a locked test split, nested repeated cross-validation on the development set,
        out-of-fold calibration and threshold, scoring of the test split with the frozen model (one disclosed re-score), and Monte-Carlo re-splits
        for robustness.
      </figcaption>
    </figure>
  );
}
