import { motion } from 'framer-motion';
import { CircleHelp, Play, Search } from 'lucide-react';
import { useId, type MouseEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Button, HairlineProgress, IconButton, Shortcut, withShortcut } from '@/design';
import { enterWorkstationFromLanding } from '@/features/landing/entry';
import { startGuidedDemo } from '@/features/tour/tourApi';
import { useDelayedFlag, useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { ROUTES, loadWorkstation } from '@/routes';
import { SHORTCUT } from '@/state/commandIds';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { SPRING } from '@/theme/tokens';
import { EngineBadge } from './EngineBadge';
import { PatientChip } from './PatientChip';

/** Primary nav, shortened (V2 §5.1, §5.20): Workstation · Performance · Method. */
export const NAV = [
  { to: ROUTES.workstation, label: 'Workstation' },
  { to: ROUTES.performance, label: 'Performance' },
  { to: ROUTES.methodology, label: 'Method' },
] as const;

/**
 * Brand mark: a rotated square outline with a heartbeat trace (◆). LUMEN 2: the outline is lit with the
 * accent gradient and the trace re-draws once a second like a monitor sweep (a physiology loop; still under
 * reduced motion).
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-5 overflow-visible', className)} fill="none">
      <defs>
        <linearGradient id={`bm-${id}`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9BE4F7" />
          <stop offset="0.55" stopColor="#56C2E6" />
          <stop offset="1" stopColor="#7AA8FF" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5 28.5 16 16 28.5 3.5 16Z"
        stroke={`url(#bm-${id})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 3px rgba(86,194,230,0.55))' }}
      />
      <path
        d="M10 16.5h3.4l1.5-3.6 2.6 6.6 1.6-3h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
      <path
        d="M10 16.5h3.4l1.5-3.6 2.6 6.6 1.6-3h3"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="brand-trace"
        style={{ filter: 'drop-shadow(0 0 2.5px rgba(52,211,153,0.9))' }}
      />
    </svg>
  );
}

/** Primary nav item; the active page wears a glass pill that glides between items (LUMEN 2). */
function NavItem({
  to,
  label,
  onMouseEnter,
  onClick,
}: {
  to: string;
  label: string;
  onMouseEnter?: () => void;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const reduced = useIsReducedMotion();
  return (
    <NavLink
      to={to}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'relative flex items-center px-3 text-body-s font-medium transition-colors duration-fast max-[899.98px]:px-2',
          isActive ? 'text-primary' : 'text-secondary hover:text-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              aria-hidden
              layoutId="topnav-active"
              transition={reduced ? { duration: 0 } : SPRING.indicator}
              className="absolute inset-x-0.5 inset-y-[7px] -z-10 rounded-md bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
              <span className="absolute inset-x-3 -bottom-[7px] h-0.5 rounded-full bg-accent shadow-[0_0_12px_rgba(86,194,230,0.9)]" />
            </motion.span>
          )}
          {label}
        </>
      )}
    </NavLink>
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
          'hidden h-8 w-[300px] items-center gap-2 rounded-md bg-white/[0.04] pl-2.5 pr-1.5 text-left',
          'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.04)]',
          'text-body-s text-tertiary transition-[color,background-color,box-shadow] duration-fast ease-out',
          'hover:bg-white/[0.07] hover:text-secondary hover:shadow-[inset_0_0_0_1px_rgba(86,194,230,0.3),0_0_20px_-8px_rgba(86,194,230,0.6)]',
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
  // From the landing, "Workstation" plays the hero's dolly into the heart (a plain click only: a new tab or
  // window opens the route as usual).
  const enterFromLanding = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (enterWorkstationFromLanding()) event.preventDefault();
  };

  return (
    <header
      data-region="topbar"
      className={cn(
        // LUMEN 2: a glass bar (the stage and the ambient light show through) with a lit hairline below.
        'sticky top-0 z-panels h-[var(--topbar-h)] shrink-0 border-b border-white/[0.06] bg-app/75 backdrop-blur-xl backdrop-saturate-150',
        'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-px',
        'after:bg-[linear-gradient(90deg,transparent_5%,rgba(86,194,230,0.35)_30%,rgba(129,140,248,0.3)_70%,transparent_95%)]',
      )}
    >
      <div className="flex h-full items-center gap-2 px-3 min-[1440px]:px-4">
        <NavLink
          to={ROUTES.landing}
          className="group/brand mr-3 flex shrink-0 items-center gap-2.5 rounded-sm px-1 py-1 text-title-2 text-primary"
          aria-label="CardioTwin home"
        >
          <span className="relative grid size-7 place-items-center rounded-md bg-[linear-gradient(145deg,rgba(86,194,230,0.16),rgba(129,140,248,0.08))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_0_18px_-6px_rgba(86,194,230,0.7)] transition-shadow duration-base group-hover/brand:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),0_0_24px_-4px_rgba(86,194,230,0.9)]">
            <BrandMark />
          </span>
          <span className="font-display tracking-[-0.02em] max-[899.98px]:sr-only">
            Cardio<span className="text-gradient-accent">Twin</span>
          </span>
        </NavLink>

        <nav aria-label="Primary" className="isolate flex h-full shrink-0 items-stretch max-[639.98px]:hidden">
          {NAV.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              label={item.label}
              onMouseEnter={item.to === ROUTES.workstation ? () => void loadWorkstation() : undefined}
              onClick={item.to === ROUTES.workstation && onLanding ? enterFromLanding : undefined}
            />
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
                <span className="hidden min-[1100px]:max-[1439.98px]:inline">Demo</span>
              </Button>
              <IconButton
                label="Keyboard shortcuts"
                tooltip={withShortcut('Keyboard shortcuts', SHORTCUT.shortcuts)}
                icon={<CircleHelp />}
                size="md"
                onClick={() => useUiStore.getState().setShortcutsOpen(true)}
                aria-haspopup="dialog"
                className="max-[639.98px]:hidden"
              />
            </>
          )}
        </div>
      </div>
      {showProgress && <HairlineProgress label="Verifying the estimate" className="absolute inset-x-0 -bottom-px" />}
    </header>
  );
}
