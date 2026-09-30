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
import { placeCard, union, type Rect } from './geometry';
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
 * stores at once, the peel with an assemble tween, then the route, then the camera pose once the stage it
 * belongs to is live, and finally keyboard focus.
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
  if (snap.route.startsWith('/workstation')) {
    const ok = moved ? await waitForStage('workstation', 3000) : true;
    if (ok) restoreCamera(snap.camera, !opts.reduced);
  }
  s.returnFocus?.focus?.({ preventScroll: true });
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
      style={{ bottom: 'calc(var(--status-h) + 12px)' }}
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
  const [cardH, setCardH] = useState(196);

  const locationRef = useRef(location);
  locationRef.current = location;
  const deps = useRef<ExecuteDeps | null>(null);
  deps.current = {
    reduced,
    peel: getSession()?.peel ?? new PeelAnimator(),
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
        const moved = deps.current ? executeAction(action, deps.current) : false;
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
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const cardBounds = { ...bounds, top: bounds.top + 44, bottom: bounds.bottom - 64 };
  const pos = bounds.right > 0 ? placeCard(anchorRect, { width: CARD_W, height: cardH }, cardBounds) : null;
  const chapter = CHAPTERS[beat.chapter]!;

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
        className="fixed z-coachmark flex w-[360px] flex-col gap-2.5 rounded-lg bg-surface-3 p-4 shadow-e3 transition-[top,left,opacity] duration-base ease-out"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
      >
        <div className="flex items-center gap-2">
          <p className="eyebrow min-w-0 flex-1 truncate text-tertiary">
            {beat.chapter + 1} of {CHAPTERS.length} · {chapter.title}
          </p>
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
