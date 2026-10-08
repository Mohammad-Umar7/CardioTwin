import { HeartPulse } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { usePatientStore } from '@/state/patientStore';
import { clampHeartRate } from '@/three/anatomy/heartbeat';
import { sceneRuntime } from '@/three/stage/sceneRuntime';
import { displayRate, ecgAt } from './ecg';

const ECG_RGB = '52, 211, 153';
/** Phase of the R peak (`ECG_WAVES`): the heart glyph pulses as the sweep crosses it. */
const R_PEAK = 0.973;
/** Scene phase counts as live while it changed within this window (ms); otherwise the strip runs free. */
const LIVE_WINDOW_MS = 250;
/** Width of the erase bar ahead of the write head (px), as on a bedside monitor. */
const GAP = 14;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  // jsdom implements no canvas (and logs an error for trying): the decoration simply stays blank there.
  if (/jsdom/i.test(navigator.userAgent)) return null;
  return canvas.getContext('2d');
}

const patientBpm = () => clampHeartRate(usePatientStore.getState().features.PR);

export interface EcgTraceProps {
  width: number;
  height: number;
  /** Seconds of signal across the strip (sweep speed). */
  seconds?: number;
  className?: string;
  /** Called on every R peak (e.g. to pulse a heart glyph). */
  onBeat?(): void;
}

/**
 * A sweeping ECG strip drawn on a 2D canvas, phase-locked to the 3D heart: while the scene's cardiac clock
 * advances, the strip follows its physiological phase (so the QRS lands just before the ventricles contract on
 * screen); when the canvas is idle or parked it runs free at the patient's recorded rate. Under reduced motion it
 * is a still trace. Pure decoration (aria-hidden): the rate is stated in text beside it.
 */
