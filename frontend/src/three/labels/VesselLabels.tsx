import { useCallback, useEffect, useRef, useState } from 'react';
import { RiskPip } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useDelayedFlag, useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatProbability } from '@/lib/format';
import { selectDisplayedPrediction, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { RISK_PENDING } from '@/theme/risk';
import { HoverTooltip } from './HoverTooltip';
import { CHAMBER_TAGS, chamberEls, dotEls, labelEls, labelShowsProbability, labelSizes, lineEls } from './labelRegistry';

const DEFAULT_VESSELS = ['LAD', 'LCX', 'RCA'];
/** The band-change ring plays at most once per 1.2 s per label (V2 §8.3). */
const RING_THROTTLE_MS = 1200;
const RING_MS = 260;
/** Stale after 150 ms of loading: achromatic pip, dimmed numeral (V2 §8.3.6). */
const STALE_AFTER_MS = 150;

function useBandRing(target: string, band: string | null): boolean {
  const reduced = useIsReducedMotion();
  const last = useRef<{ band: string | null; at: number }>({ band, at: 0 });
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    const prev = last.current;
    if (band === prev.band) return;
    last.current = { band, at: prev.at };
    // No ring for the first value, a patient switch to/from "no estimate", or under reduced motion.
    if (prev.band === null || band === null || reduced) return;
    const now = performance.now();
    if (now - prev.at < RING_THROTTLE_MS) return;
    last.current.at = now;
    setRinging(true);
    const t = window.setTimeout(() => setRinging(false), RING_MS + 40);
    return () => window.clearTimeout(t);
  }, [band, reduced, target]);
  return ringing;
}

function Label({ target }: { target: string }) {
  const prediction = usePatientStore((s) => selectDisplayedPrediction(s)?.predictions[target]);
  const status = usePatientStore((s) => s.status);
  const chrome = useUiStore((s) => s.chrome);
  const hovered = useViewerStore((s) => s.hoveredStructure === target);
  const stale = useDelayedFlag(status === 'loading', STALE_AFTER_MS);
  const p = prediction?.probability;
  const pending = stale || (status === 'error' && !prediction);
  const f = formatProbability(p);
  const showPct = labelShowsProbability(chrome);
  const ringing = useBandRing(target, prediction?.risk_band ?? null);

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
      data-target={target}
      data-hovered={hovered}
      onClick={() => {
        const v = useViewerStore.getState();
        v.select(v.selectedStructure === target ? null : target);
      }}
      onPointerEnter={() => useViewerStore.getState().hover(target)}
      onPointerLeave={() => {
        if (useViewerStore.getState().hoveredStructure === target) useViewerStore.getState().hover(null);
      }}
      style={{ opacity: 0 }}
      className={cn(
        // LUMEN 2: a glass pill with a lit top edge; selection glows in the interaction colour.
        'group pointer-events-auto absolute left-0 top-0 flex items-center whitespace-nowrap rounded-full border pl-2.5 pr-3 outline-none will-change-transform',
        'bg-[rgba(18,23,31,0.78)] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_8px_22px_-6px_rgba(0,0,0,0.7)]',
        'transition-[opacity,border-color,height,box-shadow] duration-fast ease-out',
        showPct ? 'h-7' : 'h-6',
        'border-white/10 data-[hovered=true]:border-white/25',
        'data-[selected=true]:border-accent/70 data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgb(var(--c-accent)/0.3),0_0_22px_-4px_rgb(var(--c-accent)/0.6),0_8px_22px_-6px_rgba(0,0,0,0.7)]',
        'data-[dimmed=true]:saturate-50',
      )}
    >
      <span className="relative inline-flex">
        <RiskPip p={pending ? null : p} />
        {ringing && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pip-ring rounded-full [animation-fill-mode:both]"
            style={{ boxShadow: `0 0 0 1.5px ${pending || p == null ? RISK_PENDING : 'rgb(var(--c-text-primary))'}` }}
          />
        )}
      </span>
      <span className="eyebrow ml-1.5 text-primary">{target}</span>
      <span
        data-prob={showPct ? target : undefined}
        className={cn(
          'overflow-hidden font-numeral text-numeral-label tabular-nums text-primary transition-[max-width,opacity,margin] duration-fast ease-out group-data-[compact=true]:hidden',
          showPct ? 'ml-1.5 max-w-[56px] opacity-100' : 'ml-0 max-w-0 opacity-0',
          pending && 'opacity-50',
        )}
      >
        {f.qualifier}
        {f.value}
        {f.value !== '–' && <span className="pct-sign">%</span>}
      </span>
      <span className="ml-1.5 hidden text-label font-normal text-secondary group-data-[behind=true]:inline">(behind)</span>
    </button>
  );
}

