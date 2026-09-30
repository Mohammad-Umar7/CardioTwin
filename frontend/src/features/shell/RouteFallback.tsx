import { HairlineProgress } from '@/design';

/** Shown while a route chunk loads: a 1 px accent hairline, no spinner (DESIGN_SYSTEM §6). */
export function RouteFallback() {
  return (
    <div className="relative flex-1" aria-busy="true">
      <HairlineProgress label="Loading page" className="absolute inset-x-0 top-0" />
    </div>
  );
}
