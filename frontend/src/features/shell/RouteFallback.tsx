import { useLocation } from 'react-router-dom';
import { HairlineProgress, Skeleton } from '@/design';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { ROUTES } from '@/routes';
import { assetUrl } from '@/services/staticData';

/** The workstation poster (V2 §5.18): a still of the live canvas at the workstation home pose. */
const WORKSTATION_POSTER = 'posters/workstation.webp';

function SkeletonRows({ count, height }: { count: number; height: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ height }}>
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * While the workstation chunk loads: the stage as it will look, never a blank frame (V2 §5.18, §8.6).
 * The poster fills the stage, the patient and Risk cards are skeletons at their final boxes (so nothing
 * moves when the real cards replace them: CLS 0), and a 1 px accent hairline runs along the top.
 */
function WorkstationFallback() {
  return (
    <div
      data-region="stage-fallback"
      aria-busy="true"
      className="relative overflow-clip bg-void"
      style={{ height: 'calc(100vh - var(--topbar-h) - var(--status-h))' }}
    >
      <img
        src={assetUrl(WORKSTATION_POSTER)}
        alt=""
        aria-hidden
        decoding="async"
        draggable={false}
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        className="absolute inset-0 h-full w-full select-none object-cover"
      />
      <HairlineProgress label="Loading the workstation" className="absolute inset-x-0 top-0 z-panels" />
      <div className="stage-card absolute left-[var(--stage-inset)] top-[var(--stage-inset)] flex h-[328px] w-[var(--card-left-w)] flex-col gap-2 p-[var(--card-pad)] max-[1439.98px]:h-[300px]">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-3 w-24" />
        <SkeletonRows count={5} height={32} />
        <Skeleton className="mt-1 h-8 w-full" />
      </div>
      <div className="stage-card absolute right-[var(--stage-inset)] top-[var(--stage-inset)] flex h-[450px] w-[var(--card-right-w)] flex-col gap-3 p-[var(--card-pad)] max-[1439.98px]:h-[444px]">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-12 w-28" />
        <Skeleton className="h-1 w-full" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-full" />
        <div className="mt-2 border-t border-hairline pt-3">
          <SkeletonRows count={3} height={36} />
        </div>
      </div>
    </div>
  );
}

/** Shown while a route chunk loads: a 1 px accent hairline, no spinner (DESIGN_SYSTEM §6). */
export function RouteFallback() {
  const { pathname } = useLocation();
  const mode = useLayoutMode();
  if (pathname.startsWith(ROUTES.workstation) && mode !== 'compact') return <WorkstationFallback />;
  return (
    <div className="relative flex-1" aria-busy="true">
      <HairlineProgress label="Loading page" className="absolute inset-x-0 top-0" />
    </div>
  );
}
