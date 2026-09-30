import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/routes';
import type { PipelinePhase } from '../content';

export interface PipelineDiagramProps {
  phases: PipelinePhase[];
  nTest: number | null;
  /** Jump to the section that explains a step (keeps the hash router's route intact). */
  onJump(anchor: string): void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * End-to-end pipeline as a "subway map": five phases on one horizontal rail, each with its numbered
 * steps on a vertical branch. Every step links to the section that explains it. A dashed lane under
 * the development phases shows the locked test split travelling untouched until the model is frozen.
 * Neutral ink only; the accent appears on hover and focus (it marks interaction, never data).
 */
export function PipelineDiagram({ phases, nTest, onJump }: PipelineDiagramProps) {
  const stepRange = (ids: string[]) => {
    const steps = phases.filter((p) => ids.includes(p.id)).flatMap((p) => p.steps);
    return steps.length ? `${pad(steps[0]!.n)}–${pad(steps.at(-1)!.n)}` : '';
  };
  return (
    <figure className="flex flex-col gap-3" aria-labelledby="pipeline-caption">
      <ol className="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-[1.15fr_1.25fr_1fr_0.95fr_0.8fr] min-[1100px]:gap-0">
        {phases.map((phase, i) => {
          const last = i === phases.length - 1;
          return (
            <li key={phase.id} className="relative flex min-w-0 flex-col">
              {/* Phase header on the horizontal rail */}
              <div className="relative flex h-10 items-center gap-2 pr-6">
                <span
                  aria-hidden
                  className="relative z-[1] size-2.5 shrink-0 rounded-full border-2 border-secondary bg-panel"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="eyebrow truncate text-secondary">{phase.label}</span>
                </span>
                {!last && (
                  <span
                    aria-hidden
                    className="absolute left-4 right-2 top-1/2 hidden h-px bg-line-strong min-[1100px]:block"
                  >
                    <span className="absolute -right-px -top-[3px] size-[7px] rotate-45 border-r border-t border-line-strong" />
                  </span>
                )}
              </div>
              <p className="-mt-1 mb-1 h-4 pl-[18px] text-label font-normal text-tertiary">
                {phase.note ?? ''}
              </p>
              {/* Vertical branch with the numbered steps */}
              <ol className="relative ml-[4.5px] flex flex-col gap-1 border-l border-line pb-1 pl-3 min-[1100px]:mr-4">
                {phase.steps.map((s) => (
                  <li key={s.n} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[15.5px] top-[13px] size-[6px] rounded-full bg-tertiary"
                    />
                    <a
                      href={`#${ROUTES.methodology}#${s.anchor}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onJump(s.anchor);
                      }}
                      className={cn(
                        'group flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 outline-none transition-colors duration-fast',
                        'hover:bg-surface-1 focus-visible:shadow-focus',
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-mono-s text-tertiary group-hover:text-accent">
                          {pad(s.n)}
                        </span>
                        <span className="text-body-s font-semibold text-primary">{s.title}</span>
                      </span>
                      <span className="pl-[26px] text-label font-normal text-tertiary text-pretty">
                        {s.detail}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
      {/* The locked test split rides underneath the development phases, untouched. */}
      <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1.15fr_1.25fr_1fr_0.95fr_0.8fr]">
        <div aria-hidden className="relative hidden min-[1100px]:block">
          <span className="absolute left-[4.5px] top-0 h-1/2 border-l border-dashed border-line-strong" />
          <span className="absolute left-[4.5px] right-0 top-1/2 border-t border-dashed border-line-strong" />
        </div>
        <div className="col-span-1 flex items-center gap-3 rounded-md border border-dashed border-line-strong px-3 py-2.5 min-[1100px]:col-span-2">
          <Lock aria-hidden className="size-4 shrink-0 stroke-[1.5] text-secondary" />
          <p className="text-label font-normal text-secondary text-pretty">
            <span className="font-semibold text-primary">
              Locked test split{nTest !== null ? ` · ${nTest} patients` : ''}.
            </span>{' '}
            Untouched while steps {stepRange(['develop', 'explain'])} are made, then scored with the frozen
            model; one re-score after a calibration fix is disclosed.
          </p>
        </div>
        <div className="relative hidden items-center gap-2 pl-0 min-[1100px]:flex">
          <span aria-hidden className="h-px w-6 shrink-0 border-t border-dashed border-line-strong" />
          <Link
            to={ROUTES.performance}
            className="whitespace-nowrap rounded-xs text-label font-medium text-accent hover:text-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
          >
            Test results ›
          </Link>
        </div>
      </div>
      <figcaption id="pipeline-caption" className="text-label font-normal text-tertiary">
        From the clinical record to the heart on screen. Select a step to read how it works.
      </figcaption>
    </figure>
  );
}
