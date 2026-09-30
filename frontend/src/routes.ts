/** Route paths and lazy page loaders (kept separate from router.tsx so loaders can be preloaded). */
export const ROUTES = {
  landing: '/',
  workstation: '/workstation',
  performance: '/performance',
  methodology: '/methodology',
} as const;

export const loadLanding = () => import('@/features/landing/LandingPage');
export const loadWorkstation = () => import('@/features/workstation/WorkstationPage');
export const loadPerformance = () => import('@/features/performance/PerformancePage');
export const loadMethodology = () => import('@/features/methodology/MethodologyPage');
