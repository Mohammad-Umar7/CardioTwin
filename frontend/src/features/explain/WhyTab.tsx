import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, SegmentedControl, Skeleton } from '@/design';
import { ASSOCIATION_MARK } from '@/lib/associations';
import { cn } from '@/lib/cn';
import { NEGLIGIBLE_SHAP, sortedContributions } from '@/lib/explain';
import { formatSigned } from '@/lib/format';
import type { Contribution, TargetId } from '@/types/contracts';
import { modalityAttribution, splitDrivers } from './attribution';
import { setExplainPrefs, useExplainPrefs, type ContributionUnit, type WhyGrouping } from './explainPrefs';
import { ROW_GRID, useChangedFeatures } from './explainUi';
import { ModalityStrip } from './ModalityStrip';
import { ContributionRow } from './ShapWaterfall';
import { unitLabel, useExplainData, type ExplainData } from './useExplainData';

const TOP = 5;

function ListHeader({ title, count, unit, id }: { title: string; count?: number; unit: ContributionUnit; id: string }) {
  return (
    <div className={cn('grid h-7 items-end gap-x-2 border-b border-hairline pb-1 pl-1 pr-1', ROW_GRID)}>
      <h4 id={id} className="eyebrow col-span-3 text-secondary">
        {title}
        {count !== undefined && <span className="ml-1.5 text-tertiary">{count}</span>}
      </h4>
      <span />
      <span className="text-right text-label font-normal text-tertiary">{unitLabel(unit)}</span>
    </div>
  );
}

function Rows({ list, d, changed, inset }: { list: Contribution[]; d: ExplainData; changed: ReadonlySet<string>; inset?: boolean }) {
  const max = Math.max(1e-6, ...(d.explanation?.contributions ?? []).map((c) => Math.abs(c.shap)));
  return (
    <>
      {list.map((c) => (
        <ContributionRow
          key={c.feature}
          c={c}
          spec={d.index?.byKey.get(c.feature)}
          target={d.target}
          max={max}
          unit={d.unit}
          scale={d.scale}
          changed={changed.has(c.feature)}
          inset={inset}
          fmt={d.fmt}
        />
      ))}
    </>
  );
}

/**
 * The hidden negligible inputs of a modality as one printed row, so the header total is exactly the sum of
 * the rows printed under it.
 */
function NegligibleRow({ list, d }: { list: Contribution[]; d: ExplainData }) {
  const f = d.total(list);
  return (
    <li className={cn('grid min-h-7 items-center gap-x-2 py-0.5 pl-3 pr-1 opacity-60', ROW_GRID)}>
      <span />
      <span className="col-span-3 text-body-s leading-4 text-tertiary">
        {list.length} negligible {list.length === 1 ? 'input' : 'inputs'}
      </span>
      <span className="num text-right text-numeral-m text-tertiary">{f.text}</span>
    </li>
  );
}

/**
 * Explain › Why (WORKSTATION_V2 §5.10): the multimodal fingerprint, then the inputs that raise and lower
 * the estimate (top 5 each, the rest one click away), by input or by data modality, in percentage points or
 * exact log-odds. Every row links to its input.
 */
