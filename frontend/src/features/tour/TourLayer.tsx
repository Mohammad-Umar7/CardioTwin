import { ArrowLeft, ArrowRight, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, IconButton, Kbd, trapFocus } from '@/design';
import { highestRiskVessel } from '@/features/landing/heroModel';
import { useLandingMetrics } from '@/features/landing/landingMetrics';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useTourClock } from './clock';
import { TOUR_RAIL_BOTTOM, TOUR_RAIL_H } from '@/features/workstation/stageInsets';
import { overlapsAny, pickDock, placeCard, union, type Dock, type Rect } from './geometry';
import { planTransition } from './plan';
import { PeelAnimator, buildCaptionContext, ensureShowcasePatient, executeAction, type ExecuteDeps } from './runtime';
import { BEATS, CHAPTERS, CHAPTER_START, clampBeat } from './script';
import { beginSession, endSession, getSession, trackMount, type TourSession } from './session';
import { captureSnapshot, restoreCamera, restoreStores } from './snapshot';
import { Spotlight } from './Spotlight';
import { useSpotlightRects } from './spotlightRects';
import { takeTourOrigin } from './tourApi';
import { waitForStage } from './waitFor';

const DURATIONS = BEATS.map((b) => b.durationMs);
const CARD_W = 360;
/** Keep-out for the caption card: the rail (40 px) plus its offset and a 12 px gap. */
const RAIL_CLEARANCE = TOUR_RAIL_BOTTOM + TOUR_RAIL_H + 12;
/** Stage cards and probability numerals the caption card never covers (the spotlit ones are beside it). */
const KEEP_CLEAR =
  '[data-region="risk-card"], [data-region="patient-card"], [data-region="patient-rail"], [data-region="inspector"], [data-prob]';
/** Gap between a docked caption and the stage edge or the card above it. */
const DOCK_GAP = 12;

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** Visible rectangles of the elements the caption card must stay clear of (`except`: a veiled column). */
function keepClearRects(extra: readonly Rect[], except?: Element | null): Rect[] {
  const out: Rect[] = [...extra];
  document.querySelectorAll<HTMLElement>(KEEP_CLEAR).forEach((el) => {
    if (el.closest('[inert],[aria-hidden="true"]')) return;
    if (except && except.contains(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight) return;
    out.push({ left: r.left - 8, top: r.top - 8, width: r.width + 16, height: r.height + 16 });
  });
  return out;
}

interface StageZones {
  /** The stage element's box. */
  stage: Rect;
  /** Where the heart is drawn: the whole free area on stage beats (selection views, the open heart spread
   *  across it), else the centred heart and its great vessels. */
  heart: Rect;
  /** Visible vessel and chamber labels (and their room around them). */
  labels: Rect[];
  /** The left and right stage columns (slot boxes), when shown. */
  left: HTMLElement | null;
  right: HTMLElement | null;
  /** Stage inset and the left column's width (CSS tokens). */
  inset: number;
  columnW: number;
}

/**
 * The parts of the workstation stage the caption card must never cover (V2 §6.3): the heart, from the
 * free area the camera frames it into (stage minus the chrome insets), and every visible 3D label. Null off
 * the workstation.
 */
function stageZones(wholeFree: boolean): StageZones | null {
  const stageEl = document.querySelector<HTMLElement>('[data-region="stage"]');
  if (!stageEl || stageEl.closest('[inert],[aria-hidden="true"]')) return null;
  const r = stageEl.getBoundingClientRect();
  // The insets without the caption's own docked column: the decision below never feeds back on itself.
  const i = useUiStore.getState().stageInsetsBase;
  const free = { left: r.left + i.left, top: r.top + i.top, width: r.width - i.left - i.right, height: r.height - i.top - i.bottom };
  if (free.width < 1 || free.height < 1) return null;
  // At home the walls fill ~62 % of the free height, centred; the great vessels rise above them.
  const w = Math.min(free.width, free.height * 0.7);
  const h = free.height * 0.8;
  const heart = wholeFree
    ? free
    : { left: free.left + (free.width - w) / 2, top: free.top + (free.height - h) / 2, width: w, height: h };
  const labels: Rect[] = [];
  stageEl.querySelectorAll<HTMLElement>('.z-labels button, [data-region="chamber-label"]').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || Number(getComputedStyle(el).opacity) < 0.05) return;
    labels.push({ left: b.left - 8, top: b.top - 8, width: b.width + 16, height: b.height + 16 });
  });
  const slot = (name: string) => {
    const el = stageEl.querySelector<HTMLElement>(`[data-region="slot-${name}"]`);
    return el && el.dataset.visible === 'true' && el.offsetWidth > 0 ? el : null;
  };
  const css = getComputedStyle(stageEl);
  const px = (name: string, fallback: number) => {
    const v = Number.parseFloat(css.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    stage: toRect(r),
    heart,
    labels,
    left: slot('left'),
    right: slot('right'),
    inset: px('--stage-inset', 12),
    columnW: px('--card-left-w', 256),
  };
}

