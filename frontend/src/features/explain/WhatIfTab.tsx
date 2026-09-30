import { RotateCcw } from 'lucide-react';
import { Button, IconButton, Probability, Skeleton, Tooltip } from '@/design';
import { useRiskView } from '@/features/risk/useRiskView';
import { useSchemaIndex } from '@/hooks/useData';
import { ASSOCIATION_LEGEND, ASSOCIATION_MARK, ASSOCIATION_NOTE, isAssociationOnly } from '@/lib/associations';
import { cn } from '@/lib/cn';
import { formatDeltaPts, formatFeatureValue, formatProbability } from '@/lib/format';
import { editedKeys, usePatientStore } from '@/state/patientStore';
import { riskGradientCss, riskHex } from '@/theme/risk';
import type { FeatureValue, TargetId } from '@/types/contracts';
import { useLevers } from './useLevers';

/** Recorded vs what-if bar pair for one target (ACC "now vs after"). */
function CompareRow({ target, recorded, current, edited }: { target: TargetId; recorded?: number; current?: number; edited: boolean }) {
  const d = typeof recorded === 'number' && typeof current === 'number' ? formatDeltaPts(current - recorded) : null;
  const bar = (p: number | undefined, tone: 'recorded' | 'current') => (
    <span className="relative block h-1.5 w-full overflow-clip rounded-full bg-line">
      {typeof p === 'number' && (
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-data ease-data"
          style={{ width: `${Math.max(1, p * 100)}%`, backgroundColor: tone === 'current' ? riskHex(p) : 'rgb(var(--c-text-disabled))' }}
        />
      )}
    </span>
  );
  return (
    <li className="grid h-10 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3">
      <span className="text-body-s font-semibold text-primary">{target}</span>
      <span className="flex flex-col gap-1" aria-hidden>
        {edited && bar(recorded, 'recorded')}
        {bar(current, 'current')}
      </span>
      <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        {edited && typeof recorded === 'number' && (
          <>
            <span className="num text-label font-normal text-tertiary" data-baseline={target} title={formatProbability(recorded).exact}>
              {formatProbability(recorded).text}
            </span>
            <span aria-hidden className="text-label text-tertiary">
              →
            </span>
          </>
        )}
        <Probability p={current} target={target} size="m" className="w-10 text-right font-semibold [&_.pct-sign]:text-[1em]" />
        {edited && (
          <span className="num w-14 text-right text-label font-normal text-secondary">
            {d && d.direction !== 'none' ? `${d.glyph} ${d.text}` : 'no change'}
          </span>
        )}
      </span>
    </li>
  );
}

function valueText(key: string, value: FeatureValue | undefined, specOf: (k: string) => Parameters<typeof formatFeatureValue>[0] | undefined) {
  const spec = specOf(key);
  return spec ? formatFeatureValue(spec, value as never) : String(value ?? '–');
}

/**
 * Explain › What-if (§5.10): the recorded estimate beside the what-if one for every target, the inputs you
 * changed, and the biggest levers — model counterfactuals for the current target, scored in the browser in
 * one batch, each with Apply.
 */
