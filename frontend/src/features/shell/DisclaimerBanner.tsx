import { Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/state/uiStore';

export const DISCLAIMER_TEXT =
  'Decision support & education only — not a diagnosis; not a substitute for angiography, CTCA or formal diagnostic imaging.';

/**
 * Status line (DESIGN_SYSTEM §9): permanent on every route, never dismissible, never animated, never
 * yellow or red, never a modal. z-index 90 keeps it above the tour scrim and flyouts; fullscreen targets
 * the app container, so it stays visible. Wraps to two lines on narrow screens.
 */
export function StatusLine() {
  const openDetails = useUiStore((s) => s.openDetails);
  const seen = useUiStore((s) => s.disclaimerAccepted);
  return (
    <footer
      role="contentinfo"
      aria-label="Clinical safety disclaimer"
      data-tour="status-line"
      className="fixed inset-x-0 bottom-0 z-status flex min-h-[var(--status-h)] items-center border-t border-hairline bg-app px-3 py-0.5 min-[1440px]:px-4"
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-label font-normal text-secondary">
        <Info aria-hidden className="size-3.5 shrink-0 stroke-[1.5] text-secondary" />
        <p className="min-w-0 flex-1">
          Decision support &amp; education only — <strong className="font-medium text-primary">not a diagnosis</strong>;
          not a substitute for angiography, CTCA or formal diagnostic imaging.
        </p>
        <span className="hidden whitespace-nowrap text-tertiary min-[1100px]:inline">
          Vessel-level risk · no lesion localisation
        </span>
        <button
          type="button"
          onClick={openDetails}
          className={cn(
            'relative whitespace-nowrap rounded-sm px-1 text-label font-medium text-secondary underline-offset-2 hover:text-primary hover:underline',
          )}
        >
          Details ›
          {!seen && <span aria-hidden className="absolute -right-0.5 top-0 size-1 rounded-full bg-accent" />}
        </button>
      </div>
    </footer>
  );
}

/** Alias kept for the component inventory in the original brief (DisclaimerBanner = status line). */
export const DisclaimerBanner = StatusLine;