function Leader({ target }: { target: string }) {
  const registerLine = useCallback(
    (el: SVGLineElement | null) => {
      if (el) lineEls.set(target, el);
      else lineEls.delete(target);
    },
    [target],
  );
  const registerDot = useCallback(
    (el: SVGCircleElement | null) => {
      if (el) dotEls.set(target, el);
      else dotEls.delete(target);
    },
    [target],
  );
  return (
    <g>
      <line
        ref={registerLine}
        className="stroke-primary transition-opacity duration-fast data-[selected=true]:stroke-accent"
        strokeWidth={1}
        style={{ opacity: 0 }}
        x1={0}
        y1={0}
        x2={0}
        y2={0}
      />
      {/* The anchor: a 2.5 px dot with a dark halo so it reads on tissue of any colour. */}
      <circle
        ref={registerDot}
        r={2.5}
        className="fill-primary stroke-void transition-opacity duration-fast data-[selected=true]:fill-accent"
        strokeWidth={1.5}
        style={{ opacity: 0 }}
        cx={0}
        cy={0}
      />
    </g>
  );
}

/**
 * Chamber tag at Open heart: a 5 px dot ON the anchor (the projector moves the box's origin there) and a
 * compact "LV · mitral valve" chip beside it. Decorative (the scene summary names the open state).
 */
function ChamberTag({ id, name, valve }: (typeof CHAMBER_TAGS)[number]) {
  const register = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) chamberEls.set(id, el);
      else chamberEls.delete(id);
    },
    [id],
  );
  return (
    <div ref={register} data-region="chamber-label" data-chamber={id} title={name} style={{ opacity: 0 }} className="absolute left-0 top-0 transition-opacity duration-fast ease-out will-change-transform">
      <span aria-hidden className="absolute left-0 top-0 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_1.5px_rgb(var(--c-void))]" />
      <span className="absolute left-2 top-0 flex h-5 -translate-y-1/2 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(18,23,31,0.78)] px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--e-hud)] backdrop-blur-md">
        <span className="eyebrow text-primary">{id}</span>
        {valve && <span className="ml-1 text-label font-normal text-secondary">· {valve}</span>}
      </span>
    </div>
  );
}

/**
 * DOM half of the vessel labels v2 (WORKSTATION_V2 §5.14): an 8 px pip + the code (overline) on a
 * surface/3 chip at 88 % with a 1 px border, h 24; with chrome focus / landing the % joins (h 28,
 * `data-prob`), crossfading over `fast`. No band word and no meter. The selected label carries an accent
 * ring; hover strengthens the border; far-side unselected labels read "(behind)"; the pip rings once when
 * the band changes. Positions and states are written by <LabelProjector/> inside the canvas. Labels are
 * decorative duplicates for sighted users (aria-hidden); the accessible equivalent is the scene summary
 * and the vessel rows in the risk card.
 */
export function VesselLabelsOverlay() {
  const schema = useSchemaIndex();
  const targets = schema?.vessels.map((t) => t.id) ?? DEFAULT_VESSELS;

  // Keep label sizes current for the lane layout without forcing layout in the render loop.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const id = el.dataset.target;
        if (id) labelSizes.set(id, { width: el.offsetWidth, height: el.offsetHeight });
      }
    });
    for (const [id, el] of labelEls) {
      if (!targets.includes(id)) continue;
      labelSizes.set(id, { width: el.offsetWidth, height: el.offsetHeight });
      ro.observe(el);
    }
    return () => ro.disconnect();
  }, [targets]);

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
      {CHAMBER_TAGS.map((c) => (
        <ChamberTag key={c.id} {...c} />
      ))}
      <HoverTooltip />
    </div>
  );
}
