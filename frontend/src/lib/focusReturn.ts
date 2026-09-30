/**
 * Where keyboard focus goes back to when a transient surface (a docked drawer) closes.
 *
 * The opener is noted synchronously, at the moment the surface is asked to open: by the time the surface's
 * own effects run, the card that held the opener may already be inert (the Explain drawer hides the Risk
 * card in the same commit), and the browser has moved focus to <body>.
 */
const noted = new Map<string, HTMLElement>();

/** Notes the focused element as the opener of `surface` (ignored when nothing meaningful has focus). */
export function noteOpener(surface: string): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) noted.set(surface, active);
  else noted.delete(surface);
}

/** The opener noted for `surface` (cleared by reading it). */
export function takeOpener(surface: string): HTMLElement | null {
  const el = noted.get(surface) ?? null;
  noted.delete(surface);
  return el;
}

/** An element that can take focus right now: attached and outside inert or hidden subtrees. */
export function canTakeFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el?.isConnected && !el.closest('[inert],[aria-hidden="true"]') && !el.matches(':disabled');
}

/** First element matching `selector` that can take focus (the surface's usual opener), or null. */
export function focusableMatch(selector: string | undefined): HTMLElement | null {
  if (!selector || typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) if (canTakeFocus(el)) return el;
  return null;
}