/** "1/2" within a chapter, so the two beats of one chapter never read the same. */
function beatInChapter(index: number): { n: number; of: number } {
  const chapter = BEATS[index]!.chapter;
  const start = CHAPTER_START[chapter]!;
  return { n: index - start + 1, of: BEATS.filter((b) => b.chapter === chapter).length };
}

const routeOf = (loc: { pathname: string; search: string }) => `${loc.pathname}${loc.search}`;

/**
 * The route right now. Under the HashRouter the address bar is authoritative (unlike `useLocation`, it
 * already reflects a navigation still pending in a transition); other routers fall back to `location`.
 */
const routeNow = (loc: { pathname: string; search: string }): string => {
  const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
  return hash.startsWith('/') ? hash : routeOf(loc);
};

/**
 * Puts the app back exactly as it was before the demo (V2 §6.3 "restores the prior state on exit"): the
 * stores at once, the peel with an assemble tween, then the route and keyboard focus, then the camera pose
 * once the stage it belongs to is live.
 */
async function restoreSession(
  s: TourSession,
  opts: { navigate(to: string): void; currentRoute: string; reduced: boolean },
): Promise<void> {
  const snap = s.snapshot;
  const explode = useViewerStore.getState().explode;
  restoreStores({ ...snap, viewer: { ...snap.viewer, explode } });
  void new PeelAnimator().tweenTo(snap.viewer.explode, opts.reduced);
  const moved = snap.route !== opts.currentRoute;
  if (moved) opts.navigate(snap.route);
  // Focus first: it must not wait on the stage (frames can be throttled in a background tab).
  returnFocusAfterTour(s.returnFocus);
  if (snap.route.startsWith('/workstation')) {
    const ok = moved ? await waitForStage('workstation', 3000) : true;
    if (ok) restoreCamera(snap.camera, !opts.reduced);
  }
}

/**
 * Hands keyboard focus back when the demo ends (WCAG 2.4.3): to the control that opened it, or, when that
 * one is gone or still inert while the chrome comes back (the palette's input, a card that re-rendered), to
 * the top bar's Guided demo button. Retried for a few frames until the element is focusable again.
 */
function returnFocusAfterTour(opener: HTMLElement | null): void {
  const usable = (el: HTMLElement | null) => !!el && el.isConnected && !el.closest('[inert],[aria-hidden="true"]');
  const attempt = (n: number) => {
    const target = usable(opener) ? opener : document.querySelector<HTMLElement>('[data-tour="tour-button"]');
    if (target && usable(target)) {
      target.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
      if (document.activeElement === target) return;
    }
    if (n < 8) window.setTimeout(() => attempt(n + 1), 60);
  };
  window.setTimeout(() => attempt(0), 0);
}

// ------------------------------------------------------------------------------------ chapter rail

interface RailHandle {
  setProgress(beat: number, fraction: number): void;
}

