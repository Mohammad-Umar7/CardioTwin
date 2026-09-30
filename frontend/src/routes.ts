/** Route paths and lazy page loaders (kept separate from router.tsx so loaders can be preloaded). */
export const ROUTES = {
  landing: '/',
  workstation: '/workstation',
  performance: '/performance',
  methodology: '/methodology',
  /** Printable clinical report of the current workstation state (features/report). */
  report: '/report',
} as const;

/** Routes whose page shows the 3D anatomy (the landing hero and the workstation stage). */
export function routeShowsAnatomy(pathname: string): boolean {
  return pathname === ROUTES.landing || pathname.startsWith(ROUTES.workstation);
}

export const loadLanding = () => import('@/features/landing/LandingPage');
export const loadWorkstation = () => import('@/features/workstation/WorkstationPage');
export const loadPerformance = () => import('@/features/performance/PerformancePage');
export const loadMethodology = () => import('@/features/methodology/MethodologyPage');
export const loadReport = () => import('@/features/report/ReportPage');
