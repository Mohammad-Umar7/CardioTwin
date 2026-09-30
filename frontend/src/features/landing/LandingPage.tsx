import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSchemaIndex } from '@/hooks/useData';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { ROUTES, loadWorkstation } from '@/routes';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { startGuidedDemo } from '@/features/tour/tourApi';
import { waitForStage } from '@/features/tour/waitFor';
import { HeroCopy } from './HeroCopy';
import { HeroHud, HeroPoster } from './HeroHud';
import { DataAnatomyCard, IntendedUseCard } from './InfoCards';
import { KpiStrip } from './KpiStrip';
import { Pillars, type LandingDestination } from './Pillars';
import { useAttractMode } from './useAttractMode';
import { useHeroInsets, useLandingChrome, useLeaveTransition } from './useLandingStage';

/**
 * Landing, "the heart unboxed" (WORKSTATION_V2 §6.1–6.2).
 *
 * The hero is the stage itself: the persistent canvas fills the same rectangle the workstation uses
 * (between the top bar and the status line), the copy floats over its left edge behind a bg/app → clear
 * gradient, and the KPI strip and verb pillars are opaque bands along its bottom edge. The page publishes
 * that coverage as the stage insets, so the camera centres the heart in what is left. "Open the
 * workstation" plays the copy exit and changes route; the canvas keeps its size, the camera glides to
 * the workstation home, and the labels hand their % over to the Risk card as the chrome preset changes.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const bandsRef = useRef<HTMLDivElement>(null);
  const schema = useSchemaIndex();
  const vessels = useMemo(() => schema?.vessels.map((t) => t.id) ?? ['LAD', 'LCX', 'RCA'], [schema]);
  const tourOpen = useUiStore((s) => s.tourOpen);
  const hasPrediction = usePatientStore((s) => s.prediction !== null);
  const { leaving, leave } = useLeaveTransition(reduced);

  useLandingChrome();
  useHeroInsets(heroRef, bandsRef);
  const attract = useAttractMode(heroRef, vessels, !reduced && !tourOpen && !leaving && hasPrediction);

  useEffect(() => {
    // Same canvas, same patient: preload the workstation chunk so the glide never waits on the network.
    void loadWorkstation();
  }, []);

  const go = (destination: LandingDestination) =>
    leave(() => {
      window.scrollTo({ top: 0 });
      navigate(destination.to);
      const after = destination.after;
      if (after && !destination.to.startsWith(ROUTES.performance)) {
        void waitForStage('workstation').then((ok) => ok && after());
      }
    });

  return (
    <div className="flex w-full flex-col">
      <section
        ref={heroRef}
        aria-labelledby="hero-title"
        data-region="landing-hero"
        className="relative flex flex-col min-[1100px]:block min-[1100px]:h-[calc(100svh-var(--topbar-h)-var(--status-h))] min-[1100px]:min-h-[600px]"
      >
        <CanvasSlot
          stage="hero"
          className="h-[56svh] min-h-[340px] min-[1100px]:!absolute min-[1100px]:inset-0 min-[1100px]:h-auto min-[1100px]:min-h-0"
          placeholder={<HeroPoster />}
        >
          <HeroHud attract={attract} vessels={vessels} leaving={leaving} />
        </CanvasSlot>

        <div
          className="relative z-panels px-6 pb-8 pt-8 min-[1100px]:pointer-events-none min-[1100px]:absolute min-[1100px]:inset-x-0 min-[1100px]:top-0 min-[1100px]:flex min-[1100px]:items-center min-[1100px]:py-0 min-[1100px]:pl-[clamp(24px,5.4vw,88px)]"
          style={{ bottom: 'var(--landing-bands-h, 0px)' }}
        >
          <HeroCopy
            leaving={leaving}
            className="min-[1100px]:pointer-events-auto min-[1100px]:w-[40%] min-[1100px]:max-w-[580px] min-[1100px]:pb-4"
            onOpenWorkstation={() => go({ to: ROUTES.workstation })}
            onGuidedDemo={() => leave(() => startGuidedDemo(navigate, `${location.pathname}${location.search}`))}
          />
        </div>

        <div
          ref={bandsRef}
          data-region="landing-bands"
          className={cn(
            'relative z-panels border-t border-hairline bg-app transition-[opacity,transform] duration-base min-[1100px]:absolute min-[1100px]:inset-x-0 min-[1100px]:bottom-0',
            // Soft edge: the stage melts into the bands instead of ending on a hard line.
            'min-[1100px]:before:pointer-events-none min-[1100px]:before:absolute min-[1100px]:before:inset-x-0 min-[1100px]:before:bottom-full min-[1100px]:before:h-16 min-[1100px]:before:bg-gradient-to-t min-[1100px]:before:from-app min-[1100px]:before:to-transparent',
            leaving ? 'translate-y-2 opacity-0 ease-exit' : 'ease-out',
          )}
        >
          <KpiStrip />
          <Pillars onNavigate={go} className="border-t border-hairline" />
        </div>
      </section>

      <section
        aria-label="Intended use and sources"
        className="mx-auto grid w-full max-w-[1248px] grid-cols-1 gap-4 px-6 pb-12 pt-10 md:grid-cols-2"
      >
        <IntendedUseCard />
        <DataAnatomyCard />
      </section>
    </div>
  );
}