function ChapterRail({
  beat,
  onJump,
  handle,
}: {
  beat: number;
  onJump(chapter: number): void;
  handle: React.MutableRefObject<RailHandle | null>;
}) {
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const active = BEATS[beat]!.chapter;

  useEffect(() => {
    handle.current = {
      setProgress(b, f) {
        const chapter = BEATS[b]!.chapter;
        const start = CHAPTER_START[chapter]!;
        const count = BEATS.filter((x) => x.chapter === chapter).length;
        const frac = Math.min(1, (b - start + Math.min(1, Math.max(0, f))) / count);
        fills.current.forEach((el, i) => {
          if (!el) return;
          const v = i < chapter ? 1 : i > chapter ? 0 : frac;
          el.style.transform = `scaleX(${v})`;
        });
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  return (
    <nav
      aria-label="Guided demo chapters"
      className="fixed left-1/2 z-coachmark flex h-10 -translate-x-1/2 items-center gap-1 rounded-full bg-panel px-1.5 shadow-e2"
      style={{ bottom: `calc(var(--status-h) + ${TOUR_RAIL_BOTTOM}px)` }}
    >
      {CHAPTERS.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onJump(i)}
          aria-current={i === active ? 'step' : undefined}
          aria-label={`Chapter ${i + 1} of ${CHAPTERS.length}: ${c.title}`}
          className={cn(
            'group flex h-8 items-center gap-2 rounded-full px-2.5 transition-colors duration-fast',
            i === active ? 'bg-surface-2' : 'hover:bg-surface-1',
          )}
        >
          <span className={cn('mono text-mono-s', i === active ? 'text-primary' : i < active ? 'text-secondary' : 'text-tertiary')}>
            {i + 1}
          </span>
          {i === active && <span className="whitespace-nowrap text-label text-primary">{c.title}</span>}
          <span
            aria-hidden
            className={cn('relative h-[3px] overflow-hidden rounded-full bg-line', i === active ? 'w-16' : 'w-8')}
          >
            <span
              ref={(el) => {
                fills.current[i] = el;
              }}
              className="absolute inset-0 origin-left rounded-full bg-accent"
              style={{ transform: `scaleX(${i < active ? 1 : 0})` }}
            />
          </span>
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------- the layer

/**
 * Guided demo (WORKSTATION_V2 §6.3): 5 chapters of timed beats that *perform* each step for the viewer —
 * load a held-out patient, select an artery (the camera flies, the inspector opens), dissect the anatomy,
 * open Explain (SHAP, physiology, model and data types), flip an input, reveal the cath result and visit
 * Model performance — with a spotlight, a caption card beside the spotlit region and a chapter rail.
 * It runs with `chrome = 'tour'`, autoplays in ≈ 90 s (pausable), and restores the app on exit.
 */
export default function TourLayer() {
  const open = useUiStore((s) => s.tourOpen);
  return open ? <TourView /> : null;
}

function TourView() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();
  const cohort = useCohort();
  const schema = useSchemaIndex();
  const metrics = useLandingMetrics();
  const step = useUiStore((s) => s.tourStep);
  const setTourStep = useUiStore((s) => s.setTourStep);
  const index = clampBeat(step);
  const beat = BEATS[index]!;
  const last = index === BEATS.length - 1;
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<RailHandle | null>(null);
  // The caption card's measured size, and the height of its text block (the part that reflows with width).
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: 196, text: 110 });

  const locationRef = useRef(location);
  locationRef.current = location;
  const deps = useRef<Omit<ExecuteDeps, 'peel'> | null>(null);
  deps.current = {
    reduced,
    navigate: (to) => {
      if (routeNow(locationRef.current).startsWith(to)) return false;
      navigate(to);
      return true;
    },
  };

  // Session start (once per demo, StrictMode-safe) and restore if something else closes the tour.
  useLayoutEffect(() => {
    if (!getSession()) {
      const origin = takeTourOrigin() ?? routeOf(locationRef.current);
      beginSession(captureSnapshot(origin));
      useViewerStore.getState().hover(null);
      useUiStore.getState().setPaletteOpen(false);
    }
    useUiStore.getState().setChrome('tour');
    return trackMount(() => {
      const s = endSession();
      if (s) {
        void restoreSession(s, {
          navigate: (to) => navigate(to),
          currentRoute: routeNow(locationRef.current),
          reduced,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the beat: diff the declared states and run the actions (after the stage exists when a route
  // change brings the workstation back).
  useEffect(() => {
    const session = getSession();
    if (!session) return;
    session.epoch += 1;
    const epoch = session.epoch;
    if (!session.showcased && cohort.data) {
      session.showcased = true;
      ensureShowcasePatient(cohort.data.patients);
    }
    if (beat.state.selection === 'top' && session.top === null) {
      const vessels = schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'];
      session.top = highestRiskVessel(usePatientStore.getState().prediction, vessels) ?? vessels[0] ?? null;
    }
    const actions = planTransition(session.applied, beat.state, session.top);
    session.applied = beat.state;
    void (async () => {
      for (const action of actions) {
        if (getSession() !== session || session.epoch !== epoch) return;
        // The session's own peel animator, so exiting cancels any dissection still playing.
        const moved = deps.current ? executeAction(action, { ...deps.current, peel: session.peel }) : false;
        if (moved && action.kind === 'route' && action.to === 'workstation') await waitForStage('workstation', 3000);
      }
    })();
    setEnded(false);
    // The cohort may arrive after the demo opens; the first beat re-runs the showcase check then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cohort.data]);

  const exit = useCallback(
    (completed: boolean) => {
      const s = endSession();
      useUiStore.getState().closeTour(completed);
      if (s) {
        void restoreSession(s, { navigate: (to) => navigate(to), currentRoute: routeNow(locationRef.current), reduced });
      }
    },
    [navigate, reduced],
  );

  const go = useCallback((i: number) => setTourStep(clampBeat(i)), [setTourStep]);
  const next = useCallback(() => (last ? exit(true) : go(index + 1)), [last, exit, go, index]);
  const back = useCallback(() => go(index - 1), [go, index]);

  useTourClock({
    beat: index,
    playing,
    durations: DURATIONS,
    onAdvance: (b) => go(b),
    onEnd: () => {
      setPlaying(false);
      setEnded(true);
    },
    onProgress: (b, f) => railRef.current?.setProgress(b, f),
  });

  // Keyboard: ← → move, Esc exits, Tab stays inside the demo; app shortcuts are suspended meanwhile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        trapFocus(layerRef.current)(e);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exit(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        back();
      } else if (e.key !== 'Enter' && e.key !== ' ') {
        // Single-key app shortcuts (1–3, E, I, P, \ …) would change the picture under the caption.
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [exit, next, back]);

  // Focus the primary control when the demo opens, and keep focus in the demo: drawers the demo opens
  // move focus to their first field, which would otherwise leave the dialog.
  useEffect(() => {
    const focusPrimary = () => cardRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
    const t = setTimeout(focusPrimary, 60);
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (layerRef.current && target && !layerRef.current.contains(target)) focusPrimary();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      clearTimeout(t);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const text = (el.children[1] as HTMLElement | undefined)?.offsetHeight ?? 110;
      setCardSize((prev) =>
        prev.w === el.offsetWidth && prev.h === el.offsetHeight && prev.text === text ? prev : { w: el.offsetWidth, h: el.offsetHeight, text },
      );
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (el.children[1]) ro.observe(el.children[1]);
    return () => ro.disconnect();
  }, [index]);

  // Live caption values.
  const prediction = usePatientStore((s) => s.prediction);
  const patientId = usePatientStore((s) => s.selectedPatientId);
  const split = usePatientStore((s) => s.split);
  const recorded = usePatientStore((s) => s.recorded);
  const selected = useViewerStore((s) => s.selectedStructure);
  const ctx = useMemo(
    () =>
      buildCaptionContext({
        patientId,
        split,
        prediction,
        recorded,
        schema,
        vessel: selected,
        nTest: metrics.data?.nTest ?? null,
      }),
    [patientId, split, prediction, recorded, schema, selected, metrics.data],
  );

  const { rects, bounds } = useSpotlightRects(beat.spotlight);
  const found = rects.filter((r): r is Rect => r !== null);
  const anchorRect = beat.anchor !== undefined ? (rects[beat.anchor] ?? null) : union(found);
  // The card never covers the chapter rail (bottom centre) or the stage's context slot (selection chip,
  // what-if pill: 12 px inset + 32 px).
  const cardBounds = { ...bounds, top: bounds.top + 44, bottom: bounds.bottom - RAIL_CLEARANCE };
  // Never over a stage card or a probability numeral (e.g. the CAD numeral at 1280), nor over the other
  // spotlit regions; the stage spotlight is the exception, the card sits inside it by design.
  const spotlitElements = rects.filter((r, i): r is Rect => {
    const spec = beat.spotlight[i];
    return r !== null && spec !== undefined && !('stage' in spec);
  });
  const avoid = bounds.right > 0 ? keepClearRects(spotlitElements) : [];
  // Height of the card at another width: the chrome (header, buttons, padding) stays, the text reflows.
  const heightAt = (w: number) =>
    Math.ceil(cardSize.h - cardSize.text + (cardSize.text * Math.max(1, cardSize.w - 32)) / Math.max(1, w - 32)) + 8;
  const placed = bounds.right > 0 ? placeCard(anchorRect, { width: CARD_W, height: heightAt(CARD_W) }, cardBounds, 16, avoid) : null;
  // On the workstation the caption never covers the heart or a 3D label (V2 §6.3), and on stage beats it
  // stays off the whole free area (selection views and the open heart use all of it). When the placement
  // beside the spotlit region would, it docks in a stage column: below the left or right card when there is
  // room, else in the left column itself, over the veiled left card, with the column reserved in the stage
  // insets so the camera frames the heart beside the caption (it glides over, never under it).
  const stageBeat = beat.spotlight.some((sp) => 'stage' in sp);
  const zones = placed ? stageZones(stageBeat) : null;
  let pos: { left: number; top: number } | null = placed;
  let cardW = CARD_W;
  let dockLeft = 0;
  if (placed && zones) {
    const rail = document.querySelector('nav[aria-label="Guided demo chapters"]')?.getBoundingClientRect();
    const offLimits = [zones.heart, ...zones.labels, ...(rail ? [toRect(rail)] : [])];
    const here = { left: placed.left, top: placed.top, width: CARD_W, height: heightAt(CARD_W) };
    if (overlapsAny(here, offLimits)) {
      const docks: Dock[] = [];
      const lr = zones.left?.getBoundingClientRect();
      const rr = zones.right?.getBoundingClientRect();
      const leftBelow = lr && lr.width >= 240 ? { left: lr.left, top: lr.bottom + DOCK_GAP, width: lr.width, veil: false } : null;
      const rw = rr ? Math.min(CARD_W, rr.width) : 0;
      const rightBelow = rr && rw >= 240 ? { left: rr.right - rw, top: rr.bottom + DOCK_GAP, width: rw, veil: false } : null;
      const anchorRight = !!(anchorRect && rr && anchorRect.left >= rr.left - 1 && anchorRect.left + anchorRect.width <= rr.right + 1);
      for (const d of anchorRight ? [rightBelow, leftBelow] : [leftBelow, rightBelow]) if (d) docks.push({ ...d, height: heightAt(d.width) });
      const inner = {
        left: zones.stage.left + zones.inset,
        top: zones.stage.top + zones.inset,
        right: zones.stage.left + zones.stage.width - zones.inset,
        bottom: zones.stage.top + zones.stage.height - zones.inset,
      };
      const pick = pickDock(docks, inner, [...offLimits, ...avoid]);
      if (pick) {
        pos = { left: pick.left, top: pick.top };
        cardW = pick.width;
      } else if (useUiStore.getState().drawer !== 'inputs') {
        // The left column itself (the Inputs drawer owns it while open).
        pos = { left: inner.left, top: inner.top };
        cardW = zones.columnW;
        dockLeft = zones.columnW;
      }
    }
  }
  useEffect(() => {
    useUiStore.getState().setTourDockLeft(dockLeft);
  }, [dockLeft]);
  useEffect(() => () => useUiStore.getState().setTourDockLeft(0), []);
  const chapter = CHAPTERS[beat.chapter]!;
  const inChapter = beatInChapter(index);

  return (
    <div ref={layerRef} data-region="tour">
      <Spotlight rects={rects} />
      <ChapterRail beat={index} onJump={(c) => go(CHAPTER_START[c]!)} handle={railRef} />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed z-coachmark flex flex-col gap-2.5 rounded-lg bg-surface-3 p-4 shadow-e3 transition-[top,left,opacity] duration-base ease-out"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: cardW, opacity: pos ? 1 : 0 }}
      >
        <div className="flex items-center gap-2">
          <p className="eyebrow min-w-0 flex-1 truncate text-tertiary">
            {beat.chapter + 1} of {CHAPTERS.length} · {chapter.title}
          </p>
          {inChapter.of > 1 && (
            <span className="mono text-mono-s text-tertiary" aria-label={`Step ${inChapter.n} of ${inChapter.of} in this chapter`}>
              {inChapter.n}/{inChapter.of}
            </span>
          )}
          <IconButton
            label={playing ? 'Pause the demo' : 'Play the demo'}
            tooltip={false}
            size="xs"
            icon={playing ? <Pause /> : <Play />}
            onClick={() => {
              if (ended) return;
              setPlaying((p) => !p);
            }}
            disabled={ended}
          />
          <IconButton label="Exit the demo (Esc)" tooltip={false} size="xs" icon={<X />} onClick={() => exit(false)} />
        </div>
        <div key={beat.id} className="flex flex-col gap-1.5 animate-rise-in">
          <h2 id="tour-title" className="text-title-2 text-primary">
            {beat.title}
          </h2>
          <p id="tour-body" aria-live="polite" className="text-body-s text-secondary">
            {beat.caption(ctx)}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<ArrowLeft />}
            onClick={back}
            disabled={index === 0}
            className="-ml-1.5"
          >
            Back
          </Button>
          <span className="flex flex-1 items-center justify-center gap-1 text-label font-normal text-tertiary">
            <Kbd>Esc</Kbd> to exit
          </span>
          <Button variant="primary" size="sm" iconRight={last ? undefined : <ArrowRight />} onClick={next} data-primary>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
