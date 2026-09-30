import { ArrowRight, Play } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/design';
import { ROUTES, loadWorkstation } from '@/routes';
import { useUiStore } from '@/state/uiStore';
import { CanvasSlot } from '@/three/CanvasSlot';
import { DataAnatomyCard, IntendedUseCard } from './InfoCards';
import { HeroHud, HeroPoster } from './HeroHud';
import { KpiStrip } from './KpiStrip';
import { Pillars } from './Pillars';
import { useSchema } from '@/hooks/useData';

/**
 * Landing (DESIGN_SYSTEM §4.1): 12 columns, 1200 px max, 5/7 hero split, fits above the fold at
 * 1440×900. The hero is the real engine on a held-out TEST patient (tier B, turntable 6°/s).
 * KPI values come from metrics.json / schema.json and are never hard-coded.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const openTour = useUiStore((s) => s.openTour);
  const schema = useSchema();
  const nInputs = schema.data?.features.length;

  useEffect(() => {
    // The CTA keeps the same canvas; preload the workstation chunk so the glide never waits on a network hop.
    void loadWorkstation();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1248px] flex-col gap-6 px-6 pb-8 pt-8 min-[1440px]:pt-10">
      <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12" aria-labelledby="hero-title">
        <div className="flex flex-col justify-center gap-5 py-2 lg:col-span-5 animate-rise-in">
          <p className="overline text-accent">Coronary risk, vessel by vessel</p>
          <h1 id="hero-title" className="font-display text-[2.5rem] font-semibold leading-[2.75rem] tracking-[-0.03em] text-primary min-[1440px]:text-display-1">
            An explainable coronary digital twin.
          </h1>
          <p className="max-w-[34rem] text-body text-secondary min-[1440px]:text-[0.9375rem] min-[1440px]:leading-6">
            Predicts overall coronary artery disease (CAD) and stenosis of the{' '}
            <abbr title="Left anterior descending artery">LAD</abbr> · <abbr title="Left circumflex artery">LCX</abbr> ·{' '}
            <abbr title="Right coronary artery">RCA</abbr> from {nInputs ?? 'routine'} routine clinical inputs, explains every
            estimate with exact SHAP, and maps it onto real BodyParts3D anatomy.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              iconRight={<ArrowRight className="stroke-[1.75]" />}
              onClick={() => navigate(ROUTES.workstation)}
            >
              Open workstation
            </Button>
            <Button
              variant="secondary"
              size="lg"
              iconLeft={<Play className="stroke-[1.75]" />}
              onClick={() => {
                navigate(ROUTES.workstation);
                openTour(0);
              }}
            >
              90-s tour
            </Button>
          </div>
          <p className="text-label font-normal text-tertiary">Opens on a held-out test patient. No login.</p>
        </div>

        <CanvasSlot
          stage="hero"
          className="h-[420px] rounded-lg border border-hairline lg:col-span-7 min-[1440px]:h-[440px]"
          placeholder={<HeroPoster />}
        >
          <HeroHud />
        </CanvasSlot>
      </section>

      <KpiStrip />
      <Pillars />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Intended use and sources">
        <IntendedUseCard />
        <DataAnatomyCard />
      </section>
    </div>
  );
}
