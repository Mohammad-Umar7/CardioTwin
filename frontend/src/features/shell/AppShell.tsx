import { Suspense, lazy } from 'react';
import { Outlet } from 'react-router-dom';
import { SceneHost } from '@/three/SceneHost';
import { AppBootstrap } from './AppBootstrap';
import CommandPalette from './CommandPalette';
import { DisclaimerModal } from './DisclaimerModal';
import { RouteFallback } from './RouteFallback';
import { StatusLine } from './DisclaimerBanner';
import { Toaster } from './Toaster';
import { TopNav } from './TopNav';

const TourLayer = lazy(() => import('@/features/tour/TourLayer'));
const ShortcutSheet = lazy(() => import('./ShortcutSheet'));

/**
 * App shell: skip link → top bar → routed page → permanent status line (DESIGN_SYSTEM §9).
 * The single persistent 3D canvas is owned here (SceneHost) and moved into whichever page renders a
 * <CanvasSlot/>, so routes change the camera, never the WebGL context.
 */
export function AppShell() {
  return (
    <div id="app" className="relative flex min-h-screen flex-col bg-app text-primary">
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
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <StatusLine />
      <SceneHost />
      <AppBootstrap />
      <DisclaimerModal />
      <Toaster />
      <CommandPalette />
      <Suspense fallback={null}>
        <TourLayer />
        <ShortcutSheet />
      </Suspense>
    </div>
  );
}
