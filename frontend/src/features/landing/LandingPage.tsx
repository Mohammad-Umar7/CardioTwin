import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { loadWorkstation } from '@/routes';
import { startGuidedDemo } from '@/features/tour/tourApi';
import { registerWorkstationEntry } from './entry';
import { EvidenceSection } from './EvidenceSection';
import { HeroCopy } from './HeroCopy';
import { HeroStage } from './HeroStage';
import { useEnterWorkstation } from './useEnterWorkstation';
import { useHeroInsets, useLandingChrome } from './useLandingStage';

/**
 * Landing: one cinematic hero and a short evidence section.
 *
 * The hero is the stage itself: on wide screens the persistent canvas fills the same rectangle the workstation
 * stage uses (between the top bar and the status line), showing the upper torso with the heart inside it; the
 * copy sits over its left edge behind a plain veil and publishes that coverage as the stage insets, so the camera
 * centres the torso in the rest. "Enter Workstation" (or the top bar's Workstation link) plays the dolly into the
 * heart and opens the existing workstation on the same canvas (useEnterWorkstation). Below 1024 px the hero
 * stacks: the copy, then the stage.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { leaving, enter, leave } = useEnterWorkstation(stageRef);

  useLandingChrome();
  useHeroInsets(heroRef, copyRef);

  useEffect(() => {
    // Preload the workstation chunk so the route change at the end of the dolly never waits on the network. A
    // failed preload is harmless; the route's own lazy import retries on navigation.
    loadWorkstation().catch(() => undefined);
  }, []);

  useEffect(() => registerWorkstationEntry(enter), [enter]);

  const cinematic = leaving === 'cinematic';

  return (
    <div className="flex w-full flex-col bg-void">
      <section
        ref={heroRef}
        aria-labelledby="hero-title"
        data-region="landing-hero"
        className="relative isolate flex flex-col lg:block lg:h-[calc(100vh-var(--topbar-h)-var(--status-h))] lg:min-h-[560px]"
      >
        <div ref={stageRef} className="relative order-2 h-[56svh] min-h-[340px] max-h-[620px] lg:absolute lg:inset-0 lg:h-auto lg:max-h-none">
          <HeroStage className="absolute inset-0" />
        </div>

        {/* Plain veils, no light: the copy's contrast on wide screens, and the torso's crop under the rib cage. Both
            clear with the copy as the camera moves in, so the workstation's first frame has nothing over it. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-hud hidden w-[62%] transition-opacity ease-out lg:block',
            cinematic ? 'opacity-0 duration-[700ms]' : 'duration-base',
          )}
          style={{
            background:
              'linear-gradient(90deg, rgb(var(--c-bg-void)) 0%, rgb(var(--c-bg-void) / 0.94) 38%, rgb(var(--c-bg-void) / 0.6) 62%, rgb(var(--c-bg-void) / 0) 100%)',
          }}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-hud h-[18%] min-h-[72px] transition-opacity ease-out',
            cinematic ? 'opacity-0 duration-[900ms]' : 'duration-base',
          )}
          style={{ background: 'linear-gradient(0deg, rgb(var(--c-bg-void)) 0%, rgb(var(--c-bg-void) / 0) 100%)' }}
        />

        <div
          ref={copyRef}
          className="relative z-panels order-1 px-5 pb-5 pt-8 sm:px-8 sm:pb-8 sm:pt-14 lg:pointer-events-none lg:absolute lg:inset-y-0 lg:left-0 lg:flex lg:w-[50%] lg:max-w-[760px] lg:items-center lg:py-0 lg:pl-[clamp(40px,6.4vw,120px)] lg:pr-0"
        >
          <HeroCopy
            leaving={leaving}
            onEnter={enter}
            onGuidedDemo={() => leave(() => startGuidedDemo(navigate, `${location.pathname}${location.search}`))}
            className="lg:pointer-events-auto lg:pb-6"
          />
        </div>
      </section>

      <EvidenceSection />
    </div>
  );
}
