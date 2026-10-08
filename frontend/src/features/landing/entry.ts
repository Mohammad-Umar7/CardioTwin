/**
 * The landing's way into the workstation, reachable from outside the page: the top bar's "Workstation" link
 * plays the same dolly as the hero's call to action while the landing is mounted. Kept free of imports so the
 * shell can read it without loading the landing.
 */
type Enter = () => boolean;

let current: Enter | null = null;

/** The landing registers its entry while mounted; returns the unregister function. */
export function registerWorkstationEntry(enter: Enter): () => void {
  current = enter;
  return () => {
    if (current === enter) current = null;
  };
}

/** Runs the landing's entry when one is registered. True = it took over the navigation. */
export function enterWorkstationFromLanding(): boolean {
  return current ? current() : false;
}
