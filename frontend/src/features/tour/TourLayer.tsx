import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ProgressRing, trapFocus } from '@/design';
import { ROUTES } from '@/routes';
import { useUiStore } from '@/state/uiStore';
import { TOUR_STEPS } from './steps';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 320;

function findTarget(selector: string): HTMLElement | null {
  for (const sel of selector.split(',')) {
    const el = document.querySelector<HTMLElement>(sel.trim());
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

/**
 * Guided tour (DESIGN_SYSTEM §5 TourCoachmark): spotlight cut-out on a 60 % scrim, a 320 px card on
 * surface/3 with e-3, step n / N, Back / Next / Skip, focus trapped, Esc closes and the tour can be
 * resumed from "Tour". The status line (z 90) stays above the scrim (z 70).
 */
export default function TourLayer() {
  const open = useUiStore((s) => s.tourOpen);
  const step = useUiStore((s) => s.tourStep);
  const setStep = useUiStore((s) => s.setTourStep);
  const closeTour = useUiStore((s) => s.closeTour);
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const current = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)]!;
  const last = step >= TOUR_STEPS.length - 1;

  const measure = useCallback(() => {
    const el = findTarget(current.target);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [current.target]);

  useLayoutEffect(() => {
    if (!open) return;
    current.onEnter?.();
    // wait a frame for routes / panels to lay out
    const t = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [open, current, measure]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => cardRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeTour(false);
      } else trapFocus(cardRef.current)(e);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, closeTour]);

  if (!open) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardTop = vh / 2 - 90;
  let cardLeft = vw / 2 - CARD_W / 2;
  if (rect) {
    const below = rect.top + rect.height + 12;
    const above = rect.top - 12 - 190;
    cardTop = below + 190 < vh - 40 ? below : above > 8 ? above : Math.max(8, vh / 2 - 90);
    cardLeft = Math.min(vw - CARD_W - 12, Math.max(12, rect.left + rect.width / 2 - CARD_W / 2));
    if (rect.height > vh * 0.6) {
      // tall targets (panels): put the card beside them
      cardTop = Math.min(vh - 220, Math.max(12, rect.top + 24));
      cardLeft = rect.left + rect.width + 12 + CARD_W < vw ? rect.left + rect.width + 12 : Math.max(12, rect.left - CARD_W - 12);
    }
  }

  const finish = () => {
    closeTour(true);
    navigate(ROUTES.performance);
  };

  return (
    <div className="fixed inset-0 z-scrim" aria-live="polite">
      {/* Scrim with a spotlight cut-out (even-odd path). An SVG keeps the overlay viewport-sized; a
          9999 px box-shadow can make browsers drop the WebGL layer underneath. */}
      <svg aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" width={vw} height={vh}>
        <path
          fill="rgba(7,9,12,0.6)"
          fillRule="evenodd"
          d={
            `M0 0H${vw}V${vh}H0Z` +
            (rect
              ? ` M${rect.left} ${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`
              : '')
          }
        />
        {rect && (
          <rect
            x={rect.left}
            y={rect.top}
            width={rect.width}
            height={rect.height}
            rx={8}
            fill="none"
            stroke="rgb(86 194 230 / 0.6)"
            strokeWidth={1}
          />
        )}
      </svg>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed z-coachmark flex w-[320px] flex-col gap-3 rounded-lg bg-surface-3 p-4 shadow-e3 transition-[top,left] duration-base ease-out"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-center gap-2">
          <ProgressRing value={(step + 1) / TOUR_STEPS.length} label={`Step ${step + 1} of ${TOUR_STEPS.length}`} size={18} />
          <span className="num text-label font-normal text-tertiary">
            {step + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <h2 id="tour-title" className="text-title-2 text-primary">
          {current.title}
        </h2>
        <p id="tour-body" className="text-body-s text-secondary">
          {current.body}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => closeTour(false)}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <Button variant="primary" size="sm" data-primary onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? 'See how well it performs ›' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
