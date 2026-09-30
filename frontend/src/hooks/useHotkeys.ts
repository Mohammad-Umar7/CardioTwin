import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    el.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.getAttribute('role') === 'slider' ||
    el.getAttribute('role') === 'combobox'
  );
};

/**
 * Global single-key shortcuts (DESIGN_SYSTEM §10.3). Keys are matched on `event.key` (e.g. '1', 'p',
 * 'Escape', '?', '['), case-insensitive for letters. Ignored while typing in a field or with a
 * modifier held, so shortcuts never hijack text entry or browser shortcuts.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target) && event.key !== 'Escape') return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = ref.current[key] ?? ref.current[event.key];
      if (handler) {
        handler(event);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