export function EcgTrace({ width, height, seconds = 3.2, className, onBeat }: EcgTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const beatRef = useRef(onBeat);
  beatRef.current = onBeat;
  const reduced = useIsReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? context2d(canvas) : null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mid = height * 0.64;
    const amp = height * 0.52;
    const yOf = (v: number) => mid - v * amp;
    const style = (c: CanvasRenderingContext2D) => {
      c.lineWidth = 1.6;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.strokeStyle = `rgba(${ECG_RGB}, 1)`;
      c.shadowColor = `rgba(${ECG_RGB}, 0.85)`;
      c.shadowBlur = 6;
    };
    style(ctx);
    const head = headRef.current;

    if (reduced) {
      const bpm = patientBpm();
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (let px = 0; px <= width; px += 0.5) {
        const y = yOf(ecgAt((px / width) * seconds * (bpm / 60) + 0.55));
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      if (head) head.style.opacity = '0';
      return;
    }

    const speed = width / seconds;
    let x = 0;
    let phase = 0.5;
    let y = yOf(ecgAt(phase));
    let last = performance.now();
    let lastScene = sceneRuntime.beat.phase;
    let lastSceneChange = -Infinity;
    let synced = false;
    let raf = 0;
    let visible = true;

    const clearAhead = (from: number, span: number) => {
      const end = from + span;
      ctx.clearRect(from, 0, Math.min(end, width) - from, height);
      if (end > width) ctx.clearRect(0, 0, end - width, height);
    };

    // Start as if the strip had been running: the previous sweep fills the width (pixel `width` = now), and the
    // write head begins at the left edge, erasing the oldest signal in front of it.
    const prefill = () => {
      const beatsPerPx = patientBpm() / 60 / speed;
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (let px = 0; px <= width; px += 0.6) {
        const py = yOf(ecgAt(phase - (width - px) * beatsPerPx));
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      clearAhead(0, GAP);
      y = yOf(ecgAt(phase));
    };
    prefill();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (dt === 0) return;
      const scenePhase = sceneRuntime.beat.phase;
      if (scenePhase !== lastScene) {
        lastScene = scenePhase;
        lastSceneChange = now;
      }
      // Next phase: the scene's (unwrapped onto ours, never backwards) while it is live, else free-running at
      // the patient's rate. Locking on (or back on) snaps once instead of racing through half a beat.
      const live = now - lastSceneChange < LIVE_WINDOW_MS;
      let target = phase + (dt * patientBpm()) / 60;
      if (live) {
        let locked = Math.floor(phase) + scenePhase;
        if (locked < phase - 0.5) locked += 1;
        if (locked > phase + 0.5) locked -= 1;
        if (!synced) {
          phase = locked;
          y = yOf(ecgAt(phase));
          synced = true;
        }
        target = Math.max(phase, locked);
      } else {
        synced = false;
      }
      const dx = dt * speed;
      clearAhead(x, dx + GAP);
      const steps = Math.max(1, Math.ceil(dx / 0.6));
      ctx.beginPath();
      ctx.moveTo(x, y);
      let prevPx = x;
      let offset = 0;
      let beat = false;
      for (let i = 1; i <= steps; i += 1) {
        const f = i / steps;
        const ph = phase + (target - phase) * f;
        const prevPh = phase + (target - phase) * ((i - 1) / steps);
        if (Math.floor(prevPh - R_PEAK) !== Math.floor(ph - R_PEAK)) beat = true;
        const py = yOf(ecgAt(ph));
        let px = x + dx * f - offset;
        if (offset === 0 && px >= width) {
          // Crossing the right edge: finish this stroke there and carry on from just off the left edge.
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(prevPx - width, y);
          offset = width;
          px -= width;
        }
        ctx.lineTo(px, py);
        prevPx = px;
        y = py;
      }
      ctx.stroke();
      x = (x + dx) % width;
      phase = target;
      if (head) head.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (beat) beatRef.current?.();
    };

    const start = () => {
      if (raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            if (visible) start();
            else stop();
          });
    io?.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    if (head) {
      head.style.transform = `translate(0px, ${y.toFixed(1)}px)`;
      head.style.opacity = '1';
    }
    start();
    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [width, height, seconds, reduced]);

  return (
    <span aria-hidden className={cn('relative block shrink-0', className)} style={{ width, height }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <span
        ref={headRef}
        className="pointer-events-none absolute -left-[3px] -top-[3px] size-1.5 rounded-full bg-white opacity-0 shadow-[0_0_8px_2px_rgba(52,211,153,0.9)]"
      />
    </span>
  );
}

export interface VitalsStripProps {
  /** Trace size in px. */
  width?: number;
  height?: number;
  className?: string;
  /** Show the "HR" caption before the rate. */
  caption?: boolean;
}

/**
 * The twin's live vital sign: ♥ (pulses on every R peak) · sweeping ECG · "78 bpm". The rate is the patient's
 * recorded pulse rate (input `PR`); the trace is schematic, so the strip says so in its accessible name.
 */
export function VitalsStrip({ width = 120, height = 28, className, caption = true }: VitalsStripProps) {
  const pr = usePatientStore((s) => s.features.PR);
  const rate = displayRate(pr);
  const heartRef = useRef<SVGSVGElement>(null);
  const pulse = () => {
    const el = heartRef.current;
    if (el && typeof el.animate === 'function') {
      el.animate([{ transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  };
  return (
    <div
      role="img"
      aria-label={rate !== null ? `Heart rate ${rate} beats per minute (recorded); schematic ECG trace` : 'Schematic ECG trace'}
      className={cn('flex items-center gap-2', className)}
    >
      <HeartPulse
        ref={heartRef}
        aria-hidden
        className="size-4 shrink-0 stroke-[1.75] text-ecg drop-shadow-[0_0_6px_rgba(52,211,153,0.7)]"
      />
      <EcgTrace width={width} height={height} onBeat={pulse} />
      <span aria-hidden className="flex items-baseline gap-1 whitespace-nowrap">
        {caption && <span className="eyebrow text-tertiary">HR</span>}
        <span className="font-numeral text-numeral-label text-primary">{rate ?? '–'}</span>
        <span className="text-label font-normal text-tertiary">bpm</span>
      </span>
    </div>
  );
}
