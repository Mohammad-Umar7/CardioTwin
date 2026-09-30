import { Info } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { routeShowsAnatomy } from '@/routes';
import { useUiStore } from '@/state/uiStore';

export const DISCLAIMER_TEXT =
  'Decision support & education only — not a diagnosis; not a substitute for angiography, CTCA or formal diagnostic imaging.';

/** Anatomy credit (BodyParts3D licence), shown on every route that shows anatomy (V2 §5.17). */
export const ANATOMY_CREDIT = 'BodyParts3D © DBCLS · CC BY-SA 2.1 JP';

/**
 * Status line v2 (WORKSTATION_V2 §5.17, DESIGN_SYSTEM §9): permanent on every route, never dismissible,
 * never animated, never yellow or red, never a modal; z 90 keeps it above the tour scrim and the drawers,
 * and full screen targets the app container, so it stays visible.
 *   Left:  (i) + the LUMEN wording, "not a diagnosis" in text/primary 500. Below 1280 the sentence keeps
 *          "not a diagnosis" and drops the substitute clause (it stays in Details).
 *   Right: "Vessel-level risk · no lesion localisation" whenever it fits beside the full sentence (1280 and
 *          up; it wraps out of the one-line row rather than truncate the disclaimer, and always lives in
 *          Details and the legend chip), the anatomy credit (11 px, text/tertiary, anatomy routes only), then
 *          "Details ›".
 * One line at h 28 (24 below 1440); below 1100 it may wrap.
 */
export function StatusLine() {
  const openDetails = useUiStore((s) => s.openDetails);
  const seen = useUiStore((s) => s.disclaimerAccepted);
  const { pathname } = useLocation();
  const anatomy = routeShowsAnatomy(pathname);

  return (
    <footer
      role="contentinfo"
      aria-label="Clinical safety disclaimer"
      data-region="status-line"
      data-tour="status-line"
      className="fixed inset-x-0 bottom-0 z-status flex min-h-[var(--status-h)] items-center border-t border-hairline bg-app px-3 min-[1440px]:px-4"
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5 text-label font-normal text-secondary min-[1100px]:flex-nowrap min-[1440px]:gap-x-4">
        <p className="flex min-w-0 flex-1 items-center gap-2 max-[1099.98px]:basis-full min-[1100px]:flex-initial">
          <Info aria-hidden className="size-3.5 shrink-0 stroke-[1.5]" />
          <span className="min-w-0 min-[1100px]:truncate">
            Decision support &amp; education only — <strong className="font-medium text-primary">not a diagnosis</strong>
            <span className="max-[1279.98px]:sr-only">; not a substitute for angiography, CTCA or formal diagnostic imaging</span>.
          </span>
        </p>
        {/* Takes the room the sentence leaves and shows the cue only when all of it fits (a container query in
            globals.css), so neither the cue nor the disclaimer is ever truncated. */}
        <span className="status-cue hidden min-w-0 flex-1 justify-end min-[1100px]:flex">
          <span className="whitespace-nowrap text-tertiary">Vessel-level risk · no lesion localisation</span>
        </span>
        {anatomy && (
          <span data-region="credits" className="whitespace-nowrap text-[0.6875rem] leading-4 text-tertiary">
            {ANATOMY_CREDIT}
          </span>
        )}
        <button
          type="button"
          onClick={openDetails}
          className="relative -mx-1 whitespace-nowrap rounded-sm px-1 text-label font-medium text-secondary underline-offset-2 hover:text-primary hover:underline"
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
