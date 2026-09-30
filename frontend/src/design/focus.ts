/** Focus helpers shared by dialogs, flyouts and the tour. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab inside `container`. Returns a keydown handler. */
export function trapFocus(container: HTMLElement | null) {
  return (event: KeyboardEvent | React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !container) return;
    const nodes = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

/** Elements receiving a focus *return* right now: their tooltip stays closed (it would cover what just closed). */
const returning = new WeakSet<Element>();

/**
 * Hands focus back to a trigger after its menu, popover or drawer closes, without popping the trigger's
 * tooltip (a tooltip that opens on a focus return lingers over the content below, e.g. the patient chip's
 * over the Risk card header).
 */
export function returnFocusQuietly(el: HTMLElement | null | undefined): void {
  if (!el) return;
  returning.add(el);
  try {
    el.focus({ preventScroll: true });
  } finally {
    returning.delete(el);
  }
}

/** True while `el` is receiving a quiet focus return (read by Tooltip's focus handler). */
export const isReturningFocus = (el: Element | null | undefined): boolean => !!el && returning.has(el);
