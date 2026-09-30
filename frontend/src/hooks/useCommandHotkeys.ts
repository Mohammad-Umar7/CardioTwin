import { useEffect } from 'react';
import { isSingleKeyChord, matchesChord, parseShortcut } from '@/design/shortcut';
import { isCommandEnabled, rankedCommands, useCommandStore, type Command } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';

export interface HotkeyContext {
  /** Focus is in a text field, number field, select, slider or combobox. */
  editable: boolean;
  paletteOpen: boolean;
  /** A modal dialog (aria-modal="true") is open, e.g. the shortcut sheet or Details. */
  modalOpen: boolean;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  const role = el.getAttribute('role');
  return (
    el.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    role === 'slider' ||
    role === 'combobox' ||
    role === 'spinbutton' ||
    role === 'textbox'
  );
}

/**
 * The command a key press should run, following WORKSTATION_V2 §4.10: Esc is never a command (it belongs
 * to the Esc chain); single-key shortcuts are suspended while typing, while the palette is open and while
 * a modal is open; modifier shortcuts (Ctrl K) always work. Among enabled matches, the highest priority
 * and then the most recent registration wins.
 */
export function commandForKey(event: KeyLike, candidates: Command[], ctx: HotkeyContext): Command | null {
  if (event.key === 'Escape') return null;
  for (const command of candidates) {
    const chord = parseShortcut(command.shortcut).find((c) => matchesChord(event, c));
    if (!chord) continue;
    if (isSingleKeyChord(chord) && (ctx.editable || ctx.paletteOpen || ctx.modalOpen)) continue;
    if (!isCommandEnabled(command)) continue;
    return command;
  }
  return null;
}

/**
 * Binds every registered command's shortcut on window keydown. Mount once (the app shell). A handler that
 * already called `preventDefault()` (a focused canvas, a slider, a field's own keys) wins.
 */
export function useCommandHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const candidates = rankedCommands(useCommandStore.getState().sources).map((r) => r.command);
      const command = commandForKey(event, candidates, {
        editable: isEditableTarget(event.target),
        paletteOpen: useUiStore.getState().paletteOpen,
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
      });
      if (!command) return;
      event.preventDefault();
      command.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
