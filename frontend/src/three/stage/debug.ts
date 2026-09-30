/** Dev / `#…?ctdebug` only: expose the renderer and the anatomy rig on `window` for inspection. */
export function debugHandles(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return typeof location !== 'undefined' && /ctdebug/.test(location.href);
  } catch {
    return false;
  }
}