export function WhyTab({ target }: { target: TargetId }) {
  const d = useExplainData(target);
  const prefs = useExplainPrefs();
  const [expanded, setExpanded] = useState(false);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const changed = useChangedFeatures(d.explanation?.contributions);
  const labelOf = (k: string) => d.index?.byKey.get(k)?.label ?? k;
  const modalities = useMemo(
    () => modalityAttribution(d.explanation, (k) => d.index?.byKey.get(k)?.group),
    [d.explanation, d.index],
  );

  if (!d.explanation || !d.p) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-24" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    );
  }

  const split = splitDrivers(d.explanation, expanded ? 999 : TOP);
  const all = sortedContributions(d.explanation);
  const negligible = all.filter((c) => Math.abs(c.shap) < NEGLIGIBLE_SHAP);
  const raisingAll = all.filter((c) => c.shap >= NEGLIGIBLE_SHAP).length;
  const loweringAll = all.filter((c) => c.shap <= -NEGLIGIBLE_SHAP).length;
  const hidden = expanded ? 0 : all.length - split.raising.length - split.lowering.length;

  // Gross, input by input: the sums of the printed rows (largest-remainder rounded), never re-rounded totals.
  const upTotal = d.total(all.filter((c) => c.shap > 0), 'points');
  const downTotal = d.total(all.filter((c) => c.shap < 0), 'points');
  const netTotal = d.total(all, 'points');

  const pickGroup = (g: string) => {
    setFocusGroup(g);
    setExplainPrefs({ grouping: 'modality' });
    window.requestAnimationFrame(() =>
      document.getElementById(`why-group-${g}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <SegmentedControl<WhyGrouping>
            label="Group contributions"
            size="xs"
            value={prefs.grouping}
            onChange={(grouping) => {
              setExplainPrefs({ grouping });
              setFocusGroup(null);
            }}
            options={[
              { value: 'feature', label: 'By input' },
              { value: 'modality', label: 'By modality' },
            ]}
          />
          <SegmentedControl<ContributionUnit>
            label="Contribution unit"
            size="xs"
            value={d.unit}
            onChange={(unit) => setExplainPrefs({ unit })}
            options={[
              { value: 'points', label: 'Points', title: 'Percentage points of probability (rescaled SHAP)', disabled: !d.scale },
              { value: 'logodds', label: 'Log-odds', title: 'Exact SHAP values on the model’s log-odds scale' },
            ]}
          />
        </div>
        <p className="text-label font-normal text-tertiary">
          {d.unit === 'points'
            ? 'How to read this: each bar is how many percentage points one input adds to, or takes from, the typical patient.'
            : 'How to read this: each bar is one input’s exact SHAP contribution on the model’s log-odds scale.'}{' '}
          {/* The caveat sits above the lists, not under them: a driver such as ESR must never read as a cause. */}
          <span className="text-secondary">Associations in this cohort, not causes</span>; {ASSOCIATION_MARK} marks inputs
          with no established causal role in coronary disease.
        </p>
      </div>

      <ModalityStrip
        rows={modalities}
        target={target}
        unit={d.unit}
        labelOf={labelOf}
        fmt={d.fmt}
        total={d.total}
        onPick={pickGroup}
        active={prefs.grouping === 'modality' ? focusGroup : null}
      />

      {prefs.grouping === 'feature' ? (
        <div className={cn('flex flex-col gap-4', d.stale && 'opacity-50')}>
          <section aria-labelledby="why-raising">
            <ListHeader id="why-raising" title="Raising risk" count={raisingAll} unit={d.unit} />
            {split.raising.length > 0 ? (
              <ul className="mt-1 flex flex-col">
                <Rows list={split.raising} d={d} changed={changed} />
              </ul>
            ) : (
              <p className="px-1 pt-2 text-label font-normal text-tertiary">No input raises this estimate noticeably.</p>
            )}
          </section>
          <section aria-labelledby="why-lowering">
            <ListHeader id="why-lowering" title="Lowering risk" count={loweringAll} unit={d.unit} />
            {split.lowering.length > 0 ? (
              <ul className="mt-1 flex flex-col">
                <Rows list={split.lowering} d={d} changed={changed} />
              </ul>
            ) : (
              <p className="px-1 pt-2 text-label font-normal text-tertiary">No input lowers this estimate noticeably.</p>
            )}
          </section>
          {expanded && negligible.length > 0 && (
            <section aria-labelledby="why-negligible">
              <ListHeader id="why-negligible" title="Negligible" count={negligible.length} unit={d.unit} />
              <ul className="mt-1 flex flex-col">
                <Rows list={negligible} d={d} changed={changed} />
              </ul>
            </section>
          )}
          {(hidden > 0 || expanded) && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              aria-expanded={expanded}
              iconRight={expanded ? <ChevronUp /> : <ChevronDown />}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Show the top 5 only' : `+ ${hidden} smaller contributions · Show all`}
            </Button>
          )}
        </div>
      ) : (
        <div className={cn('flex flex-col gap-4', d.stale && 'opacity-50')}>
          {modalities
            .filter((m) => m.contributions.length > 0)
            .map((m) => {
              const shown = expanded ? m.contributions : m.contributions.filter((c) => Math.abs(c.shap) >= NEGLIGIBLE_SHAP);
              const rest = expanded ? [] : m.contributions.filter((c) => Math.abs(c.shap) < NEGLIGIBLE_SHAP);
              // The column's printed value (net for the modality): the sum of the printed rows below.
              const f = d.total(m.contributions);
              return (
                <section
                  key={m.group}
                  id={`why-group-${m.group}`}
                  aria-labelledby={`why-group-title-${m.group}`}
                  className={cn('scroll-mt-4 rounded-sm transition-colors duration-base', focusGroup === m.group && 'bg-surface-1/60')}
                >
                  <div className={cn('grid h-7 items-end gap-x-2 border-b border-hairline pb-1 pl-1 pr-1', ROW_GRID)}>
                    <h4 id={`why-group-title-${m.group}`} className="eyebrow col-span-3 text-secondary">
                      {m.label}
                      <span className="ml-1.5 text-tertiary">{m.contributions.length}</span>
                    </h4>
                    <span />
                    <span className="num text-right text-numeral-m text-primary">{m.abs === 0 ? '–' : f.text}</span>
                  </div>
                  <ul className="mt-1 flex flex-col">
                    <Rows list={shown} d={d} changed={changed} inset />
                    {rest.length > 0 && <NegligibleRow list={rest} d={d} />}
                  </ul>
                </section>
              );
            })}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={expanded}
            iconRight={expanded ? <ChevronUp /> : <ChevronDown />}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Hide negligible inputs' : `Show negligible inputs (${negligible.length})`}
          </Button>
        </div>
      )}

      <p className="border-t border-hairline pt-3 text-label font-normal text-tertiary">
        {d.unit === 'points' && d.scale ? (
          <>
            Points rescale the exact SHAP log-odds so they add up from the typical patient to this estimate. Gross,
            input by input:{' '}
            <span className="num text-secondary">
              {upTotal.text} raising, {downTotal.text} lowering, net {netTotal.text} pts
            </span>
            ; the modality columns above are the same inputs netted per modality. Log-odds are the model’s own
            additive scale.
          </>
        ) : (
          <>
            Bars are exact SHAP contributions in log-odds; they add up from the cohort baseline (
            <span className="num text-secondary">{formatSigned(d.explanation.base_value)}</span>) to this estimate (
            <span className="num text-secondary">{formatSigned(d.explanation.output_value)}</span>).
          </>
        )}
      </p>
    </div>
  );
}
