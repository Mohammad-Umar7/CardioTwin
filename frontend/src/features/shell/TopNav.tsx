import { HelpCircle } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Button, HairlineProgress } from '@/design';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { ROUTES, loadWorkstation } from '@/routes';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EngineBadge } from './EngineBadge';
import { PatientChip } from './PatientChip';

const NAV = [
  { to: ROUTES.workstation, label: 'Workstation', short: 'Workstation' },
  { to: ROUTES.performance, label: 'Model performance', short: 'Performance' },
  { to: ROUTES.methodology, label: 'Methodology', short: 'Method' },
] as const;

/** Brand mark: a rotated square outline with a heartbeat trace (◆). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-5', className)} fill="none">
      <path d="M16 3.5 28.5 16 16 28.5 3.5 16Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" className="text-accent" />
      <path
        d="M10 16.5h3.4l1.5-3.6 2.6 6.6 1.6-3h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
    </svg>
  );
}

/**
 * AppBar (DESIGN_SYSTEM §5): h 48 (40 below 1440), bg/app, bottom hairline. Nav tabs get a 2 px accent
 * underline when active. The patient chip is hidden on the landing page. A 1 px indeterminate accent
 * bar appears under the bar only while a prediction takes longer than 150 ms ("Verifying").
 */
export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const onLanding = location.pathname === ROUTES.landing;
  const loading = usePatientStore((s) => s.status === 'loading');
  const showProgress = useDelayedFlag(loading, 150);
  const openTour = useUiStore((s) => s.openTour);

  const startTour = () => {
    if (location.pathname !== ROUTES.workstation) {
      void loadWorkstation();
      navigate(ROUTES.workstation);
    }
    openTour(0);
  };

  return (
    <header className="sticky top-0 z-panels h-[var(--topbar-h)] shrink-0 border-b border-hairline bg-app">
      <div className="flex h-full items-center gap-2 px-3 min-[1440px]:px-4">
        <NavLink
          to={ROUTES.landing}
          className="mr-2 flex items-center gap-2 rounded-sm px-1 py-1 text-title-2 text-primary"
          aria-label="CardioTwin home"
        >
          <BrandMark />
          <span className="font-display tracking-[-0.02em]">CardioTwin</span>
        </NavLink>

        <nav aria-label="Primary" className="flex h-full items-stretch">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onMouseEnter={item.to === ROUTES.workstation ? () => void loadWorkstation() : undefined}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center px-3 text-body-s font-medium transition-colors duration-fast',
                  isActive ? 'text-primary' : 'text-secondary hover:text-primary',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="hidden min-[1280px]:inline">{item.label}</span>
                  <span className="min-[1280px]:hidden">{item.short}</span>
                  <span
                    aria-hidden
                    className={cn('absolute inset-x-3 bottom-0 h-0.5 rounded-full', isActive ? 'bg-accent' : 'bg-transparent')}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!onLanding && <PatientChip />}
          <EngineBadge />
          {onLanding ? (
            <Button variant="secondary" size="sm" onClick={startTour} className="hidden sm:inline-flex">
              Start 90-s tour
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={startTour}
              iconLeft={<HelpCircle className="stroke-[1.5]" />}
              data-tour="tour-button"
            >
              Tour
            </Button>
          )}
        </div>
      </div>
      {showProgress && (
        <HairlineProgress label="Verifying the estimate" className="absolute inset-x-0 -bottom-px" />
      )}
    </header>
  );
}