export function WhatIfTab({ target }: { target: TargetId }) {
  const index = useSchemaIndex();
  const view = useRiskView();
  const features = usePatientStore((s) => s.features);
  const recordedInputs = usePatientStore((s) => s.recorded);
  const edited = editedKeys(features, recordedInputs);
  const levers = useLevers(target);
  const specOf = (k: string) => index?.byKey.get(k);
  const targets = index?.targets.map((t) => t.id) ?? ['CAD', 'LAD', 'LCX', 'RCA'];
  const recorded = view.edits > 0 ? view.baseline ?? view.recorded : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="whatif-compare">
        <div className="flex h-7 items-end justify-between border-b border-hairline pb-1">
          <h3 id="whatif-compare" className="eyebrow text-secondary">
            {view.edits > 0 ? 'Recorded vs what-if' : 'Estimates for the recorded inputs'}
          </h3>
          {view.edits > 0 && (
            <span className="flex items-center gap-3 text-label font-normal text-tertiary" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full bg-disabled" /> recorded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full" style={{ backgroundImage: riskGradientCss() }} /> what-if
              </span>
            </span>
          )}
        </div>
        <ul className={cn('mt-1 flex flex-col', view.stale && 'opacity-50')}>
          {targets.map((t) => (
            <CompareRow
              key={t}
              target={t}
              recorded={recorded?.predictions[t]?.probability}
              current={view.prediction?.predictions[t]?.probability}
              edited={view.edits > 0 && !!recorded}
            />
          ))}
        </ul>
      </section>

      {edited.length > 0 && (
        <section aria-labelledby="whatif-changes">
          <div className="flex h-7 items-end justify-between border-b border-hairline pb-1">
            <h3 id="whatif-changes" className="eyebrow text-secondary">
              Your changes <span className="ml-1 text-tertiary">{edited.length}</span>
            </h3>
            <Button variant="ghost" size="sm" className="-mr-2 h-6" onClick={() => usePatientStore.getState().resetAll()}>
              Reset all
            </Button>
          </div>
          <ul className="mt-1 flex flex-col">
            {edited.map((k) => (
              <li key={k} className="grid h-8 grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-2 pl-1">
                <span className="truncate text-body-s text-secondary">
                  {specOf(k)?.label ?? k}
                  {isAssociationOnly(k) && <span className="ml-0.5 text-tertiary">{ASSOCIATION_MARK}</span>}
                </span>
                <span className="num whitespace-nowrap text-body-s">
                  <span className="text-tertiary">{valueText(k, recordedInputs[k], specOf)}</span>
                  <span aria-hidden className="mx-1.5 text-tertiary">
                    →
                  </span>
                  <span className="font-medium text-primary">{valueText(k, features[k], specOf)}</span>
                </span>
                <IconButton
                  label={`Reset ${specOf(k)?.label ?? k} to the recorded value`}
                  icon={<RotateCcw />}
                  size="sm"
                  onClick={() => usePatientStore.getState().resetFeature(k)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="whatif-levers" aria-describedby="whatif-levers-note">
        <div className="flex h-7 items-end justify-between border-b border-hairline pb-1">
          <h3 id="whatif-levers" className="eyebrow text-secondary">
            Biggest levers for {target}
          </h3>
          <span className="text-label font-normal text-tertiary">if only this input changed</span>
        </div>
        <p id="whatif-levers-note" className="mt-2 text-label font-normal text-tertiary">
          Model counterfactuals, not treatment advice: how this model’s estimate responds when one input differs.
          {levers.levers.some((l) => isAssociationOnly(l.feature)) && ` ${ASSOCIATION_LEGEND}: changing it moves the estimate, not the arteries.`}
        </p>
        {levers.status === 'unavailable' ? (
          <p className="mt-3 text-body-s text-tertiary">Counterfactuals need the in-browser model, which could not load.</p>
        ) : levers.levers.length === 0 && levers.status === 'loading' ? (
          <div className="mt-2 flex flex-col gap-1" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : levers.levers.length === 0 ? (
          <p className="mt-3 text-body-s text-tertiary">No single changeable input moves this estimate noticeably.</p>
        ) : (
          <ul className={cn('mt-2 flex flex-col', levers.status === 'loading' && 'opacity-50')}>
            {levers.levers.map((l) => {
              const d = formatDeltaPts(l.delta);
              const spec = specOf(l.feature);
              // Pulling an edited input back to its recorded value is an undo, and lands on the recorded estimate.
              const undo = edited.includes(l.feature) && l.to === recordedInputs[l.feature];
              return (
                <li key={l.feature} className="grid h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-hairline pl-1 last:border-b-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-s text-primary">
                      {spec?.label ?? l.feature}
                      {isAssociationOnly(l.feature) && (
                        <span className="ml-0.5 text-tertiary" title={ASSOCIATION_NOTE}>
                          {ASSOCIATION_MARK}
                        </span>
                      )}
                    </span>
                    <span className="num truncate text-label font-normal text-tertiary">
                      {valueText(l.feature, l.from, specOf)} → {valueText(l.feature, l.to, specOf)}
                    </span>
                  </span>
                  <Tooltip content={`${target} would be ${formatProbability(l.then).text} instead of ${formatProbability(l.now).text}, with every other input unchanged.`}>
                    <span tabIndex={0} className="flex flex-col items-end rounded-xs outline-none focus-visible:shadow-focus">
                      <span className="num whitespace-nowrap text-body-s font-semibold text-primary">
                        {d.direction === 'none' ? '±0 pts' : `${d.glyph} ${d.text}`}
                      </span>
                      <span className="num text-label font-normal text-tertiary">
                        {undo ? 'back to recorded' : `→ ${formatProbability(l.then).text}`}
                      </span>
                    </span>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    aria-label={`Apply: set ${spec?.label ?? l.feature} to ${valueText(l.feature, l.to, specOf)}${isAssociationOnly(l.feature) ? ' (association only, not a known cause)' : ''}`}
                    onClick={() => usePatientStore.getState().setFeature(l.feature, l.to)}
                  >
                    {undo ? 'Undo' : 'Apply'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
