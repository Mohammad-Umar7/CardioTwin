import { CircleHelp, Play, Search } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Button, HairlineProgress, IconButton, Shortcut, withShortcut } from '@/design';
import { startGuidedDemo } from '@/features/tour/tourApi';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { ROUTES, loadWorkstation } from '@/routes';
import { SHORTCUT } from '@/state/commandIds';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EngineBadge } from './EngineBadge';
import { PatientChip } from './PatientChip';

/** Primary nav, shortened (V2 §5.1, §5.20): Workstation · Performance · Method. */
export const NAV = [
  { to: ROUTES.workstation, label: 'Workstation' },
  { to: ROUTES.performance, label: 'Performance' },
  { to: ROUTES.methodology, label: 'Method' },
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
 * Search field (V2 §5.1): 280 × 32, surface/1, "⌕ Search or jump to…" plus the Ctrl K / ⌘K chip. It is a
 * button that opens the command palette; below 1440 it collapses to a 32 px icon button.
 */
function SearchTrigger() {
  const open = () => useUiStore.getState().setPaletteOpen(true);
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K /"
        className={cn(
          'hidden h-8 w-[280px] items-center gap-2 rounded-sm border border-line bg-surface-1 pl-2.5 pr-1.5 text-left',
          'text-body-s text-tertiary transition-colors duration-instant hover:border-line-strong hover:text-secondary',
          'min-[1440px]:inline-flex',
        )}
      >
        <Search aria-hidden className="size-4 shrink-0 stroke-[1.5]" />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <span aria-hidden>
          <Shortcut shortcut="Mod+K" />
        </span>
      </button>
      <IconButton
        label="Search or jump to"
        tooltip={withShortcut('Search or jump to…', SHORTCUT.palette)}
        icon={<Search />}
        size="md"
        onClick={open}
        aria-haspopup="dialog"
        className="min-[1440px]:hidden"
      />
    </>
  );
}

/**
 * Top bar v2 (WORKSTATION_V2 §5.1): h 48 (40 below 1440), bg/app, bottom hairline. Brand · nav
 * (13/18 500, 2 px accent underline on the active item) · centred search · PatientChip · EngineDot ·
 * Guided demo (ghost, ▶; "Demo" below 1440) · ? (shortcut sheet). On the landing page the chip, the
 * search, the demo button and ? are hidden: the hero owns the one tour entry (V2 §6.1). A 1 px
 * indeterminate accent hairline runs under the bar only while a prediction takes longer than 150 ms.
 */
export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const onLanding = location.pathname === ROUTES.landing;
  const loading = usePatientStore((s) => s.status === 'loading');
  const showProgress = useDelayedFlag(loading, 150);

  return (
    <header data-region="topbar" className="sticky top-0 z-panels h-[var(--topbar-h)] shrink-0 border-b border-hairline bg-app">
      <div className="flex h-full items-center gap-2 px-3 min-[1440px]:px-4">
        <NavLink
          to={ROUTES.landing}
          className="mr-3 flex shrink-0 items-center gap-2 rounded-sm px-1 py-1 text-title-2 text-primary"
          aria-label="CardioTwin home"
        >
          <BrandMark />
          <span className="font-display tracking-[-0.02em]">CardioTwin</span>
        </NavLink>

        <nav aria-label="Primary" className="flex h-full shrink-0 items-stretch">
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
                  {item.label}
                  <span
                    aria-hidden
                    className={cn('absolute inset-x-3 bottom-0 h-0.5 rounded-full', isActive ? 'bg-accent' : 'bg-transparent')}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 justify-center px-2">{!onLanding && <SearchTrigger />}</div>

        <div className="flex shrink-0 items-center gap-1.5 min-[1440px]:gap-2">
          {!onLanding && <PatientChip />}
          <EngineBadge />
          {!onLanding && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startGuidedDemo(navigate, `${location.pathname}${location.search}`)}
                iconLeft={<Play className="stroke-[1.5]" />}
                data-tour="tour-button"
                aria-label="Guided demo"
              >
                <span className="hidden min-[1440px]:inline">Guided demo</span>
                <span className="min-[1440px]:hidden">Demo</span>
              </Button>
              <IconButton
                label="Keyboard shortcuts"
                tooltip={withShortcut('Keyboard shortcuts', SHORTCUT.shortcuts)}
                icon={<CircleHelp />}
                size="md"
                onClick={() => useUiStore.getState().setShortcutsOpen(true)}
                aria-haspopup="dialog"
              />
            </>
          )}
        </div>
      </div>
      {showProgress && <HairlineProgress label="Verifying the estimate" className="absolute inset-x-0 -bottom-px" />}
    </header>
  );
}
