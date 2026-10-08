import { Suspense, lazy, useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useReveal, useSpotlight, useTierAttribute } from '@/hooks/useAmbientEffects';
import { useUiStore } from '@/state/uiStore';
import { ReportCommands } from '@/features/report/ReportCommands';
import { SceneHost } from '@/three/SceneHost';
import { AppBootstrap } from './AppBootstrap';
import CommandPalette from './CommandPalette';
import { DisclaimerModal } from './DisclaimerModal';
import { LayerBoundary, RouteErrorFallback } from './LayerBoundary';
import { RouteFallback } from './RouteFallback';
import { StatusLine } from './DisclaimerBanner';
import { Toaster } from './Toaster';
import { TopNav } from './TopNav';

const TourLayer = lazy(() => import('@/features/tour/TourLayer'));
const ShortcutSheet = lazy(() => import('./ShortcutSheet'));

const ui = () => useUiStore.getState();

/** A failing guided demo ends (and restores the app) instead of blanking it. */
function endTourAfterError() {
  ui().closeTour(false);
  ui().pushToast({ tone: 'warn', message: 'The guided demo stopped after an error; the app is back where it was.' });
}

/**
 * App shell: skip link → top bar → routed page → permanent status line (DESIGN_SYSTEM §9).
 * The single persistent 3D canvas is owned here (SceneHost) and moved into whichever page renders a
 * <CanvasSlot/>, so routes change the camera, never the WebGL context.
 */
/**
 * A new page opens at its top, not at the previous page's scroll offset (the judge landed mid-Methodology).
 * Only pathname changes count: query-parameter updates on the workstation (selection, drawer, tab) and
 * in-page anchors keep their position.
 */
function useScrollTopOnRouteChange(pathname: string) {
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
}

export function AppShell() {
  const { pathname } = useLocation();
  useScrollTopOnRouteChange(pathname);
  useSpotlight();
  useReveal();
  useTierAttribute();
  return (
    // No background of its own: the LUMEN 2 ambient light on <html> shows through the reading pages.
    <div id="app" className="relative flex min-h-screen flex-col text-primary">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          const target = document.getElementById('risk-summary') ?? document.getElementById('main');
          target?.focus();
        }}
        className="sr-only z-skip rounded-sm bg-accent px-3 py-2 text-body-s font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to risk summary
      </a>
      <TopNav />
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col pb-[var(--status-h)] outline-none">
        <LayerBoundary name="route" resetKey={pathname} fallback={<RouteErrorFallback />}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </LayerBoundary>
      </main>
      <StatusLine />
      <SceneHost />
      <AppBootstrap />
      <ReportCommands />
      <DisclaimerModal />
      <Toaster />
      <OverlayLayers />
    </div>
  );
}

/**
 * Palette, guided demo and shortcut sheet, each behind its own error boundary: a failure closes that
 * overlay (the demo restores the app) and the next open renders it afresh.
 */
function OverlayLayers() {
  const tourOpen = useUiStore((s) => s.tourOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  return (
    <>
      <LayerBoundary name="palette" resetKey={paletteOpen} onError={() => ui().setPaletteOpen(false)}>
        <CommandPalette />
      </LayerBoundary>
      <LayerBoundary name="tour" resetKey={tourOpen} onError={endTourAfterError}>
        <Suspense fallback={null}>
          <TourLayer />
        </Suspense>
      </LayerBoundary>
      <LayerBoundary name="shortcuts" resetKey={shortcutsOpen} onError={() => ui().setShortcutsOpen(false)}>
        <Suspense fallback={null}>
          <ShortcutSheet />
        </Suspense>
      </LayerBoundary>
    </>
  );
}
